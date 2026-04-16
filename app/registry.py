"""Unified registry for browser-side calculators."""

from __future__ import annotations

import json
from typing import Any

from .base import CalculatorDefinition, to_serializable
from .calculators import CavityModeCalculator, GaussianBeamCalculator, MarimoCalculator


# Single source of truth for which Python files the browser runtime must load.
# When adding a new calculator, add its core/ and app/calculators/ files here.
BROWSER_PYTHON_FILES: list[str] = [
    "core/__init__.py",
    "core/gaussian_beam.py",
    "core/cavity_mode.py",
    "app/__init__.py",
    "app/base.py",
    "app/registry.py",
    "app/calculators/__init__.py",
    "app/calculators/cavity_mode.py",
    "app/calculators/gaussian_beam.py",
    "app/calculators/marimo.py",
]


CALCULATORS: dict[str, CalculatorDefinition] = {
    calculator.calculator_id: calculator
    for calculator in (
        CavityModeCalculator(),
        GaussianBeamCalculator(),
        MarimoCalculator(),
    )
}


def _get_calculator(calculator_id: str) -> CalculatorDefinition:
    try:
        return CALCULATORS[calculator_id]
    except KeyError as exc:
        known = ", ".join(sorted(CALCULATORS))
        raise ValueError(f"Unknown calculator {calculator_id!r}. Known calculators: {known}.") from exc


def list_calculators() -> list[dict[str, Any]]:
    return [calculator.manifest() for calculator in CALCULATORS.values()]


def get_calculator_schema(calculator_id: str) -> dict[str, Any]:
    calculator = _get_calculator(calculator_id)
    return calculator.schema()


def run_calculator(calculator_id: str, state: dict[str, Any] | None) -> dict[str, Any]:
    calculator = _get_calculator(calculator_id)
    return calculator.evaluate(state or {})


def list_calculators_json() -> str:
    return json.dumps(to_serializable(list_calculators()))


def get_calculator_schema_json(calculator_id: str) -> str:
    return json.dumps(to_serializable(get_calculator_schema(calculator_id)))


def run_calculator_json(calculator_id: str, state_json: str) -> str:
    state = json.loads(state_json) if state_json else {}
    return json.dumps(to_serializable(run_calculator(calculator_id, state)))


__all__ = [
    "BROWSER_PYTHON_FILES",
    "CALCULATORS",
    "get_calculator_schema",
    "get_calculator_schema_json",
    "list_calculators",
    "list_calculators_json",
    "run_calculator",
    "run_calculator_json",
]
