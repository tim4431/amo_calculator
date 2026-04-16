"""Registry-driven CI checks for browser calculators."""

from __future__ import annotations

import argparse
import json
import py_compile
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.base import to_serializable  # noqa: E402
from app.registry import (  # noqa: E402
    browser_python_manifest,
    get_calculator_schema,
    list_calculators,
    run_calculator,
)


def _assert_json_serializable(label: str, value: Any) -> None:
    try:
        json.dumps(to_serializable(value))
    except TypeError as exc:
        raise RuntimeError(f"{label} is not JSON serializable") from exc


def compile_browser_python_files() -> None:
    manifest = browser_python_manifest()
    python_files = manifest["python_files"]

    print(f"Compiling {len(python_files)} browser Python files from app.registry")
    for relative_path in python_files:
        path = ROOT / relative_path
        if not path.is_file():
            raise FileNotFoundError(f"Registered Python file does not exist: {relative_path}")
        py_compile.compile(str(path), doraise=True)
        print(f"compiled: {relative_path}")


def smoke_test_calculators() -> None:
    calculators = list_calculators()
    if not calculators:
        raise RuntimeError("No calculators are registered in app.registry")

    calculator_ids = [item["id"] for item in calculators]
    print(f"Smoke-testing calculators: {calculator_ids}")

    for manifest in calculators:
        calculator_id = manifest["id"]
        schema = get_calculator_schema(calculator_id)
        if schema.get("id") != calculator_id:
            raise RuntimeError(
                f"Schema id mismatch for {calculator_id}: {schema.get('id')!r}"
            )

        default_state = schema.get("default_state")
        if not isinstance(default_state, dict):
            raise RuntimeError(
                f"Calculator {calculator_id} must expose a dict default_state in schema()"
            )

        _assert_json_serializable(f"{calculator_id} schema", schema)

        result = run_calculator(calculator_id, default_state)
        if not isinstance(result, dict):
            raise RuntimeError(f"Calculator {calculator_id} returned a non-dict result")
        if not result.get("ok"):
            raise RuntimeError(f"Calculator {calculator_id} failed smoke test: {result}")

        normalized_state = result.get("normalized_state")
        if not isinstance(normalized_state, dict):
            raise RuntimeError(
                f"Calculator {calculator_id} must return a dict normalized_state"
            )

        _assert_json_serializable(f"{calculator_id} result", result)

        present_fields = [
            key for key in ("scene", "plot", "plot_metrics", "summary_cards") if key in result
        ]
        print(f"smoke ok: {calculator_id} fields={present_fields}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run registry-driven CI checks for browser calculators."
    )
    parser.add_argument(
        "action",
        nargs="?",
        default="all",
        choices=("compile", "smoke", "all"),
        help="Which validation to run.",
    )
    args = parser.parse_args()

    if args.action in ("compile", "all"):
        compile_browser_python_files()
    if args.action in ("smoke", "all"):
        smoke_test_calculators()


if __name__ == "__main__":
    main()
