"""Transmitted power of a decentered Gaussian beam through a circular aperture."""

from __future__ import annotations

from functools import lru_cache

import numpy as np
from scipy.integrate import quad
from scipy.special import i0


@lru_cache(maxsize=1024)
def _power_inside_cached(diameter: float, waist_radius: float, displacement: float) -> float:
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


def power_inside(diameter: float, waist_radius: float, displacement: float) -> float:
    return _power_inside_cached(
        float(diameter),
        float(waist_radius),
        abs(float(displacement)),
    )


def power_loss(diameter: float, waist_radius: float, displacement: float) -> float:
    return 1.0 - power_inside(diameter, waist_radius, displacement)


@lru_cache(maxsize=128)
def _power_loss_curve_cached(
    diameter: float,
    waist_radius: float,
    sample_count: int,
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    if waist_radius <= 0.0 or diameter <= 0.0:
        return ((0.0, 0.0), (1.0, 1.0))

    displacements = tuple(
        float(value)
        for value in np.linspace(0.0, waist_radius, max(2, int(sample_count)), dtype=float)
    )
    losses = tuple(
        float(power_loss(diameter, waist_radius, displacement))
        for displacement in displacements
    )
    return displacements, losses


def power_loss_curve(
    diameter: float,
    waist_radius: float,
    sample_count: int = 61,
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Power-loss curve for a fixed aperture and beam waist over 0 <= x <= w."""
    return _power_loss_curve_cached(float(diameter), float(waist_radius), int(sample_count))


__all__ = ["power_inside", "power_loss", "power_loss_curve"]
