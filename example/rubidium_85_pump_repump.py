"""Rb-85 D2 pump/repump rate-equation example with a bias B field.

Ground 5S_{1/2}: F=2 (mF=-2..+2) and F=3 (mF=-3..+3).
Excited 5P_{3/2}: F'=2, F'=3, F'=4.

A magnetic field along the quantization axis lifts the mF degeneracy via a
linear Zeeman shift g_F μ_B B mF. Laser frequencies are expressed as
detunings from the (F, mF=0) → (F', mF=0) transition using
``resonance_frequency``.

Pump:   F=3 → F'=3, σ+, δ=0
Repump: F=2 → F'=3, σ+, δ=0

Two ground-state views are shown:
  (1) Time dynamics from a MOT-like init (atoms uniform over F=3).
  (2) Steady-state sublevel populations vs pump detuning.

Populations are resolved by mF, colored to match the level diagram.
"""

from __future__ import annotations

import os
import sys

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from arc import Rubidium85

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.rate_equ import (  # noqa: E402
    Laser,
    RateEquationSolver,
    build_dipole_matrix,
    build_hfs_levels,
    initial_state_mot,
    resonance_frequency,
)
from core.rate_equ_visualization import (  # noqa: E402
    level_colors,
    plot_level_diagram,
    plot_populations,
)

B_FIELD_T = 10e-4  # 10 G bias field along quantization axis

atom = Rubidium85()

# Fine-structure states on the D2 line: 5S_{1/2} ground, 5P_{3/2} excited.
GROUND = (5, 0, 0.5)
EXCITED = (5, 1, 1.5)
# Stretched σ+ cycling transition — fixes the I_sat reference.
CYCLING_Fg, CYCLING_mFg, CYCLING_Fe, CYCLING_mFe, CYCLING_q = 3, 3, 4, 4, +1

# D2-line constants from ARC: natural linewidth Γ = 1/τ(5P_{3/2}) and the
# stretched-state σ+ saturation intensity (canonical "I_sat_D2" reference).
GAMMA_D2 = atom.getTransitionRate(*EXCITED, *GROUND)
I_SAT_D2 = atom.getSaturationIntensity(
    *GROUND,
    CYCLING_Fg,
    CYCLING_mFg,
    *EXCITED,
    CYCLING_Fe,
    CYCLING_mFe,
    CYCLING_q,
)

# ---------------------------------------------------------------------------
# 1. Sublevels and groups from ARC (HFS + Zeeman)
# ---------------------------------------------------------------------------
ground_levels, ground_groups = build_hfs_levels(
    atom,
    *GROUND,
    F_values=[2, 3],
    zero_energy_Hz=0.0,
    B_field_T=B_FIELD_T,
)
nu_fine = atom.getTransitionFrequency(*GROUND, *EXCITED)
excited_levels, excited_groups = build_hfs_levels(
    atom,
    *EXCITED,
    F_values=[2, 3, 4],
    zero_energy_Hz=nu_fine,
    prime=True,
    start_index=len(ground_levels),
    B_field_T=B_FIELD_T,
)
levels = ground_levels + excited_levels
groups = ground_groups + excited_groups
print(f"Total sublevels: {len(levels)}")
for g in groups:
    max_shift_Hz = max(abs(E - g.energy_Hz) for E in g.mF_energies_Hz)
    print(
        f"  {g.label}: g_F = {g.g_F:+.4f}, "
        f"max |Zeeman shift| = {max_shift_Hz / 1e6:.2f} MHz"
    )

# ---------------------------------------------------------------------------
# 2. Dipole matrix and solver — (n, l, j) are pulled from each LevelGroup.
# ---------------------------------------------------------------------------
dipole = build_dipole_matrix(atom, groups)
solver = RateEquationSolver(levels, dipole)
err_max = np.max(
    np.abs(
        solver.total_decay()[[i for g in excited_groups for i in g.level_indices]]
        / GAMMA_D2
        - 1.0
    )
)
print(f"Max |Γ_e / Γ_D2 - 1| = {err_max:.2e}")

