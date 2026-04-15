"""
Hyperfine-resolved dynamic polarizability using ARC.

Exposes:
  SUPPORTED_ATOMS  – registry of supported atomic species
  get_F_values     – valid F quantum numbers for given I, J
  get_mF_values    – valid mF quantum numbers for given F
  fmt_qnum         – format (possibly half-integer) quantum number as string
  HFPolarizabilityCalculator – main calculator class
"""

import math

import arc
import numpy as np
from sympy import S
from sympy.physics.wigner import wigner_6j

# ── Atom registry ─────────────────────────────────────────────────────────────
# arc_class : name of the class in the `arc` module
# n_ground  : principal quantum number of the ground state
# L_ground  : orbital angular momentum of the ground state
# J_ground  : total electronic angular momentum of the ground state
# I         : nuclear spin
# display   : pretty-printed isotope name

SUPPORTED_ATOMS = {
    "Li6":   {"arc_class": "Lithium6",    "n_ground": 2, "L_ground": 0, "J_ground": 0.5, "I": 1.0,  "display": "⁶Li"},
    "Li7":   {"arc_class": "Lithium7",    "n_ground": 2, "L_ground": 0, "J_ground": 0.5, "I": 1.5,  "display": "⁷Li"},
    "Na23":  {"arc_class": "Sodium",      "n_ground": 3, "L_ground": 0, "J_ground": 0.5, "I": 1.5,  "display": "²³Na"},
    "K39":   {"arc_class": "Potassium39", "n_ground": 4, "L_ground": 0, "J_ground": 0.5, "I": 1.5,  "display": "³⁹K"},
    "K40":   {"arc_class": "Potassium40", "n_ground": 4, "L_ground": 0, "J_ground": 0.5, "I": 4.0,  "display": "⁴⁰K"},
    "K41":   {"arc_class": "Potassium41", "n_ground": 4, "L_ground": 0, "J_ground": 0.5, "I": 1.5,  "display": "⁴¹K"},
    "Rb85":  {"arc_class": "Rubidium85",  "n_ground": 5, "L_ground": 0, "J_ground": 0.5, "I": 2.5,  "display": "⁸⁵Rb"},
    "Rb87":  {"arc_class": "Rubidium87",  "n_ground": 5, "L_ground": 0, "J_ground": 0.5, "I": 1.5,  "display": "⁸⁷Rb"},
    "Cs133": {"arc_class": "Caesium",     "n_ground": 6, "L_ground": 0, "J_ground": 0.5, "I": 3.5,  "display": "¹³³Cs"},
}


def get_F_values(I: float, J: float) -> list[float]:
    """Return sorted list of valid F quantum numbers for nuclear spin I and electronic J."""
    vals, F = [], abs(I - J)
    while F <= I + J + 1e-9:
        vals.append(F)
        F += 1.0
    return vals


def get_mF_values(F: float) -> list[float]:
    """Return sorted list of valid mF quantum numbers for total angular momentum F."""
    vals, mF = [], -F
    while mF <= F + 1e-9:
        vals.append(mF)
        mF += 1.0
    return vals


def fmt_qnum(x: float) -> str:
    """Format a quantum number (integer or half-integer) as a string.

    Examples: 2 → '2', 1.5 → '3/2', -1.5 → '-3/2'
    """
    if x == int(x):
        return str(int(x))
    n = int(round(2 * x))
    return f"{n}/2"


# ── Calculator ────────────────────────────────────────────────────────────────

