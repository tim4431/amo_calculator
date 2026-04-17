"""Rb-85 D2 pump/repump rate-equation example with a bias B field.

Ground 5S_{1/2}: F=2 (mF=-2..+2) and F=3 (mF=-3..+3).
Excited 5P_{3/2}: F'=2, F'=3, F'=4.

A magnetic field along the quantization axis lifts the mF degeneracy via a
linear Zeeman shift g_F μ_B B mF. Laser frequencies are expressed as
detunings from the (F, mF=0) → (F', mF=0) transition using
``resonance_frequency``.

Pump:   F=3 → F'=3, σ+, δ=0
Repump: F=2 → F'=3, σ+, δ=0

Two initial-state scenarios are shown:
  (1) MOT-like — atoms start uniformly over F=3 ground sublevels.
  (2) Optically pumped — all atoms start in F=3, mF=0.

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
    initial_state_pumped,
    level_colors,
    plot_level_diagram,
    plot_populations,
    resonance_frequency,
)

GAMMA_D2 = 2 * np.pi * 6.0666e6  # rad/s
I_SAT_D2 = 16.693                # W/m²
B_FIELD_T = 5e-4                 # 5 G bias field along quantization axis

atom = Rubidium85()

# ---------------------------------------------------------------------------
# 1. Sublevels and groups from ARC (HFS + Zeeman)
# ---------------------------------------------------------------------------
ground_levels, ground_groups = build_hfs_levels(
    atom, n=5, l=0, j=0.5, F_values=[2, 3],
    zero_energy_Hz=0.0, B_field_T=B_FIELD_T,
)
nu_fine = atom.getTransitionFrequency(5, 0, 0.5, 5, 1, 1.5)
excited_levels, excited_groups = build_hfs_levels(
    atom, n=5, l=1, j=1.5, F_values=[2, 3, 4],
    zero_energy_Hz=nu_fine, prime=True,
    start_index=len(ground_levels), B_field_T=B_FIELD_T,
)
levels = ground_levels + excited_levels
groups = ground_groups + excited_groups
print(f"Total sublevels: {len(levels)} (ground=12, excited=21)")
for g in groups:
    max_shift_Hz = max(abs(E - g.energy_Hz) for E in g.mF_energies_Hz)
    print(f"  {g.label}: g_F = {g.g_F:+.4f}, "
          f"max |Zeeman shift| = {max_shift_Hz / 1e6:.2f} MHz")

# ---------------------------------------------------------------------------
# 2. Dipole matrix and solver
# ---------------------------------------------------------------------------
dipole = build_dipole_matrix(atom, ground=(5, 0, 0.5), excited=(5, 1, 1.5),
                             groups=groups, n_levels=len(levels))
solver = RateEquationSolver(levels, dipole)
err_max = np.max(np.abs(solver.total_decay()[[i for g in excited_groups
                                              for i in g.level_indices]]
                        / GAMMA_D2 - 1.0))
print(f"Max |Γ_e / Γ_D2 - 1| = {err_max:.2e}")

# ---------------------------------------------------------------------------
# 3. Lasers — frequencies specified as detuning from (F, mF=0) ↔ (F', mF=0)
# ---------------------------------------------------------------------------
pump = Laser(
    "pump",
    resonance_frequency(groups, ground_F=3, excited_F=3, detuning_Hz=0.0),
    1.0 * I_SAT_D2,
    {+1: 1.0},
)
repump = Laser(
    "repump",
    resonance_frequency(groups, ground_F=2, excited_F=3, detuning_Hz=0.0),
    0.1 * I_SAT_D2,
    {+1: 1.0},
)
solver.add_laser(pump)
solver.add_laser(repump)

# ---------------------------------------------------------------------------
# 4. Two initial-state scenarios
# ---------------------------------------------------------------------------
t_eval = np.linspace(0.0, 20e-6, 400)
sol_mot    = solver.solve(initial_state_mot(groups, F=3),           t_eval)
sol_pumped = solver.solve(initial_state_pumped(groups, F=3, mF=0),  t_eval)

# ---------------------------------------------------------------------------
# 5. Consistent color scheme + mF-resolved plots
# ---------------------------------------------------------------------------
colors = level_colors(groups)
ground_indices = [i for g in ground_groups for i in g.level_indices]
ground_labels = [levels[i].label for i in ground_indices]
ground_color_list = [colors[i] for i in ground_indices]

fig = plt.figure(figsize=(15, 8))
gs = fig.add_gridspec(2, 2, width_ratios=[1.3, 1])

ax_diagram = fig.add_subplot(gs[:, 0])
plot_level_diagram(ax_diagram, groups, lasers=[pump, repump],
                   level_color_map=colors)
ax_diagram.set_title(f"Rb-85 D2 level diagram  (B = {B_FIELD_T*1e4:.1f} G, not to scale)")

ax_mot = fig.add_subplot(gs[0, 1])
plot_populations(ax_mot, t_eval, sol_mot.y[ground_indices],
                 labels=ground_labels, colors=ground_color_list)
ax_mot.set_title("MOT init (uniform over F=3)")
ax_mot.legend(fontsize=7, ncol=2, loc="center right")

ax_pumped = fig.add_subplot(gs[1, 1], sharex=ax_mot)
plot_populations(ax_pumped, t_eval, sol_pumped.y[ground_indices],
                 labels=ground_labels, colors=ground_color_list)
ax_pumped.set_title("Pumped init (F=3, mF=0)")
ax_pumped.legend(fontsize=7, ncol=2, loc="center right")

plt.tight_layout()
out_path = os.path.join(os.path.dirname(__file__), "rubidium_85_pump_repump.png")
plt.savefig(out_path, dpi=120)
print(f"Saved plot to {out_path}")

# ---------------------------------------------------------------------------
# 6. Steady-state check
# ---------------------------------------------------------------------------
ss = solver.steady_state()
stretched = next(i for g in ground_groups if g.F == 3
                 for mF, i in zip(g.mF_values, g.level_indices) if mF == 3)
print(f"Steady-state population in F=3, mF=+3 (stretched): {ss[stretched]:.4f}")