# ---------------------------------------------------------------------------
# 3. Lasers — frequencies specified as detuning from (F, mF=0) ↔ (F', mF=0)
# ---------------------------------------------------------------------------
pump = Laser(
    "pump",
    resonance_frequency(groups, Fg=3, Fe=3, detuning_Hz=0),
    100 * I_SAT_D2,
    {+1: 1.0, -1: 0.1},
)
repump = Laser(
    "repump",
    resonance_frequency(groups, Fg=2, Fe=3, detuning_Hz=0),
    20 * I_SAT_D2,
    {+1: 1.0},
)
solver.add_laser(pump)
solver.add_laser(repump)

# ---------------------------------------------------------------------------
# 4. MOT-like initial state — time dynamics
# ---------------------------------------------------------------------------
t_eval = np.linspace(0.0, 20e-6, 1000)
sol_mot = solver.solve(initial_state_mot(groups, F=3), t_eval)

# ---------------------------------------------------------------------------
# 5. Steady-state population scan vs pump detuning
# ---------------------------------------------------------------------------
pump_f0 = pump.frequency_Hz
detunings = np.linspace(-30e6, 30e6, 121)
pops_vs_det = solver.sweep_steady_state(
    lambda d: setattr(pump, "frequency_Hz", pump_f0 + d),
    detunings,
)  # shape (N_det, N_levels)
pump.frequency_Hz = pump_f0  # restore

# ---------------------------------------------------------------------------
# 6. Consistent color scheme + plots
# ---------------------------------------------------------------------------
colors = level_colors(groups)
ground_indices = [i for g in ground_groups for i in g.level_indices]
ground_labels = [levels[i].label for i in ground_indices]
ground_color_list = [colors[i] for i in ground_indices]

fig = plt.figure(figsize=(15, 8))
gs = fig.add_gridspec(2, 2, width_ratios=[1.3, 1])

ax_diagram = fig.add_subplot(gs[:, 0])
plot_level_diagram(ax_diagram, groups, lasers=[pump, repump], level_color_map=colors)
ax_diagram.set_title(
    f"Rb-85 D2 level diagram  (B = {B_FIELD_T*1e4:.1f} G, not to scale)"
)

ax_mot = fig.add_subplot(gs[0, 1])
plot_populations(
    ax_mot,
    t_eval,
    sol_mot.y[ground_indices],
    labels=ground_labels,
    colors=ground_color_list,
)
ax_mot.set_title("MOT init (uniform over F=3)")
ax_mot.legend(fontsize=7, ncol=2, loc="center right")

ax_scan = fig.add_subplot(gs[1, 1])
for idx, lbl, c in zip(ground_indices, ground_labels, ground_color_list):
    ax_scan.plot(detunings / 1e6, pops_vs_det[:, idx], label=lbl, color=c)
ax_scan.set_xlabel("pump detuning (MHz)")
ax_scan.set_ylabel("steady-state population")
ax_scan.set_title("Steady state vs pump detuning (repump on resonance)")
ax_scan.legend(fontsize=7, ncol=2, loc="center right")
ax_scan.grid(True, alpha=0.3)

plt.tight_layout()
out_path = os.path.join(os.path.dirname(__file__), "rubidium_85_pump_repump.png")
plt.savefig(out_path, dpi=120)
print(f"Saved plot to {out_path}")

# ---------------------------------------------------------------------------
# 7. Steady-state check at the nominal pump detuning
# ---------------------------------------------------------------------------
ss = solver.steady_state()
stretched = next(
    i
    for g in ground_groups
    if g.F == 3
    for mF, i in zip(g.mF_values, g.level_indices)
    if mF == 3
)
print(f"Steady-state population in F=3, mF=+3 (stretched): {ss[stretched]:.4f}")
print(
    f"Steady-state photon scattering rate: {solver.photon_scattering_rate(ss)/1e6:.3f} × 10^6 s^-1"
)
R_vs_det = np.array([solver.photon_scattering_rate(p) for p in pops_vs_det])
print(
    f"Peak scattering over scan: {R_vs_det.max()/1e6:.3f} × 10^6 s^-1 at Δ = {detunings[R_vs_det.argmax()]/1e6:+.2f} MHz"
)
