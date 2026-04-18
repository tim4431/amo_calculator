"""Visualization helpers for :mod:`core.rate_equ`.

Plotting-only code — level diagrams, population trajectories, and color
schemes shared between the two. Kept in a separate module so the physics
solver itself has no matplotlib dependency.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np

from core.rate_equ import Laser, LevelGroup


_POL_NAME = {-1: "σ⁻", 0: "π", +1: "σ⁺"}

_DEFAULT_GROUP_CMAPS = [
    "Blues",
    "Oranges",
    "Greens",
    "Reds",
    "Purples",
    "YlOrBr",
    "PuRd",
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
            t = (
                t_lo + (t_hi - t_lo) * (i / max(n - 1, 1))
                if n > 1
                else 0.5 * (t_lo + t_hi)
            )
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

    def _y_positions(
        grps: List[LevelGroup], y_lo: float, y_hi: float
    ) -> Dict[int, float]:
        es = np.array([g.energy_Hz for g in grps])
        span = es.max() - es.min() if len(grps) else 0.0
        mid = 0.5 * (y_lo + y_hi)
        if span == 0:
            return {id(g): mid for g in grps}
        return {
            id(g): y_lo + (g.energy_Hz - es.min()) / span * (y_hi - y_lo) for g in grps
        }

    y_map = {
        **_y_positions(ground_groups, *ground_y),
        **_y_positions(excited_groups, *excited_y),
    }

    # Global Zeeman-shift normalization
    max_abs_shift = max(
        (abs(E - g.energy_Hz) for g in groups for E in g.mF_energies_Hz), default=0.0
    )
    zeeman_scale = (zeeman_band / max_abs_shift) if max_abs_shift > 0 else 0.0

    all_mF = [mF for g in groups for mF in g.mF_values]
    mF_min, mF_max = int(min(all_mF)), int(max(all_mF))
    x_min, x_max = mF_min - 1, mF_max + 1.5

    for g in groups:
        y_center = y_map[id(g)]
        for mF, idx, E in zip(g.mF_values, g.level_indices, g.mF_energies_Hz):
            y = y_center + (E - g.energy_Hz) * zeeman_scale
            c = level_color_map[idx] if level_color_map is not None else "black"
            ax.hlines(
                y,
                mF - level_half_width,
                mF + level_half_width,
                colors=[c],
                linewidth=2.0,
            )
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
                color=c,
                fontsize=9,
                ha="left",
                va="center",
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
    ax.tick_params(which="minor", bottom=False)


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


__all__ = [
    "level_colors",
    "plot_level_diagram",
    "plot_populations",
    "aggregate_by_group",
]
