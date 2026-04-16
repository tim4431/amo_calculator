"""Browser-facing calculator registry and wrappers for static deployment."""

from .registry import (
    get_calculator_schema,
    get_calculator_schema_json,
    list_calculators,
    list_calculators_json,
    run_calculator,
    run_calculator_json,
)

__all__ = [
    "get_calculator_schema",
    "get_calculator_schema_json",
    "list_calculators",
    "list_calculators_json",
    "run_calculator",
    "run_calculator_json",
]
