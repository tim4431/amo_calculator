"""Browser wrapper for a simple Gaussian-beam calculator."""

from __future__ import annotations

import copy
from typing import Any

import numpy as np

from core.gaussian_beam import GaussianBeam

from ..base import CalculatorDefinition, positive_float


_DEFAULT_STATE: dict[str, Any] = {
    "globals": {
        "waist_radius_um": 50.0,
        "wavelength_nm": 1064.0,
        "refractive_index": 1.0,
        "z_extent_mm": 80.0,
    }
}


class GaussianBeamCalculator(CalculatorDefinition):
    """Simple beam-propagation calculator used to demonstrate multi-tab support."""

    calculator_id = "gaussian-beam"
    title = "Gaussian Beam"
    description = "Inspect spot size evolution from a waist in a uniform medium."
    layout = "simple_form"

    def schema(self) -> dict[str, Any]:
        return {
            "id": self.calculator_id,
            "title": self.title,
            "description": self.description,
            "layout": self.layout,
            "default_state": copy.deepcopy(_DEFAULT_STATE),
            "global_fields": [
                {
                    "path": "globals.waist_radius_um",
                    "label": "Waist radius",
                    "type": "range_number",
                    "min": 1.0,
                    "max": 500.0,
                    "step": 1.0,
                    "unit": "um",
                },
                {
                    "path": "globals.wavelength_nm",
                    "label": "Wavelength",
                    "type": "range_number",
                    "min": 266.0,
                    "max": 2000.0,
                    "step": 1.0,
                    "unit": "nm",
                },
                {
                    "path": "globals.refractive_index",
                    "label": "Refractive index",
                    "type": "range_number",
                    "min": 1.0,
                    "max": 3.0,
                    "step": 0.001,
                    "unit": "",
                },
                {
                    "path": "globals.z_extent_mm",
                    "label": "Half-span",
                    "type": "range_number",
                    "min": 1.0,
                    "max": 300.0,
                    "step": 1.0,
                    "unit": "mm",
                },
            ],
        }

    def evaluate(self, state: dict[str, Any]) -> dict[str, Any]:
        globals_state = dict(_DEFAULT_STATE["globals"])
        globals_state.update(state.get("globals", {}))

        normalized = {
            "globals": {
                "waist_radius_um": positive_float(globals_state.get("waist_radius_um"), 50.0),
                "wavelength_nm": positive_float(globals_state.get("wavelength_nm"), 1064.0),
                "refractive_index": positive_float(globals_state.get("refractive_index"), 1.0),
                "z_extent_mm": positive_float(globals_state.get("z_extent_mm"), 80.0),
            }
        }

        w0 = 1e-6 * normalized["globals"]["waist_radius_um"]
        wavelength = 1e-9 * normalized["globals"]["wavelength_nm"]
        refractive_index = normalized["globals"]["refractive_index"]
        z_extent = 1e-3 * normalized["globals"]["z_extent_mm"]

        q0 = GaussianBeam.q_at_waist(w0, wavelength, refractive_index)
        z = np.linspace(-z_extent, z_extent, 400, dtype=float)
        w = GaussianBeam.spot_size(1j * np.imag(q0), z, wavelength, refractive_index)

        hover_text = [
            (
                "<b>Gaussian beam</b><br>"
                f"z = {1e3 * z_value:.3f} mm<br>"
                f"spot size = {1e6 * w_value:.3f} um<br>"
                f"waist radius = {1e6 * w0:.3f} um<br>"
                f"Rayleigh range = {1e3 * np.imag(q0):.3f} mm<br>"
                f"n = {refractive_index:.4f}"
            )
            for z_value, w_value in zip(z, w)
        ]

        plot = {
            "traces": [
                {
                    "name": "Gaussian beam envelope",
                    "branch": "beam",
                    "color": "#2563eb",
                    "dash": "solid",
                    "x_mm": (1e3 * z).tolist(),
                    "y_um": (1e6 * w).tolist(),
                    "hover_text": hover_text,
                }
            ],
            "elements": [],
            "waist_marker": {"x_mm": 0.0, "y_um": 0.0, "label": "Waist"},
            "y_max_um": 1.15 * float(np.max(1e6 * w)),
            "mirror_y": True,
            "x_axis_title": "Axis Position [mm]",
            "y_axis_title": "Beam Radius [um]",
        }

        summary_cards = [
            {"label": "Waist radius", "value": f"{1e6 * w0:.3f} um"},
            {"label": "Wavelength", "value": f"{1e9 * wavelength:.1f} nm"},
            {"label": "Refractive index", "value": f"{refractive_index:.4f}"},
            {"label": "Rayleigh range", "value": f"{1e3 * np.imag(q0):.3f} mm"},
        ]

        return {
            "ok": True,
            "error": None,
            "warnings": [],
            "normalized_state": normalized,
            "scene": {"elements": [], "gaps": [], "total_length_mm": 2.0 * 1e3 * z_extent},
            "plot": plot,
            "summary_cards": summary_cards,
        }


__all__ = ["GaussianBeamCalculator"]
