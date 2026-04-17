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

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

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

    def _pair_dipole_squared(self, i: int, j: int) -> float:
        """Σ_q |⟨i|e r_q|j⟩|^2 using whichever ordering the user populated."""
        total = 0.0
        for q in (-1, 0, 1):
            total += abs(self.dipole[q][i, j]) ** 2 + abs(self.dipole[q][j, i]) ** 2
        return total

    def _compute_decay_matrix(self) -> np.ndarray:
        """``gamma[i, j]`` = spontaneous decay rate from level i to level j (s^-1).

        Nonzero only when ``E_i > E_j``.
        """
        gamma = np.zeros((self.N, self.N))
        prefactor = 1.0 / (3 * np.pi * EPS0 * HBAR * SPEED_OF_LIGHT ** 3)
        for i in range(self.N):
            for j in range(self.N):
                if self.energies_Hz[i] <= self.energies_Hz[j]:
                    continue
                omega = 2 * np.pi * (self.energies_Hz[i] - self.energies_Hz[j])
                d2 = self._pair_dipole_squared(i, j)
                if d2 == 0.0:
                    continue
                gamma[i, j] = prefactor * omega ** 3 * d2
        return gamma

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
        A = np.zeros((self.N, self.N))

        # Spontaneous decay: j gains population from i, i loses it.
        for i in range(self.N):
            for j in range(self.N):
                g_ij = self._gamma[i, j]
                if g_ij > 0:
                    A[j, i] += g_ij
                    A[i, i] -= g_ij

        gamma_total = self.total_decay()

        # Stimulated (absorption + stimulated emission).
        for laser in self.lasers:
            E_amp = np.sqrt(2 * laser.intensity_W_m2 / (EPS0 * SPEED_OF_LIGHT))
            for i in range(self.N):
                for j in range(i + 1, self.N):
                    if self.energies_Hz[i] == self.energies_Hz[j]:
                        continue
                    if self.energies_Hz[j] > self.energies_Hz[i]:
                        e, g = j, i
                    else:
                        e, g = i, j
                    Gamma_e = gamma_total[e]
                    if Gamma_e <= 0:
                        continue
                    omega_eg = 2 * np.pi * (self.energies_Hz[e] - self.energies_Hz[g])
                    detuning = 2 * np.pi * laser.frequency_Hz - omega_eg  # rad/s
                    Omega2 = 0.0
                    for q, eq in laser.polarization.items():
                        if q not in (-1, 0, 1) or eq == 0:
                            continue
                        # <e|e r_q|g> (grab whichever ordering the user filled)
                        d_eg = self.dipole[q][e, g]
                        if d_eg == 0:
                            d_eg = np.conj(self.dipole[-q][g, e]) if -q in self.dipole else 0.0
                        if d_eg == 0:
                            continue
                        Omega_q = d_eg * eq * E_amp / HBAR
                        Omega2 += abs(Omega_q) ** 2
                    if Omega2 == 0.0:
                        continue
                    R = Omega2 * (Gamma_e / 2) / (detuning ** 2 + (Gamma_e / 2) ** 2)
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

    def steady_state(self) -> np.ndarray:
        """Return the steady-state populations (sums to 1).

        Computed as the null space of ``A`` augmented with the
        conservation constraint Σ N = 1.
        """
        A = self.build_rate_matrix()
        M = np.vstack([A, np.ones(self.N)])
        rhs = np.zeros(self.N + 1)
        rhs[-1] = 1.0
        N_ss, *_ = np.linalg.lstsq(M, rhs, rcond=None)
        return N_ss


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
    """

    label: str
    F: float
    energy_Hz: float
    is_excited: bool
    level_indices: List[int] = field(default_factory=list)
    mF_values: List[float] = field(default_factory=list)
    mF_energies_Hz: List[float] = field(default_factory=list)
    g_F: float = 0.0


def lande_gj(L: int, J: float, S: float = 0.5) -> float:
    """Fine-structure Landé factor g_J (ignoring relativistic/anomalous corrections)."""
    if J == 0:
        return 0.0
    return 1.0 + (J * (J + 1) + S * (S + 1) - L * (L + 1)) / (2 * J * (J + 1))


def lande_gf(F: float, J: float, I: float, g_j: float) -> float:
    """Hyperfine Landé factor g_F (neglecting the nuclear g_I contribution)."""
    if F == 0:
        return 0.0
    return g_j * (F * (F + 1) + J * (J + 1) - I * (I + 1)) / (2 * F * (F + 1))


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
    I_nuc = atom.I
    g_j = lande_gj(l, j, s)
    levels: List[Level] = []
    groups: List[LevelGroup] = []
    idx = start_index
    for F in F_values:
        hfs_shift = atom.getHFSEnergyShift(j, F, A, B_hfs, s=s)
        E_centroid = zero_energy_Hz + hfs_shift
        g_f = lande_gf(F, j, I_nuc, g_j)
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
            mF_str = f"{mF:+d}" if isinstance(mF, int) else f"{mF:+.1f}"
            levels.append(Level(f"{f_label},mF={mF_str}", E_level))
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
            )
        )
    return levels, groups


def resonance_frequency(
    groups: Sequence[LevelGroup],
    ground_F: float,
    excited_F: float,
    mF_g: float = 0,
    mF_e: float = 0,
    detuning_Hz: float = 0.0,
) -> float:
    """Optical frequency of a laser detuned by ``detuning_Hz`` from the
    (ground F, mF_g) → (excited F', mF_e) transition.

    Defaults ``mF_g = mF_e = 0`` give the mF=0↔mF=0 "reference" transition,
    which coincides with the manifold centroid when there is no B field.
    """
    gg = next((g for g in groups if g.F == ground_F and not g.is_excited), None)
    eg = next((g for g in groups if g.F == excited_F and g.is_excited), None)
    if gg is None or eg is None:
        raise ValueError(f"Groups for F={ground_F} / F'={excited_F} not found.")
    if mF_g not in gg.mF_values:
        raise ValueError(f"mF={mF_g} not in F={ground_F} (allowed: {gg.mF_values})")
    if mF_e not in eg.mF_values:
        raise ValueError(f"mF={mF_e} not in F'={excited_F} (allowed: {eg.mF_values})")
    Eg = gg.mF_energies_Hz[gg.mF_values.index(mF_g)]
    Ee = eg.mF_energies_Hz[eg.mF_values.index(mF_e)]
    return Ee - Eg + detuning_Hz


def build_dipole_matrix(
    atom: Any,
    ground: Tuple[int, int, float],
    excited: Tuple[int, int, float],
    groups: Sequence[LevelGroup],
    n_levels: Optional[int] = None,
) -> Dict[int, np.ndarray]:
    """Build ``dipole[q][e, g]`` for a two-manifold fine-structure transition.

    ``groups`` must contain both ground (``is_excited=False``) and excited
    (``is_excited=True``) :class:`LevelGroup` objects. The helper calls
    ARC's ``getDipoleMatrixElementHFS`` with state 1 = ground and state 2 =
    excited so that ARC's internal sign convention lines up with our
    ``q = m_excited - m_ground``.
    """
    gn, gl, gj = ground
    en, el, ej = excited
    if n_levels is None:
        n_levels = max(max(g.level_indices) for g in groups) + 1
    dipole = {q: np.zeros((n_levels, n_levels), dtype=complex) for q in (-1, 0, 1)}
    ground_groups = [g for g in groups if not g.is_excited]
    excited_groups = [g for g in groups if g.is_excited]
    for gg in ground_groups:
        for eg in excited_groups:
            for mFg, ig in zip(gg.mF_values, gg.level_indices):
                for mFe, ie in zip(eg.mF_values, eg.level_indices):
                    q = int(round(mFe - mFg))
                    if q not in (-1, 0, 1):
                        continue
                    d_ea0 = atom.getDipoleMatrixElementHFS(
                        gn, gl, gj, gg.F, mFg,
                        en, el, ej, eg.F, mFe,
                        q,
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
    raise ValueError(
        f"(F={F}, mF={mF}, is_excited={is_excited}) not found in groups"
    )


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


# ---------------------------------------------------------------------------
# Visualization
# ---------------------------------------------------------------------------


_POL_NAME = {-1: "σ⁻", 0: "π", +1: "σ⁺"}

_DEFAULT_GROUP_CMAPS = [
    "Blues", "Oranges", "Greens", "Reds", "Purples", "YlOrBr", "PuRd",
]


def level_colors(
    groups: Sequence[LevelGroup],
    cmaps: Optional[Sequence[str]] = None,
    t_range: Tuple[float, float] = (0.35, 0.9),
) -> Dict[int, Any]:
    """Return ``{level_index: rgba}`` — one color per sublevel.

    Each group is assigned a matplotlib colormap (cycled from ``cmaps``);
    within the group, mF sublevels sample the colormap linearly over
    ``t_range``. The same mapping can be passed into :func:`plot_level_diagram`
    (``level_color_map``) and :func:`plot_populations` (``colors``) to keep
    the level diagram and dynamics plot visually consistent.
    """
    import matplotlib.pyplot as plt

    cmaps = list(cmaps) if cmaps is not None else _DEFAULT_GROUP_CMAPS
    t_lo, t_hi = t_range
    colors: Dict[int, Any] = {}
    for gi, g in enumerate(groups):
        cmap = plt.get_cmap(cmaps[gi % len(cmaps)])
        n = len(g.level_indices)
        for i, idx in enumerate(g.level_indices):
            t = t_lo + (t_hi - t_lo) * (i / max(n - 1, 1)) if n > 1 else 0.5 * (t_lo + t_hi)
            colors[idx] = cmap(t)
    return colors


def plot_level_diagram(
    ax,
    groups: Sequence[LevelGroup],
    lasers: Optional[Sequence[Laser]] = None,
    laser_pairs: Optional[Sequence[Tuple[str, str]]] = None,
    ground_y: Tuple[float, float] = (0.0, 1.0),
    excited_y: Tuple[float, float] = (3.0, 4.0),
    level_half_width: float = 0.4,
    level_color_map: Optional[Dict[int, Any]] = None,
    laser_colors: Optional[Sequence[str]] = None,
    zeeman_band: float = 0.15,
) -> None:
    """Draw a schematic level diagram (not to scale) on ``ax``.

    Each F manifold is a row of horizontal segments, one per mF, at x = mF.
    Ground and excited manifolds are stacked into two zones whose HFS
    splittings are scaled into ``ground_y`` / ``excited_y``; within each
    manifold, mF sublevels are spread vertically proportional to the Zeeman
    shift, normalized so that the largest |ΔE_Zeeman| across all groups
    spans ``zeeman_band`` y-units (set to 0 to disable the spread).

    ``level_color_map`` (from :func:`level_colors`) colors each sublevel.
    ``laser_colors`` colors the arrow per laser (default: matplotlib cycle).
    """
    import matplotlib.pyplot as plt

    ground_groups = [g for g in groups if not g.is_excited]
    excited_groups = [g for g in groups if g.is_excited]

    def _y_positions(grps: List[LevelGroup], y_lo: float, y_hi: float) -> Dict[int, float]:
        if not grps:
            return {}
        if len(grps) == 1:
            return {id(grps[0]): 0.5 * (y_lo + y_hi)}
        es = np.array([g.energy_Hz for g in grps])
        span = es.max() - es.min()
        if span == 0:
            return {id(g): 0.5 * (y_lo + y_hi) for g in grps}
        return {id(g): y_lo + (g.energy_Hz - es.min()) / span * (y_hi - y_lo) for g in grps}

    y_map: Dict[int, float] = {}
    y_map.update(_y_positions(ground_groups, *ground_y))
    y_map.update(_y_positions(excited_groups, *excited_y))

    # Global Zeeman-shift normalization
    max_abs_shift = 0.0
    for g in groups:
        for E in g.mF_energies_Hz:
            max_abs_shift = max(max_abs_shift, abs(E - g.energy_Hz))
    zeeman_scale = (zeeman_band / max_abs_shift) if max_abs_shift > 0 else 0.0

    all_mF = [mF for g in groups for mF in g.mF_values]
    mF_min, mF_max = int(min(all_mF)), int(max(all_mF))
    x_min, x_max = mF_min - 1, mF_max + 1.5

    for g in groups:
        y_center = y_map[id(g)]
        for mF, idx, E in zip(g.mF_values, g.level_indices, g.mF_energies_Hz):
            y = y_center + (E - g.energy_Hz) * zeeman_scale
            c = level_color_map[idx] if level_color_map is not None else "black"
            ax.hlines(y, mF - level_half_width, mF + level_half_width,
                      colors=[c], linewidth=2.0)
        ax.text(x_max + 0.1, y_center, g.label, va="center", fontsize=10)

    gap_y = 0.5 * (max(ground_y[1], 0) + min(excited_y[0], excited_y[1]))
    ax.axhline(gap_y, color="gray", linestyle=":", linewidth=1, alpha=0.5)

    if lasers:
        if laser_colors is None:
            laser_colors = plt.rcParams["axes.prop_cycle"].by_key()["color"]
        for i, laser in enumerate(lasers):
            if laser_pairs is not None:
                g_label, e_label = laser_pairs[i]
                g_grp = next(g for g in ground_groups if g.label == g_label)
                e_grp = next(g for g in excited_groups if g.label == e_label)
            else:
                g_grp, e_grp = _match_laser(laser, ground_groups, excited_groups)
            y_g = y_map[id(g_grp)]
            y_e = y_map[id(e_grp)]
            c = laser_colors[i % len(laser_colors)]
            mF_c = float(np.mean(g_grp.mF_values))
            q_components = [q for q, eq in laser.polarization.items() if abs(eq) > 0]
            for q in q_components:
                ax.annotate(
                    "",
                    xy=(mF_c + q, y_e),
                    xytext=(mF_c, y_g),
                    arrowprops=dict(arrowstyle="->", color=c, lw=1.8, alpha=0.85),
                )
            pol_str = ", ".join(_POL_NAME[q] for q in q_components)
            ax.text(
                mF_c + max(q_components, default=0) + 0.1,
                0.5 * (y_g + y_e),
                f"{laser.label} ({pol_str})",
                color=c, fontsize=9, ha="left", va="center",
            )

    ax.set_xlabel("$m_F$")
    ax.set_xticks(list(range(mF_min, mF_max + 1)))
    ax.set_yticks([])
    ax.set_xlim(x_min, x_max + 1.5)
    ax.set_ylim(
        min(ground_y[0], excited_y[0]) - 0.5,
        max(ground_y[1], excited_y[1]) + 0.5,
    )
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.tick_params(which="both", top=False, right=False, left=False, labelleft=False)


def _match_laser(
    laser: Laser, grounds: List[LevelGroup], excited: List[LevelGroup]
) -> Tuple[LevelGroup, LevelGroup]:
    best: Optional[Tuple[LevelGroup, LevelGroup]] = None
    best_err = np.inf
    for gg in grounds:
        for eg in excited:
            err = abs(eg.energy_Hz - gg.energy_Hz - laser.frequency_Hz)
            if err < best_err:
                best_err = err
                best = (gg, eg)
    if best is None:
        raise ValueError("Cannot infer laser pair: no ground/excited groups.")
    return best


def plot_populations(
    ax,
    t: np.ndarray,
    populations: Union[np.ndarray, Dict[str, np.ndarray]],
    labels: Optional[Sequence[str]] = None,
    colors: Optional[Union[Sequence, Dict[str, Any]]] = None,
    t_unit: str = "us",
    **kwargs,
) -> None:
    """Plot population trajectories on ``ax``.

    ``populations`` is either a ``(N_levels, T)`` array (pair with
    ``labels``) or a dict ``{label: trajectory}`` (pre-aggregated traces).
    ``colors`` is either a list parallel to labels/rows, or a dict keyed by
    label. Combine with :func:`level_colors` to match the level diagram.
    """
    scales = {"s": 1.0, "ms": 1e3, "us": 1e6, "ns": 1e9}
    if t_unit not in scales:
        raise ValueError(f"t_unit must be one of {list(scales)}")
    ts = np.asarray(t) * scales[t_unit]

    def _color(i: int, lbl: str):
        if colors is None:
            return None
        if isinstance(colors, dict):
            return colors.get(lbl)
        return colors[i] if i < len(colors) else None

    if isinstance(populations, dict):
        for i, (lbl, pop) in enumerate(populations.items()):
            ax.plot(ts, pop, label=lbl, color=_color(i, lbl), **kwargs)
    else:
        pops = np.asarray(populations)
        if pops.ndim == 1:
            pops = pops[np.newaxis, :]
        for i, pop in enumerate(pops):
            lbl = labels[i] if labels is not None else f"level {i}"
            ax.plot(ts, pop, label=lbl, color=_color(i, lbl), **kwargs)
    ax.set_xlabel(f"t ({t_unit})")
    ax.set_ylabel("population")


def aggregate_by_group(
    populations: np.ndarray, groups: Sequence[LevelGroup]
) -> Dict[str, np.ndarray]:
    """Return ``{group.label: Σ_{mF} N(t)}`` for each group."""
    out: Dict[str, np.ndarray] = {}
    for g in groups:
        out[g.label] = populations[g.level_indices, :].sum(axis=0)
    return out
