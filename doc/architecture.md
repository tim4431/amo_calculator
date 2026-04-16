# Architecture Overview

## Purpose

This repository is designed to host small physics calculators that:

- keep the numerical logic in ordinary Python modules,
- run in the browser through Pyodide,
- ship as a static website that can be deployed to GitHub Pages,
- share one frontend shell while exposing multiple calculators through tabs.

The key design goal is to separate *scientific computation* from *browser integration* so that each calculator remains reusable outside the web UI.

## Repository Layers

The project is split into four main layers.

### 1. `core/`

`core/` contains the scientific and numerical implementation.

Typical responsibilities:

- physics models,
- numerical solvers,
- domain-specific data structures,
- reusable pure-Python utilities.

Rules for this layer:

- it should not know about the browser,
- it should not depend on the tab system,
- it should not emit frontend-specific JSON,
- it should remain usable from scripts, notebooks, tests, and examples.

Examples:

- `core/cavity_mode.py`
- `core/gaussian_beam.py`

### 2. `app/`

`app/` contains browser-facing wrappers around the core calculators.

Typical responsibilities:

- define the default calculator state,
- define the UI schema expected by the frontend,
- translate browser state into `core/` calls,
- normalize inputs,
- return JSON-serializable output for plotting, summaries, warnings, and messages.

This is the adaptation layer between scientific Python code and the static web UI.

Examples:

- `app/base.py`
- `app/registry.py`
- `app/calculators/cavity_mode.py`
- `app/calculators/gaussian_beam.py`

### 3. `web/`

`web/` contains the static frontend assets.

Typical responsibilities:

- load Pyodide,
- copy Python files into the browser filesystem,
- call Python wrappers through a small bridge,
- render tabs, controls, editors, status messages, and plots.

Examples:

- `web/app.js`
- `web/styles.css`

### 4. Static entrypoint and build scripts

These files turn the project into a deployable static site.

Important pieces:

- `index.html`
- `scripts/build_pages_site.py`
- `.github/workflows/pages.yml`

## Runtime Model

The browser runtime works as follows.

1. `index.html` loads the static frontend.
2. `web/app.js` loads Pyodide in the browser.
3. The frontend fetches Python source files from the repository and writes them into Pyodide's in-memory filesystem.
4. The frontend imports `app.registry`.
5. The frontend asks the registry for:
   - the list of calculators,
   - the schema for the active calculator,
   - the result of evaluating the current state.
6. The frontend renders the returned JSON.

No backend server is required for the normal user path.

## Calculator Contract

Each browser calculator is represented by a subclass of `CalculatorDefinition` from `app/base.py`.

The calculator wrapper must provide:

- `calculator_id`
- `title`
- `description`
- `layout`
- `schema()`
- `evaluate(state)`

### `schema()`

The schema describes:

- the default state,
- the visible global controls,
- the calculator-specific editing structure,
- the palette or layout metadata needed by the frontend.

### `evaluate(state)`

The evaluate method:

- receives the current browser state,
- normalizes and validates it,
- runs the computation in `core/`,
- returns a JSON-safe result object.

Typical result fields include:

- `ok`
- `error`
- `warnings`
- `normalized_state`
- `scene`
- `plot`
- `summary_cards`

## Why This Split Works Well

This architecture has several advantages.

### Reuse

`core/` logic can be reused by:

- notebooks,
- batch scripts,
- command-line tools,
- examples,
- future desktop or server applications.

### Static Deployment

Because the UI runs Python through Pyodide, deployment is as simple as serving static files.

### Multi-calculator Support

The registry gives every calculator the same entry contract. This makes it easy to add more tabs without redesigning the frontend each time.

### Testability

You can test:

- `core/` directly as ordinary Python code,
- `app/` wrappers through schema and registry smoke tests,
- the static site through the Pages build artifact.

## What To Put In Each Layer

Use this rule of thumb.

### Put code in `core/` if:

- it is scientific or numerical,
- it should be reusable outside the browser,
- it has no opinion about sliders, cards, tabs, or plotly traces.

### Put code in `app/` if:

- it translates UI state into scientific calls,
- it normalizes user input,
- it shapes scene or plot payloads,
- it defines calculator-specific defaults.

### Put code in `web/` if:

- it is about browser interaction,
- it manages inline editors,
- it handles drag-and-drop,
- it renders plots,
- it controls hover behavior and display logic.

## Deployment Model

The repository is designed for GitHub Pages.

The deployment path is:

1. build a static artifact with `scripts/build_pages_site.py`,
2. publish the resulting directory through GitHub Pages,
3. let the browser load Python through Pyodide at runtime.

This means:

- no Flask or FastAPI backend is required,
- the project is easy to host,
- browser compatibility matters more than server provisioning.

## Limitations

This architecture works best when the Python calculator code:

- is compatible with Pyodide,
- does not rely on unsupported native extensions,
- does not require long-running heavy computation for responsive interaction.

If a future calculator depends on libraries that are difficult to run in the browser, there are still two options:

- keep the same `core/` and `app/` structure, but run the wrapper on a server instead of Pyodide,
- or expose only a subset of the full functionality in the browser.

The structure still remains useful even when the execution backend changes.
