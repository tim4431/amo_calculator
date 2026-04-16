"""Browser wrapper for the external marimo app link."""

from __future__ import annotations

from typing import Any

from ..base import CalculatorDefinition


class MarimoCalculator(CalculatorDefinition):
    """External-link app entry for the hosted marimo workspace."""

    calculator_id = "marimo"
    title = "marimo"
    description = "Open the hosted marimo app in a separate tab."
    layout = "external_link"
    tab_url = "https://amo_calculator.xwtim.com"
    open_in_new_tab = True

    def schema(self) -> dict[str, Any]:
        return {
            "id": self.calculator_id,
            "title": self.title,
            "description": self.description,
            "layout": self.layout,
            "default_state": {},
            "external_url": self.tab_url,
            "call_to_action": "Open marimo",
        }

    def evaluate(self, state: dict[str, Any]) -> dict[str, Any]:
        return {
            "ok": True,
            "error": None,
            "warnings": [],
            "normalized_state": state or {},
            "summary_cards": [],
            "plot_metrics": [],
            "plot": {
                "external_url": self.tab_url,
                "call_to_action": "Open marimo",
            },
            "scene": {},
        }


__all__ = ["MarimoCalculator"]
