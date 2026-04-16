# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Python Environment

**Always use the `calc` conda environment for all Python activities:**

```bash
conda run -n calc python script.py
# or activate first:
conda activate calc
```

The `calc` environment has `arc-alkali-rydberg-calculator`, `numpy`, `scipy`, `matplotlib`, `marimo`, `sympy`, and related packages installed.

## Project Structure

This repo hosts AMO physics calculators that run in the browser via Pyodide (no backend server needed), plus a Marimo interactive notebook for local use.

```
core/        Pure physics computation — no browser dependencies
app/         Browser-facing wrappers around core/ and the calculator registry
web/         Static JS frontend assets (loads Pyodide, renders UI)
marimo/      Interactive Marimo notebooks for local development
scripts/     Build scripts for GitHub Pages deployment
_site/       Build artifact (generated, don't edit)
```

Live site: [tim4431.github.io/amo_calculator](https://tim4431.github.io/amo_calculator/)

## Architecture

The project has a strict three-layer separation:

**`core/`** — Scientific computation only. No Plotly traces, no tab/card/slider concepts. Usable from notebooks, scripts, and tests. Key modules: `hf_pol.py` (hyperfine-resolved dynamic polarizability via ARC), `trap_model.py` (lattice and dipole trap depths/frequencies/scatter rates), `gaussian_beam.py`, `cavity_mode.py`.

**`app/`** — Adaptation layer between `core/` and the browser. Subclass `CalculatorDefinition` from `app/base.py` and implement `schema()` (UI schema + default state) and `evaluate(state)` (call `core/`, return JSON-safe dict). Register new calculators in `app/registry.py`. The `to_serializable()` helper in `app/base.py` handles numpy→Python conversion.

**`web/`** — Browser interaction only. `web/app.js` is the runtime orchestrator; `web/ui_common.js` has reusable DOM/field helpers; calculator-specific rendering logic lives in focused modules (e.g. `web/cavity_mode_ui.js`).

The browser runtime: `index.html` → Pyodide loads → Python source copied into Pyodide FS → `app.registry` queried for calculator list, schema, and evaluation results → frontend renders JSON output.

## Running Locally

Serve static files from the repo root:
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Marimo Notebook

```bash
# Run (display only):
conda run -n calc marimo run marimo/trap.py

# Develop/edit:
conda run -n calc marimo edit marimo/trap.py
```

The Marimo notebook (`marimo/trap.py`) imports directly from `core/` and uses `TrapModel` + `HFPolarizabilityCalculator` for interactive trap calculations.

## Python Validation

Syntax-check all Python layers:
```bash
conda run --no-capture-output -n calc python -m py_compile \
  core/cavity_mode.py core/gaussian_beam.py \
  app/__init__.py app/base.py app/registry.py \
  app/calculators/__init__.py app/calculators/cavity_mode.py \
  app/calculators/gaussian_beam.py
```

Registry smoke test:
```bash
conda run --no-capture-output -n calc python - <<'PY'
from app.registry import list_calculators, get_calculator_schema, run_calculator
print([c["id"] for c in list_calculators()])
print(run_calculator("cavity-mode", get_calculator_schema("cavity-mode")["default_state"])["ok"])
print(run_calculator("gaussian-beam", get_calculator_schema("gaussian-beam")["default_state"])["ok"])
PY
```

## Build

```bash
conda run -n calc python scripts/build_pages_site.py
# output goes to _site/
```

## Adding a New Calculator

1. Add physics logic to `core/new_calc.py` (no browser concepts)
2. Add `app/calculators/new_calc.py` subclassing `CalculatorDefinition`; convert user-facing units to SI inside `evaluate()`; use `to_serializable()` on output
3. Register the instance in `app/registry.py`
4. If new frontend interaction is needed, add a focused `web/new_calc_ui.js` and import it from `web/app.js` — don't add calculator-specific logic to `web/app.js` directly

Standard `evaluate()` result fields: `ok`, `error`, `warnings`, `normalized_state`, `plot`, `summary_cards`, `plot_metrics`, `scene` (for interactive layouts).
