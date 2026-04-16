"""Browser wrapper for the decentered-Gaussian clipping calculator."""

from __future__ import annotations

import copy
from typing import Any

from core.gaussian_clipping import power_inside, power_loss_curve

from ..base import CalculatorDefinition, positive_float, safe_float


_DEFAULT_STATE: dict[str, Any] = {
    "globals": {
        "diameter_um": 200.0,
        "waist_radius_um": 80.0,
        "displacement_um": 0.0,
    }
}
_LOSS_CURVE_SAMPLES = 61


class GaussianClippingCalculator(CalculatorDefinition):
    """Compute the fraction of a decentered Gaussian beam clipped by a circular aperture."""

    calculator_id = "gaussian-clipping"
    title = "Gaussian Clipping"
    description = "Power of a decentered Gaussian beam transmitted through a circular aperture."
    layout = "gaussian_clipping"

    def schema(self) -> dict[str, Any]:
        return {
            "id": self.calculator_id,
            "title": self.title,
            "description": self.description,
            "layout": self.layout,
            "default_state": copy.deepcopy(_DEFAULT_STATE),
            "global_fields": [
                {
                    "path": "globals.diameter_um",
                    "label": "Mirror diameter D",
                    "type": "range_number",
                    "min": 1.0,
                    "max": 2000.0,
                    "step": 1.0,
                    "unit": "um",
                },
                {
                    "path": "globals.waist_radius_um",
                    "label": "Waist radius w",
                    "type": "range_number",
                    "min": 1.0,
                    "max": 1000.0,
                    "step": 1.0,
                    "unit": "um",
                },
                {
                    "path": "globals.displacement_um",
                    "label": "Displacement x",
                    "type": "range_number",
                    "min": 0.0,
                    "max": 1000.0,
                    "step": 1.0,
                    "unit": "um",
                },
            ],
        }

    def evaluate(self, state: dict[str, Any]) -> dict[str, Any]:
        globals_state = dict(_DEFAULT_STATE["globals"])
        globals_state.update(state.get("globals", {}))

        diameter = positive_float(globals_state.get("diameter_um"), 200.0)
        waist = positive_float(globals_state.get("waist_radius_um"), 80.0)
        displacement = max(0.0, safe_float(globals_state.get("displacement_um"), 0.0))

        fraction_inside = power_inside(diameter, waist, displacement)
        fraction_outside = 1.0 - fraction_inside
        curve_x, curve_loss = power_loss_curve(diameter, waist, _LOSS_CURVE_SAMPLES)

        plot_metrics = [
            {"label": "Power inside D", "value": f"{100.0 * fraction_inside:.4f} %"},
            {"label": "Power outside D", "value": f"{100.0 * fraction_outside:.4f} %"},
            {"label": "D / w", "value": f"{diameter / waist:.3f}"},
            {"label": "x / w", "value": f"{displacement / waist:.3f}"},
        ]
        plot = {
            "loss_curve": {
                "x_um": list(curve_x),
                "loss_percent": [100.0 * value for value in curve_loss],
                "x_axis_title": "Displacement x [um]",
                "y_axis_title": "Power loss [%]",
                "max_displacement_um": waist,
                "current_point": {
                    "visible": displacement <= waist,
                    "x_um": displacement,
                    "loss_percent": 100.0 * fraction_outside,
                },
            }
        }

        normalized = {
            "globals": {
                "diameter_um": diameter,
                "waist_radius_um": waist,
                "displacement_um": displacement,
            }
        }

        return {
            "ok": True,
            "error": None,
            "warnings": [],
            "normalized_state": normalized,
            "plot": plot,
            "plot_metrics": plot_metrics,
            "summary_cards": [],
        }


__all__ = ["GaussianClippingCalculator"]