class HFPolarizabilityCalculator:
    """Dynamic polarizability for a hyperfine Zeeman state |F, mF⟩.

    The result is the effective polarizability in ARC SI units:
    Hz / (V/m)², i.e. α_eff such that  U = -h α_eff E².
    """

    def __init__(self, atom_name: str, n: int, L: int, J: float,
                 F: float, mF: float, q: int):
        info = SUPPORTED_ATOMS[atom_name]
        self.atom = getattr(arc, info["arc_class"])()
        self.n, self.L, self.J = int(n), int(L), float(J)
        self.F, self.mF, self.q = float(F), float(mF), int(q)
        self._check_validity()

        self.pol = arc.DynamicPolarizability(self.atom, self.n, self.L, self.J)
        n_min, n_max = info["n_ground"], info["n_ground"] + 10
        self.pol.defineBasis(n_min, n_max)

    # ── Public ----------------------------------------------------------------

    def get_atom_mass(self) -> float:
        return self.atom.mass

    def calculate(self, wavelength_m: float) -> float:
        """Return effective polarizability [Hz/(V/m)²] at the given wavelength."""
        ret = self.pol.getPolarizability(
            wavelength_m, units="SI", accountForStateLifetime=True
        )
        a_s, a_v, a_t, a_c = float(ret[0]), float(ret[1]), float(ret[2]), float(ret[3])
        return self._hyperfine_polarizability(a_s, a_v, a_t, a_c)["alpha_total"]

    # ── Internal --------------------------------------------------------------

    def _check_validity(self):
        F, mF, q = self.F, self.mF, self.q
        if abs(mF) > F + 1e-9:
            raise ValueError(f"Invalid mF={mF} for F={F}: need |mF| ≤ F")
        if q not in (-1, 0, 1):
            raise ValueError(f"Invalid q={q}: must be -1, 0, or 1")
        I = float(self.atom.I)
        Fmin, Fmax = abs(I - self.J), I + self.J
        if not (Fmin - 1e-9 <= F <= Fmax + 1e-9):
            raise ValueError(f"F={F} outside allowed range [{Fmin}, {Fmax}] for I={I}, J={self.J}")

    @staticmethod
    def _minus_one_pow(x: float) -> float:
        return -1.0 if int(round(float(x))) % 2 else 1.0

    def _arc_to_irreducible(self, a_scalar, a_vector, a_tensor):
        """Convert ARC scalar/vector/tensor polarizabilities to irreducible rank-K components."""
        J = self.J
        alpha0 = math.sqrt(3.0 * (2.0 * J + 1.0)) * a_scalar
        alpha1 = 0.0 if J <= 0 else -math.sqrt((J + 1.0) * (2.0 * J + 1.0) / (2.0 * J)) * a_vector
        alpha2 = 0.0 if J < 1.0 else -math.sqrt(
            3.0 * (J + 1.0) * (2.0 * J + 1.0) * (2.0 * J + 3.0) / (2.0 * J * (2.0 * J - 1.0))
        ) * a_tensor
        return alpha0, alpha1, alpha2

    def _hyperfine_polarizability(self, a_scalar, a_vector, a_tensor, a_core):
        """Compute effective polarizability for |F, mF⟩ with polarization q."""
        J, F, mF, q = self.J, self.F, self.mF, self.q
        I = float(self.atom.I)

        _, alpha1, alpha2 = self._arc_to_irreducible(a_scalar, a_vector, a_tensor)
        phase = self._minus_one_pow(J + I + F)

        # Scalar (includes ionic core)
        alphaF_s = a_scalar + a_core

        # Vector
        if F == 0:
            alphaF_v = 0.0
        else:
            w6_1 = float(wigner_6j(S(F), 1, S(F), S(J), S(I), S(J)).evalf())
            alphaF_v = (phase * math.sqrt(2.0 * F * (2.0 * F + 1.0) / (F + 1.0)) * w6_1 * alpha1)

        # Tensor
        if F < 1.0 or J < 1.0:
            alphaF_t = 0.0
        else:
            w6_2 = float(wigner_6j(S(F), 2, S(F), S(J), S(I), S(J)).evalf())
            alphaF_t = (-phase * math.sqrt(
                2.0 * F * (2.0 * F - 1.0) * (2.0 * F + 1.0)
                / (3.0 * (F + 1.0) * (2.0 * F + 3.0))
            ) * w6_2 * alpha2)

        C = -float(q)                              # |u_{-1}|² - |u_{+1}|²
        D = 1.0 - 3.0 * (1.0 if q == 0 else 0.0)  # 1 - 3|u_0|²

        alpha_total = alphaF_s
        if F != 0:
            alpha_total += C * (mF / (2.0 * F)) * alphaF_v
        if F >= 1.0:
            alpha_total -= D * ((3.0 * mF**2 - F * (F + 1.0)) / (2.0 * F * (2.0 * F - 1.0))) * alphaF_t

        return {
            "alpha_F_scalar": alphaF_s,
            "alpha_F_vector": alphaF_v,
            "alpha_F_tensor": alphaF_t,
            "alpha_total": alpha_total,
        }
