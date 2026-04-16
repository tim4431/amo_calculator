"""Transmitted power of a decentered Gaussian beam through a circular aperture."""

from __future__ import annotations

import numpy as np
from scipy.integrate import quad
from scipy.special import i0


def power_inside(diameter: float, waist_radius: float, displacement: float) -> float:
    """Fraction of total Gaussian power inside a circular aperture.

    Parameters share the same length unit. `waist_radius` is the 1/e² intensity
    radius. `displacement` is the offset between the beam axis and the aperture
    center.
    """
    aperture_radius = 0.5 * float(diameter)
    w = float(waist_radius)
    d = float(displacement)
    if w <= 0.0 or aperture_radius <= 0.0:
        return 0.0

    prefactor = (4.0 / w**2) * np.exp(-2.0 * d**2 / w**2)

    def integrand(r: float) -> float:
        return r * np.exp(-2.0 * r**2 / w**2) * i0(4.0 * r * d / w**2)

    integral, _ = quad(integrand, 0.0, aperture_radius)
    return float(min(1.0, max(0.0, prefactor * integral)))


__all__ = ["power_inside"]
