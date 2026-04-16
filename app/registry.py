"""Unified registry for browser-side calculators."""

from __future__ import annotations

import json
from importlib import import_module
from typing import Any

from .base import CalculatorDefinition, to_serializable


COMMON_BROWSER_PYTHON_FILES: list[str] = [
    "core/__init__.py",
    "app/__init__.py",
    "app/base.py",
    "app/registry.py",
    "app/calculators/__init__.py",
]


CALCULATOR_SPECS: dict[str, dict[str, Any]] = {
    "cavity-mode": {
        "id": "cavity-mode",
        "title": "Cavity Mode",
        "description": "Build a 1D cavity, reorder elements, edit sectors, and inspect the intracavity mode.",
        "layout": "optical_axis",
        "module": "app.calculators.cavity_mode",
        "class_name": "CavityModeCalculator",
        "python_files": [
            "core/cavity_mode.py",
            "core/gaussian_beam.py",
            "app/calculators/cavity_mode.py",
        ],
    },
    "gaussian-beam": {
        "id": "gaussian-beam",
        "title": "Gaussian Beam",
        "description": "Inspect spot size evolution from a waist in a uniform medium.",
        "layout": "simple_form",
        "module": "app.calculators.gaussian_beam",
        "class_name": "GaussianBeamCalculator",
        "python_files": [
            "core/gaussian_beam.py",
            "app/calculators/gaussian_beam.py",
        ],
    },
}


CALCULATOR_BROWSER_PYTHON_FILES: dict[str, list[str]] = {
    calculator_id: list(spec["python_files"])
    for calculator_id, spec in CALCULATOR_SPECS.items()
}


def _flatten_browser_python_files() -> list[str]:
    ordered_files = list(COMMON_BROWSER_PYTHON_FILES)
    for python_files in CALCULATOR_BROWSER_PYTHON_FILES.values():
        for relative_path in python_files:
            if relative_path not in ordered_files:
                ordered_files.append(relative_path)
    return ordered_files


BROWSER_PYTHON_FILES: list[str] = _flatten_browser_python_files()

_CALCULATOR_CACHE: dict[str, CalculatorDefinition] = {}


def _manifest_from_spec(spec: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": spec["id"],
        "title": spec["title"],
        "description": spec["description"],
        "layout": spec["layout"],
    }


def _get_spec(calculator_id: str) -> dict[str, Any]:
    try:
        return CALCULATOR_SPECS[calculator_id]
    except KeyError as exc:
        known = ", ".join(sorted(CALCULATOR_SPECS))
        raise ValueError(f"Unknown calculator {calculator_id!r}. Known calculators: {known}.") from exc


def _instantiate_calculator(calculator_id: str) -> CalculatorDefinition:
    cached = _CALCULATOR_CACHE.get(calculator_id)
    if cached is not None:
        return cached

    spec = _get_spec(calculator_id)
    module = import_module(spec["module"])
    calculator_class = getattr(module, spec["class_name"])
    calculator = calculator_class()
    _CALCULATOR_CACHE[calculator_id] = calculator
    return calculator


def list_calculators() -> list[dict[str, Any]]:
    return [_manifest_from_spec(spec) for spec in CALCULATOR_SPECS.values()]


def get_calculator_schema(calculator_id: str) -> dict[str, Any]:
    return _instantiate_calculator(calculator_id).schema()


def run_calculator(calculator_id: str, state: dict[str, Any] | None) -> dict[str, Any]:
    return _instantiate_calculator(calculator_id).evaluate(state or {})


def browser_python_manifest() -> dict[str, Any]:
    return {
        "common_python_files": list(COMMON_BROWSER_PYTHON_FILES),
        "calculator_python_files": {
            calculator_id: list(python_files)
            for calculator_id, python_files in CALCULATOR_BROWSER_PYTHON_FILES.items()
        },
        "python_files": list(BROWSER_PYTHON_FILES),
    }


def list_calculators_json() -> str:
    return json.dumps(to_serializable(list_calculators()))


def get_calculator_schema_json(calculator_id: str) -> str:
    return json.dumps(to_serializable(get_calculator_schema(calculator_id)))


def run_calculator_json(calculator_id: str, state_json: str) -> str:
    state = json.loads(state_json) if state_json else {}
    return json.dumps(to_serializable(run_calculator(calculator_id, state)))


__all__ = [
    "BROWSER_PYTHON_FILES",
    "CALCULATOR_BROWSER_PYTHON_FILES",
    "CALCULATOR_SPECS",
    "COMMON_BROWSER_PYTHON_FILES",
    "browser_python_manifest",
    "get_calculator_schema",
    "get_calculator_schema_json",
    "list_calculators",
    "list_calculators_json",
    "run_calculator",
    "run_calculator_json",
]
