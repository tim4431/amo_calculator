"""Minimal confocal cavity example with outgoing-beam visualization."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from core.cavity_mode import OpticalAxis
from src.cavity_mode_visualization import ElementDrawSpec, plot_cavity_mode


def main() -> None:
    wavelength = 1064e-9
    cavity_length = 80e-3
    mirror_radius = cavity_length

    axis = OpticalAxis(default_refractive_index=1.0)

    m1 = axis.add_curved_surface(
        position=0.0,
        radius=mirror_radius,
        label="M1",
        transmission=0.05,
        reflection=0.95,
    )
    m2 = axis.add_curved_surface(
        position=cavity_length,
        radius=-mirror_radius,
        label="M2",
        transmission=0.05,
        reflection=0.95,
    )

    mode = axis.solve_cavity_mode(wavelength, m1, m2)

    print("Confocal cavity:")
    print(f"  wavelength    = {wavelength:.3e} m")
    print(f"  cavity length = {cavity_length:.3e} m")
    print(f"  mirror radius = {mirror_radius:.3e} m")
    print()

    print("Solved q-parameters:")
    print(f"  q_left  = {mode.q_left}")
    print(f"  q_right = {mode.q_right}")
    print()

    print("Mode summary:")
    print(f"  waist radius   = {mode.waist_radius:.6e} m")
    print(f"  waist position = {mode.waist_position:.6e} m")
    print(f"  Rayleigh range = {mode.rayleigh_range:.6e} m")
    print()

    center_beam = mode.beam_at(cavity_length / 2, branch="inside")
    print("Beam at cavity center:")
    print(f"  spot size           = {center_beam.spot_size:.6e} m")
    print(f"  radius of curvature = {center_beam.radius_of_curvature}")
    print()

    print("Output coupling:")
    print(f"  left-side transmission  = {mode.left_path.cumulative_coefficient:.3f}")
    print(f"  right-side transmission = {mode.right_path.cumulative_coefficient:.3f}")

    figure_path = Path(__file__).with_name("cavity_mode_minimal.png")
    plot_cavity_mode(
        mode,
        element_specs=[
            ElementDrawSpec(ref=m1, kind="curved_surface", radius=mirror_radius),
            ElementDrawSpec(ref=m2, kind="curved_surface", radius=-mirror_radius),
        ],
        output_path=figure_path,
        output_length=0.5 * cavity_length,
        show=True,
    )

    print()
    print(f"Saved plot to: {figure_path}")


if __name__ == "__main__":
    main()
