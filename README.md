# amo_calculator

A small AMO calculator codebase with browser-deployable Python calculators.

Live site: [tim4431.github.io/amo_calculator](https://tim4431.github.io/amo_calculator/)

## Repository layout

- `core/`
  Pure scientific computation code.
- `app/`
  Browser-facing Python wrappers and the calculator registry.
- `web/`
  Static frontend assets that load Pyodide and render the UI.
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
  Build a 1D optical axis, insert and reorder elements, edit gap spacing and refractive index, and inspect the cavity mode plus outgoing beams.
- `Gaussian Beam`
  A smaller calculator that demonstrates the multi-tab registry with a different Python backend.

## Run locally

Use any static file server from the repository root. For example:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Python testing

The current calculator wrappers were validated in the `calc` conda environment with:

```bash
conda run --no-capture-output -n calc python -m py_compile \
  core/cavity_mode.py \
  core/gaussian_beam.py \
  app/__init__.py \
  app/base.py \
  app/registry.py \
  app/calculators/__init__.py \
  app/calculators/cavity_mode.py \
  app/calculators/gaussian_beam.py
```

And with direct execution of the registry:

```bash
conda run --no-capture-output -n calc python - <<'PY'
from app.registry import list_calculators, get_calculator_schema, run_calculator

print([c["id"] for c in list_calculators()])
print(run_calculator("cavity-mode", get_calculator_schema("cavity-mode")["default_state"])["ok"])
print(run_calculator("gaussian-beam", get_calculator_schema("gaussian-beam")["default_state"])["ok"])
PY
```
