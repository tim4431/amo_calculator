# amo_calculator

A small AMO calculator codebase with browser-deployable Python calculators.

Live site: [tim4431.github.io/amo_calculator](https://tim4431.github.io/amo_calculator/)

## Repository layout

- `core/`
  Pure scientific computation code.
- `app/`
  Browser-facing Python wrappers and the calculator registry.
- `web/`
  Static frontend assets and reusable UI modules that load Pyodide and render the UI.
- `example/`
  Standalone Python examples.
- `doc/`
  Detailed project documentation.

## Documentation

- [Documentation Index](doc/README.md)
- [Architecture Overview](doc/architecture.md)
- [Adding A Calculator](doc/adding_a_calculator.md)
- [Cavity Mode Calculator](doc/cavity_mode_calculator.md)

## Current browser calculators

- `Cavity Mode`
  Build a 1D optical axis, insert and reorder elements, edit gap and boundary parameters, inspect the cavity mode plus outgoing beams, and read off cavity finesse and FSR.
- `Gaussian Beam`
  A smaller calculator that demonstrates the multi-tab registry with a different Python backend.
- `Link`
  A frontend-only tab with clickable cards for external destinations, including the hosted marimo app, Lens Pair Finder, Cavity Mode Viewer, and Tuning Range.

## Run locally

Use any static file server from the repository root. For example:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

The browser runtime now lazy-loads Python source files:

- shared runtime files are loaded at startup,
- the default calculator tab is loaded immediately,
- other calculator modules are fetched only when you click their tab for the first time.

For the local marimo notebook, run

```bash
marimo run ./marimo
```

Then open:

```text
http://localhost:2718"
```

or

```text
https://amo_calculator.xwtim.com
```

## Python testing

CI now validates Python-backed calculators from the registry instead of a hardcoded file list. In the `calc` conda environment, run:

```bash
conda run --no-capture-output -n calc python scripts/ci_validate_calculators.py all
```

That script reads `app/registry.py` and:

- compiles every Python file listed in `python_files`,
- smoke-tests every registered calculator with its `default_state`,
- verifies that schemas and results remain JSON-serializable.
