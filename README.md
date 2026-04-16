# amo_calculator

A small AMO calculator codebase with browser-deployable Python calculators.

## What is in the repo

- `core/`
  Pure computation code. This is where the optics and other physics models live.
- `webapp/`
  Python wrappers that expose calculators to the browser runtime through a unified registry.
- `web/`
  Static frontend assets. The page loads Pyodide in the browser, runs the Python code locally, and renders controls plus plots.
- `example/`
  Standalone Python examples, including a confocal cavity mode example.

## Current browser calculators

- `Cavity Mode`
  Build a 1D optical axis, insert and reorder elements, edit gap spacing and refractive index, and inspect the cavity mode plus outgoing beams.
- `Gaussian Beam`
  A smaller calculator that demonstrates the multi-tab registry with a different Python backend.

## Architecture

The repository is split into three layers:

1. `core/` contains only the computation primitives.
2. `webapp/calculators/*.py` contains browser-facing calculator wrappers:
   - default state
   - UI schema
   - translation from UI state into `core` calls
   - JSON-serializable plot and summary output
3. `index.html` + `web/app.js` + `web/styles.css` implement a static frontend.

The frontend loads Pyodide, copies the local Python files into the in-browser virtual filesystem, imports `webapp.registry`, and runs the selected calculator directly in the browser.

This means the site can be hosted on GitHub Pages without a Python server.

## Run locally

Use any static file server from the repository root. For example:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages deployment

This repository includes a root `index.html` and `.nojekyll`, so it is compatible with GitHub Pages static hosting.

One simple deployment path is:

1. Push the repository to GitHub.
2. In the repository settings, enable GitHub Pages.
3. Serve from the default branch root.
4. Open the published Pages URL.

Because Pyodide runs in the browser, no backend deployment is needed.

## Python testing

The current calculator wrappers were validated in the `calc` conda environment with:

```bash
conda run --no-capture-output -n calc python -m py_compile \
  core/cavity_mode.py \
  core/gaussian_beam.py \
  webapp/__init__.py \
  webapp/base.py \
  webapp/registry.py \
  webapp/calculators/__init__.py \
  webapp/calculators/cavity_mode.py \
  webapp/calculators/gaussian_beam.py
```

And with direct execution of the registry:

```bash
conda run --no-capture-output -n calc python - <<'PY'
from webapp.registry import list_calculators, get_calculator_schema, run_calculator

print([c["id"] for c in list_calculators()])
print(run_calculator("cavity-mode", get_calculator_schema("cavity-mode")["default_state"])["ok"])
print(run_calculator("gaussian-beam", get_calculator_schema("gaussian-beam")["default_state"])["ok"])
PY
```
