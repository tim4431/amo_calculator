"""Gaussian-beam helper functions for complex q-parameter optics."""

from __future__ import annotations

from typing import Union

import numpy as np


class GaussianBeam:
    """Calculation for Gaussian beam q-parameter."""

    @staticmethod
    def q_at_waist(w0: Union[float, np.ndarray], wl: float, n: float = 1):
        """Return ``q`` at beam waist."""
        return (1j * n * np.pi * w0**2) / wl

    @staticmethod
    def q_at_z(qo, z: Union[float, np.ndarray]):
        """Propagate ``q`` by free-space distance ``z``."""
        return qo + z

    @staticmethod
    def distance_to_waist(q: Union[complex, np.ndarray]):
        """Return distance from current point to waist plane."""
        z = np.real(q)
        return z

    @staticmethod
    def waist(q: Union[complex, np.ndarray], wl: float, n: float = 1):
        """Return waist radius implied by complex ``q``."""
        w0 = np.sqrt((wl * np.imag(q)) / (n * np.pi))
        return w0

    @staticmethod
    def rayleigh_range(q: Union[complex, np.ndarray]):
        """Return Rayleigh range from complex ``q``."""
        zr = np.imag(q)
        return zr

    @staticmethod
    def radius_of_curvature(q: Union[complex, np.ndarray]):
        """Return wavefront radius of curvature from complex ``q``."""
        q_array = np.asarray(q, dtype=complex)
        with np.errstate(divide="ignore", invalid="ignore"):
            R = 1.0 / np.real(1.0 / q_array)
        return R

    @staticmethod
    def spot_size(
        qo: Union[complex, np.ndarray],
        z: Union[float, np.ndarray],
        wl: float,
        n: float = 1,
    ):
        """Return beam spot size after propagation distance ``z`` from the waist."""
        q = qo + z
        w = np.sqrt(-wl / (n * np.pi * np.imag(1 / q)))
        return w


__all__ = ["GaussianBeam"]
