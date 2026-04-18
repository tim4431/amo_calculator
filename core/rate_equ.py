"""Multi-level rate-equation solver for atomic populations.

Given a set of atomic sublevels with pairwise dipole matrix elements and
one or more monochromatic laser fields, integrate the population dynamics
in the rate-equation approximation (no coherences).

Stimulated transition rates use a Lorentzian line shape for each individual
(lower, upper, laser, polarization) combination without a saturation term
in the denominator, so results are most accurate in the unsaturated regime
(s = 2|Ω|^2 / Γ^2 ≲ 1). Multiple lasers simply add their rates. Spontaneous
decay rates are computed from the dipole matrix elements via the standard
Einstein-A formula, so each excited sublevel's total decay sum should match
the atom's natural linewidth Γ.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.constants import c as SPEED_OF_LIGHT
from scipy.constants import e as E_CHARGE
from scipy.constants import epsilon_0 as EPS0
from scipy.constants import hbar as HBAR
from scipy.constants import physical_constants
from scipy.integrate import solve_ivp

BOHR_RADIUS = physical_constants["Bohr radius"][0]
MU_B = physical_constants["Bohr magneton"][0]  # J/T
H_PLANCK = physical_constants["Planck constant"][0]  # J·s


@dataclass
class Level:
    """An atomic sublevel.

    ``energy_Hz`` is the absolute level frequency E/h (any consistent zero
    works, but the value enters the spontaneous-emission rate as ω^3, so the
    optical frequency must be included, not just hyperfine shifts).
    """

    label: str
    energy_Hz: float


@dataclass
class Laser:
    """A monochromatic laser field.

    ``polarization`` gives the complex amplitude of the electric field in
    the spherical basis: keys q ∈ {-1, 0, +1}, values e_q with
    Σ|e_q|^2 = 1. σ+ light along the quantization axis is ``{+1: 1}``.
    """

    label: str
    frequency_Hz: float
    intensity_W_m2: float
    polarization: Dict[int, complex]


class RateEquationSolver:
    """Integrate rate equations for a multi-level atom driven by lasers.

    Parameters
    ----------
    levels : sequence of Level
    dipole : dict[int, np.ndarray]
        ``dipole[q][i, j]`` is ⟨i | e r_q | j⟩ in SI units (C·m), nonzero
        only when m_i = m_j + q. Only one of ``dipole[q][i, j]`` or
        ``dipole[-q][j, i]`` needs to be provided per pair; the solver uses
        |d|^2 so sign/phase conventions cancel. Missing q keys are treated
        as zero matrices.
    """

    def __init__(
        self,
        levels: Sequence[Level],
        dipole: Dict[int, np.ndarray],
    ) -> None:
        self.levels: List[Level] = list(levels)
        self.N = len(self.levels)
        self.energies_Hz = np.array([lvl.energy_Hz for lvl in self.levels], dtype=float)

        self.dipole: Dict[int, np.ndarray] = {}
        for q in (-1, 0, 1):
            d = dipole.get(q)
            if d is None:
                d = np.zeros((self.N, self.N), dtype=complex)
            else:
                d = np.asarray(d, dtype=complex)
            if d.shape != (self.N, self.N):
                raise ValueError(
                    f"dipole[{q}] must have shape ({self.N}, {self.N}), got {d.shape}"
                )
            self.dipole[q] = d

        self.lasers: List[Laser] = []
        self._gamma = self._compute_decay_matrix()

    def _compute_decay_matrix(self) -> np.ndarray:
        """``gamma[i, j]`` = spontaneous decay rate from level i to level j (s^-1).

        Nonzero only when ``E_i > E_j``.
        """
        E = self.energies_Hz
        omega = np.maximum(2 * np.pi * (E[:, None] - E[None, :]), 0.0)
        d2 = sum(
            np.abs(self.dipole[q]) ** 2 + np.abs(self.dipole[q].T) ** 2
            for q in (-1, 0, 1)
        )
        return omega**3 * d2 / (3 * np.pi * EPS0 * HBAR * SPEED_OF_LIGHT**3)

    def total_decay(self) -> np.ndarray:
        """Total spontaneous decay rate out of each level (s^-1)."""
        return self._gamma.sum(axis=1)

    def decay_matrix(self) -> np.ndarray:
        """Copy of the spontaneous decay matrix ``gamma[i, j]``."""
        return self._gamma.copy()

    def add_laser(self, laser: Laser) -> None:
        self.lasers.append(laser)

    def build_rate_matrix(self) -> np.ndarray:
        """Build the N×N transition-rate matrix A with dN/dt = A N."""
        # Spontaneous: A[j,i]=γ_ij (gain into j), A[i,i]=−Σ_j γ_ij (loss out of i).
        gamma_total = self._gamma.sum(axis=1)
        A = self._gamma.T - np.diag(gamma_total)

        # Stimulated (absorption + stimulated emission). Loop only over pairs
        # that have spontaneous coupling — other pairs contribute zero anyway.
        for laser in self.lasers:
            E_amp = np.sqrt(2 * laser.intensity_W_m2 / (EPS0 * SPEED_OF_LIGHT))
            for e, g in np.argwhere(self._gamma > 0):
                Gamma_e = gamma_total[e]
                omega_eg = 2 * np.pi * (self.energies_Hz[e] - self.energies_Hz[g])
                detuning = 2 * np.pi * laser.frequency_Hz - omega_eg  # rad/s
                Omega2 = 0.0
                for q, eq in laser.polarization.items():
                    if q not in (-1, 0, 1) or eq == 0:
                        continue
                    # <e|e r_q|g> — accept whichever ordering the user filled.
                    d_eg = self.dipole[q][e, g] or np.conj(self.dipole[-q][g, e])
                    if d_eg == 0:
                        continue
                    Omega2 += abs(d_eg * eq * E_amp / HBAR) ** 2
                if Omega2 == 0.0:
                    continue
                R = Omega2 * (Gamma_e / 2) / (detuning**2 + (Gamma_e / 2) ** 2)
                A[e, g] += R
                A[g, g] -= R
                A[g, e] += R
                A[e, e] -= R
        return A

    def solve(
        self,
        N0: np.ndarray,
        t_eval: np.ndarray,
        method: str = "LSODA",
        rtol: float = 1e-8,
        atol: float = 1e-12,
    ):
        """Integrate dN/dt = A N from ``t_eval[0]`` to ``t_eval[-1]``.

        Returns the ``OdeResult`` from ``scipy.integrate.solve_ivp``; the
        population array is ``sol.y`` with shape ``(N_levels, len(t_eval))``.
        """
        N0 = np.asarray(N0, dtype=float)
        if N0.shape != (self.N,):
            raise ValueError(f"N0 must have shape ({self.N},), got {N0.shape}")
        A = self.build_rate_matrix()

        def rhs(_t, N):
            return A @ N

        return solve_ivp(
            rhs,
            (float(t_eval[0]), float(t_eval[-1])),
            N0,
            t_eval=t_eval,
            method=method,
            rtol=rtol,
            atol=atol,
        )

    def steady_state(self, null_tol: float = 1e-9) -> np.ndarray:
        """Steady-state populations via SVD null-space of the rate matrix.

        Population conservation guarantees one zero singular value of A, so
        the null space is at least 1-D. When it is exactly 1-D (no dark
        states) the result is unique. If the null space has dimension >1,
        a warning is emitted — the steady state then depends on initial
        conditions, and the returned vector is just the smallest-singular-
        value direction as a representative.

        ``null_tol`` is the relative threshold (vs σ_max) used to count
        singular values as zero.
        """
        A = self.build_rate_matrix()
        _, S, Vt = np.linalg.svd(A)
        S_max = S.max() if len(S) else 1.0
        n_null = int(np.sum(S < null_tol * S_max)) if S_max > 0 else self.N
        if n_null > 1:
            warnings.warn(
                f"Rate matrix has {n_null}-dimensional null space — steady "
                "state is not unique (dark states present).",
                stacklevel=2,
            )
        v = Vt[-1].real
        s = v.sum()
        if s == 0:
            raise ValueError(
                "Null-space vector has zero sum; no normalizable steady state."
            )
        return v / s

    def photon_scattering_rate(self, N: np.ndarray) -> float:
        """Total photon-scattering rate R = Σ_i Γ_i · N_i (photons · s⁻¹ / atom).

        ``Γ_i`` is the total spontaneous decay rate out of level i (zero for
        ground sublevels, Γ for excited sublevels in the cycling regime).
        Pass any population vector; for the steady-state value use
        ``solver.photon_scattering_rate(solver.steady_state())``.
        """
        return float(np.sum(self._gamma.sum(axis=1) * np.asarray(N)))

    def sweep_steady_state(
        self,
        param_setter: Callable[[Any], None],
        values: Sequence[Any],
        observable: Optional[Callable[[np.ndarray], Any]] = None,
    ) -> np.ndarray:
        """Scan a parameter and record a steady-state observable at each point.

        ``param_setter(v)`` mutates the solver or one of its lasers before
        each solve, e.g. ``lambda d: setattr(pump, 'frequency_Hz', f0 + d)``.
        ``observable(N_ss)`` extracts the quantity to record (scattering
        rate, a subset of populations, ...); if omitted, the full
        population vector is collected. The leading axis of the returned
        array is ``len(values)``.

        Note: this method mutates the solver through ``param_setter``.
        Callers that need the original state should save/restore it.
        """
        out = []
        for v in values:
            param_setter(v)
            N = self.steady_state()
            out.append(np.asarray(observable(N) if observable else N))
        return np.array(out)


# ---------------------------------------------------------------------------
# Hyperfine-manifold helpers (ARC-backed)
# ---------------------------------------------------------------------------


def _mf_values(F: float) -> List[float]:
    """Return ``[-F, -F+1, ..., +F]`` as Python numbers (int if F is integer)."""
    n = int(round(2 * F)) + 1
    vals = [-F + i for i in range(n)]
    if float(F).is_integer():
        vals = [int(v) for v in vals]
    return vals


@dataclass
class LevelGroup:
    """A hyperfine manifold: a collection of mF sublevels sharing one F.

    ``energy_Hz`` is the manifold centroid (with no Zeeman shift).
    ``mF_energies_Hz`` holds the per-mF energy (centroid + Zeeman shift),
    parallel to ``mF_values`` and ``level_indices``.

    ``n``, ``l``, ``j`` record the fine-structure state that owns this
    manifold. :func:`build_hfs_levels` fills them in; downstream helpers
    like :func:`build_dipole_matrix` can then be called without restating
    the quantum numbers.
    """

    label: str
    F: float
    energy_Hz: float
    is_excited: bool
    level_indices: List[int] = field(default_factory=list)
    mF_values: List[float] = field(default_factory=list)
    mF_energies_Hz: List[float] = field(default_factory=list)
    g_F: float = 0.0
    n: Optional[int] = None
    l: Optional[int] = None
    j: Optional[float] = None
    s: float = 0.5


def build_hfs_levels(
    atom: Any,
    n: int,
    l: int,
    j: float,
    F_values: Sequence[float],
    zero_energy_Hz: float = 0.0,
    prime: bool = False,
    s: float = 0.5,
    start_index: int = 0,
    B_field_T: float = 0.0,
) -> Tuple[List[Level], List[LevelGroup]]:
    """Build hyperfine sublevels for a single fine-structure state via ARC.

    ``B_field_T`` adds a linear Zeeman shift g_F · μ_B · B · mF / h (Hz) to
    each sublevel, where g_F is computed from the fine-structure g_J and
    the nuclear spin I obtained from the ARC atom instance. The nuclear g_I
    contribution (∼0.05 % of g_J for alkalis) is neglected.

    Returns (levels, groups). Each :class:`LevelGroup` stores the
    per-mF energies in ``mF_energies_Hz`` and the computed ``g_F``.
    """
    A, B_hfs = atom.getHFSCoefficients(n, l, j)
    levels: List[Level] = []
    groups: List[LevelGroup] = []
    idx = start_index
    for F in F_values:
        hfs_shift = atom.getHFSEnergyShift(j, F, A, B_hfs, s=s)
        E_centroid = zero_energy_Hz + hfs_shift
        g_f = atom.getLandegf(l, j, F, s=s)
        mFs = _mf_values(F)
        indices: List[int] = []
        mF_Es: List[float] = []
        f_label = f"F'={F}" if prime else f"F={F}"
        for mF in mFs:
            zeeman_Hz = g_f * MU_B * B_field_T * mF / H_PLANCK
            E_level = E_centroid + zeeman_Hz
            indices.append(idx)
            idx += 1
            mF_Es.append(E_level)
            levels.append(Level(f"{f_label},mF={mF:+g}", E_level))
        groups.append(
            LevelGroup(
                label=f_label,
                F=F,
                energy_Hz=E_centroid,
                is_excited=prime,
                level_indices=indices,
                mF_values=mFs,
                mF_energies_Hz=mF_Es,
                g_F=g_f,
                n=n, l=l, j=j, s=s,
            )
        )
    return levels, groups


def resonance_frequency(
    groups: Sequence[LevelGroup],
    Fg: float,
    Fe: float,
    mF_g: float = 0,
    mF_e: float = 0,
    detuning_Hz: float = 0.0,
) -> float:
    """Optical frequency of a laser detuned by ``detuning_Hz`` from the
    (ground F, mF_g) → (excited F', mF_e) transition.

    Defaults ``mF_g = mF_e = 0`` give the mF=0↔mF=0 "reference" transition,
    which coincides with the manifold centroid when there is no B field.
    """
    gg = next((g for g in groups if g.F == Fg and not g.is_excited), None)
    eg = next((g for g in groups if g.F == Fe and g.is_excited), None)
    if gg is None or eg is None:
        raise ValueError(f"Groups for F={Fg} / F'={Fe} not found.")
    if mF_g not in gg.mF_values:
        raise ValueError(f"mF={mF_g} not in F={Fg} (allowed: {gg.mF_values})")
    if mF_e not in eg.mF_values:
        raise ValueError(f"mF={mF_e} not in F'={Fe} (allowed: {eg.mF_values})")
    Eg = gg.mF_energies_Hz[gg.mF_values.index(mF_g)]
    Ee = eg.mF_energies_Hz[eg.mF_values.index(mF_e)]
    return Ee - Eg + detuning_Hz


def build_dipole_matrix(
    atom: Any,
    groups: Sequence[LevelGroup],
    n_levels: Optional[int] = None,
) -> Dict[int, np.ndarray]:
    """Build ``dipole[q][e, g]`` for every ground-manifold ↔ excited-manifold pair.

    Each :class:`LevelGroup` carries its own ``(n, l, j)``, so the fine-structure
    quantum numbers are read directly from the groups — no need to restate them
    here. Ground/excited manifolds are identified by the ``is_excited`` flag.
    ARC's ``getDipoleMatrixElementHFS`` is called with state 1 = ground and
    state 2 = excited so that the sign convention matches ``q = m_e - m_g``.
    """
    if n_levels is None:
        n_levels = max(max(g.level_indices) for g in groups) + 1
    dipole = {q: np.zeros((n_levels, n_levels), dtype=complex) for q in (-1, 0, 1)}
    ground_groups = [g for g in groups if not g.is_excited]
    excited_groups = [g for g in groups if g.is_excited]
    for gg in ground_groups:
        for eg in excited_groups:
            if None in (gg.n, gg.l, gg.j, eg.n, eg.l, eg.j):
                raise ValueError(
                    f"LevelGroup {gg.label!r}/{eg.label!r} missing (n,l,j) — "
                    "build groups via build_hfs_levels() or set them manually."
                )
            for mFg, ig in zip(gg.mF_values, gg.level_indices):
                for mFe, ie in zip(eg.mF_values, eg.level_indices):
                    q = int(round(mFe - mFg))
                    if q not in (-1, 0, 1):
                        continue
                    d_ea0 = atom.getDipoleMatrixElementHFS(
                        gg.n, gg.l, gg.j, gg.F, mFg,
                        eg.n, eg.l, eg.j, eg.F, mFe,
                        q, s=gg.s,
                    )
                    dipole[q][ie, ig] = d_ea0 * E_CHARGE * BOHR_RADIUS
    return dipole


# ---------------------------------------------------------------------------
# Initial-state helpers
# ---------------------------------------------------------------------------


def _total_levels(groups: Sequence[LevelGroup]) -> int:
    return max(max(g.level_indices) for g in groups) + 1


def initial_state_pumped(
    groups: Sequence[LevelGroup],
    F: float,
    mF: float,
    total: float = 1.0,
    is_excited: bool = False,
) -> np.ndarray:
    """All population in a single (F, mF) sublevel.

    Raises ``ValueError`` if the requested sublevel is not in ``groups``.
    """
    N = _total_levels(groups)
    N0 = np.zeros(N)
    for g in groups:
        if g.F != F or g.is_excited != is_excited:
            continue
        for mFv, i in zip(g.mF_values, g.level_indices):
            if mFv == mF:
                N0[i] = total
                return N0
    raise ValueError(f"(F={F}, mF={mF}, is_excited={is_excited}) not found in groups")


def initial_state_mot(
    groups: Sequence[LevelGroup],
    F: float,
    total: float = 1.0,
    is_excited: bool = False,
) -> np.ndarray:
    """Equal population over all mF of a single F manifold.

    Models atoms from a MOT with unpolarized spin inside one F manifold.
    """
    N = _total_levels(groups)
    N0 = np.zeros(N)
    for g in groups:
        if g.F != F or g.is_excited != is_excited:
            continue
        n = len(g.level_indices)
        for i in g.level_indices:
            N0[i] = total / n
        return N0
    raise ValueError(f"F={F} manifold (is_excited={is_excited}) not found in groups")


