"""Matplotlib helpers for 2D Gaussian-beam cavity visualization."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Polygon

from .cavity_mode import CavityModeSolution, ElementReference
from .gaussian_beam import GaussianBeam


@dataclass(frozen=True)
class ElementDrawSpec:
    """Minimal drawing metadata for a cavity element."""

    ref: ElementReference
    kind: str
    radius: float | None = None


def _sample_gaussian_segment(q0: complex, length: float, num_points: int = 10) -> np.ndarray:
    """Generate sampling points along one Gaussian-beam segment, dense near the waist."""
    if length <= 0:
        return np.array([0.0], dtype=float)

    z_to_waist = -float(GaussianBeam.distance_to_waist(q0))
    linear_samples = np.linspace(0.0, length, max(2, num_points), dtype=float)

    if z_to_waist < 0 or z_to_waist > length:
        return linear_samples

    zr = float(GaussianBeam.rayleigh_range(q0))
    waist_samples = z_to_waist + zr * np.array([-2.0, -1.0, 0.0, 1.0, 2.0], dtype=float)
    waist_samples = waist_samples[(waist_samples >= 0.0) & (waist_samples <= length)]
    return np.unique(np.sort(np.concatenate([linear_samples, waist_samples, [0.0, length]])))


def _sample_propagation(
    q0: complex,
    start_position: float,
    length: float,
    direction: int,
    wavelength: float,
    refractive_index: float,
    num_points: int = 10,
) -> tuple[np.ndarray, np.ndarray]:
    """Sample positions and spot sizes along one propagation segment."""
    t = _sample_gaussian_segment(q0, length, num_points=num_points)
    q_waist = 1j * GaussianBeam.rayleigh_range(q0)
    z_from_waist = GaussianBeam.distance_to_waist(q0) + t
    spot_size = GaussianBeam.spot_size(
        q_waist,
        z_from_waist,
        wavelength,
        refractive_index,
    )
    position = start_position + direction * t
    return np.asarray(position, dtype=float), np.asarray(spot_size, dtype=float)


def _sample_path(path, num_points_per_segment: int = 10) -> tuple[np.ndarray, np.ndarray]:
    """Sample a propagation path, using denser points near each local waist."""
    start = path.start_beam
    positions = [start.position]
    spot_sizes = [start.spot_size]

    for step in path.steps:
        if step.kind == "propagation" and step.physical_length > 0:
            z, w = _sample_propagation(
                q0=step.q_in,
                start_position=step.position_in,
                length=step.physical_length,
                direction=step.direction,
                wavelength=path.wavelength,
                refractive_index=step.index_in,
                num_points=num_points_per_segment,
            )
            positions.extend(z[1:].tolist())
            spot_sizes.extend(w[1:].tolist())
        else:
            positions.append(step.beam_out.position)
            spot_sizes.append(step.beam_out.spot_size)

    return np.asarray(positions, dtype=float), np.asarray(spot_sizes, dtype=float)


def _sample_output_extension(
    path,
    propagation_length: float,
    num_points_per_segment: int = 10,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Extend a transmitted branch into free space beyond the last defined element."""
    if propagation_length <= 0 or path.cumulative_coefficient <= 0:
        return None

    end_beam = path.end_beam
    return _sample_propagation(
        q0=end_beam.q,
        start_position=end_beam.position,
        length=propagation_length,
        direction=path.direction,
        wavelength=path.wavelength,
        refractive_index=end_beam.refractive_index,
        num_points=num_points_per_segment,
    )


def _plot_envelope(ax, positions_m, spot_sizes_m, color: str, label: str, linestyle: str = "-") -> None:
    positions_mm = 1e3 * np.asarray(positions_m, dtype=float)
    spot_sizes_um = 1e6 * np.asarray(spot_sizes_m, dtype=float)
    ax.plot(positions_mm, spot_sizes_um, color=color, lw=2.3, ls=linestyle, label=label, zorder=2)
    ax.plot(positions_mm, -spot_sizes_um, color=color, lw=2.3, ls=linestyle, zorder=2)


