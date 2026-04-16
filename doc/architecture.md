# Architecture Overview

Small physics calculators that run entirely in the browser via Pyodide and deploy as a static site. One shell hosts multiple calculators as tabs.

## Layers

### `core/` — scientific code

Plain Python: models, solvers, domain objects. No browser, tab, or plot concepts. Must be usable from scripts, notebooks, and tests.

Examples: `core/cavity_mode.py`, `core/gaussian_beam.py`.

### `app/` — browser wrappers

Adaptation between `core/` and the frontend. Each calculator subclasses `CalculatorDefinition` (in `app/base.py`) and implements:

- `schema()` — UI schema + default state.
- `evaluate(state)` — validate inputs, call `core/`, return a JSON-safe dict with fields `ok`, `error`, `warnings`, `normalized_state`, `plot`, `summary_cards`, `plot_metrics`, optional `scene`.

Shared input helpers: `safe_float`, `positive_float`, `clamped_float`, `to_serializable`.

Calculators are registered in `app/registry.py` via `CALCULATOR_SPECS`, which also lists the Python files each calculator needs loaded into Pyodide.

### `web/` — static frontend

- `web/app.js` — shell and runtime orchestrator (Pyodide, schemas, state, compute).
- `web/tabs.js` — explicit tab registry: order, default tab, factory per tab.
- `web/panels.js` — reusable panel factories (`createHeroPanel`, `createPlotPanel`, `createBuilderPanel`, `createMessagesPanel`, `createContentPanel`) and `collectStandardMessages`.
- `web/ui_common.js` — DOM, field, and formatting helpers.
- `web/simple_calculator_ui.js` — generic single-form tab for any calculator with `global_fields` + a `plot`.
- `web/cavity_mode_ui.js` — optical-axis editor for the cavity-mode tab.
- `web/external_link_ui.js` — fully frontend-owned tab (no Pyodide).
- `index.html` — topbar + `<nav id="tabs">` + `<main id="workspace">`. Nothing calculator-specific.

### Build + deploy

`scripts/build_pages_site.py` produces `_site/`, which is published by `.github/workflows/pages.yml`. `python_manifest.json` lists the Python files the browser should fetch, and `scripts/ci_validate_calculators.py` uses the same registry metadata to drive CI compile and smoke-test coverage.

## Tab model

Each entry in `TAB_REGISTRY` has `{id, title, source, default?, createTab}` where `source` is:

- `"python"` — schema and results come from a calculator in `app.registry`.
- `"frontend"` — the tab owns its schema, state, and rendering; no Pyodide call.

The factory `createTab({id, title})` returns a tab module:

```
{ frontend?, mount(workspace, services) -> { update(ctx), unmount() } }
```

`frontend` is optional and only set by `source: "frontend"` tabs; it declares `{manifest, schema, defaultState, initialResult}`. The shell guarantees the same `mount/update/unmount` lifecycle for both sources.

`services` exposes `getCalculator`, `getSchema`, `getState`, `getResult`, `commitState`, `updateGlobal`, `rerender`.

## Runtime flow

1. `index.html` loads `web/app.js`.
2. The shell registers tabs. If the default tab is `"frontend"`, it mounts immediately — no Pyodide needed.
3. In parallel, the shell loads Pyodide, `numpy`, `scipy`, and the common Python files listed in `python_manifest.json`.
4. When a Python-backed tab is first opened, the shell fetches its `python_files`, writes them into Pyodide's FS, then calls `get_calculator_schema_json` and `run_calculator_json`.
5. The tab module renders `scene`, `plot`, `plot_metrics`, `summary_cards`, and messages from the result.

Python source fetches use `cache: "reload"` so the browser revalidates against the server on every load (cheap when unchanged, fresh after edits).

## Why this split

- `core/` is reusable outside the browser (notebooks, scripts, tests).
- `app/` concentrates unit conversion, validation, and JSON shaping.
- `web/` keeps each tab in its own file; adding a calculator does not require touching `web/app.js`.
- Frontend-only tabs (e.g. the Link tab) prove the shell does not force Python on every tab.

## Limitations

Works best when the Python stack is Pyodide-compatible and fast enough for interactive recompute. For heavy or native-only workloads, keep the `core/` + `app/` split but serve the wrapper from a backend instead of Pyodide.