def _draw_element(ax, spec: ElementDrawSpec, height_um: float) -> None:
    position_mm = 1e3 * spec.ref.position
    y_um = np.linspace(-height_um, height_um, 400)

    if spec.kind == "plane_surface":
        x_mm = np.full_like(y_um, position_mm)
        ax.plot(x_mm, y_um, color="#334155", lw=2.2, zorder=4)
    elif spec.kind == "curved_surface" and spec.radius is not None:
        aperture_um = height_um
        y_um = np.linspace(-aperture_um, aperture_um, 400)
        normalized = y_um / aperture_um
        curve_depth_mm = 1.1
        # Keep the vertex on-axis at the element position and displace the edge
        # of the aperture toward the center-of-curvature side. This preserves
        # the curvature sign while remaining visible on a beam-envelope plot
        # whose vertical scale is in um.
        x_mm = position_mm + np.sign(spec.radius) * curve_depth_mm * normalized**2
        ax.plot(x_mm, y_um, color="#334155", lw=2.2, zorder=4)
    elif spec.kind == "lens":
        width_mm = 1.8
        lens_height_um = 0.9 * height_um
        patch = Polygon(
            np.array(
                [
                    [position_mm - width_mm / 2, 0.0],
                    [position_mm, lens_height_um],
                    [position_mm + width_mm / 2, 0.0],
                    [position_mm, -lens_height_um],
                ]
            ),
            closed=True,
            facecolor="#cfe8ff",
            edgecolor="#1d4ed8",
            lw=1.8,
            alpha=0.9,
            zorder=4,
        )
        ax.add_patch(patch)
    else:
        ax.axvline(position_mm, color="#334155", lw=2.0, zorder=4)

    ax.text(
        position_mm,
        1.03 * height_um,
        spec.ref.label,
        rotation=90,
        va="bottom",
        ha="center",
        fontsize=9,
        color="#334155",
    )


def plot_cavity_mode(
    mode: CavityModeSolution,
    element_specs: list[ElementDrawSpec],
    output_path: str | Path | None = None,
    output_length: float | None = None,
    num_points_per_segment: int = 12,
    show: bool = True,
) -> tuple[plt.Figure, plt.Axes]:
    """Plot the intracavity mode and the outgoing transmitted beams."""
    cavity_length = mode.right_endpoint.position - mode.left_endpoint.position
    if output_length is None:
        output_length = 0.5 * cavity_length

    inside_positions, inside_spots = _sample_path(
        mode.inside_path,
        num_points_per_segment=num_points_per_segment,
    )
    left_output = _sample_output_extension(
        mode.left_path,
        propagation_length=output_length,
        num_points_per_segment=num_points_per_segment,
    )
    right_output = _sample_output_extension(
        mode.right_path,
        propagation_length=output_length,
        num_points_per_segment=num_points_per_segment,
    )

    ymax_um = 1.15 * max(
        [1e6 * np.max(inside_spots)]
        + (
            [1e6 * np.max(left_output[1])] if left_output is not None else []
        )
        + (
            [1e6 * np.max(right_output[1])] if right_output is not None else []
        )
    )

    fig, ax = plt.subplots(figsize=(10, 5))
    _plot_envelope(ax, inside_positions, inside_spots, color="#005f73", label="Inside cavity mode")

    if left_output is not None:
        _plot_envelope(
            ax,
            left_output[0],
            left_output[1],
            color="#bb3e03",
            label="Outgoing beams",
            linestyle="--",
        )

    if right_output is not None:
        _plot_envelope(
            ax,
            right_output[0],
            right_output[1],
            color="#bb3e03",
            label="_nolegend_",
            linestyle="--",
        )

    for spec in element_specs:
        _draw_element(ax, spec, height_um=0.92 * ymax_um)

    waist_x_mm = 1e3 * mode.waist_position
    ax.scatter(
        [waist_x_mm],
        [0.0],
        color="black",
        s=32,
        zorder=5,
        label="Waist",
    )
    ax.annotate(
        "Waist",
        xy=(waist_x_mm, 0.0),
        xytext=(6, 10),
        textcoords="offset points",
        fontsize=9,
        color="black",
    )

    ax.set_title("Confocal Cavity Mode And Outgoing Beams")
    ax.set_xlabel("Axis Position [mm]")
    ax.set_ylabel("Beam Radius [um]")
    ax.set_ylim(-1.18 * ymax_um, 1.18 * ymax_um)
    ax.grid(True, alpha=0.25)
    ax.legend(loc="upper right")
    fig.tight_layout()

    if output_path is not None:
        fig.savefig(output_path, dpi=180, bbox_inches="tight")
    if show:
        plt.show()

    return fig, ax


__all__ = ["ElementDrawSpec", "plot_cavity_mode"]
