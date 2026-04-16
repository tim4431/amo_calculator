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

- provide reusable DOM, formatting, and form helpers,
- load Pyodide,
- copy Python files into the browser filesystem,
- call Python wrappers through a small bridge,
- render tabs, controls, editors, status messages, and plots.

Examples:

- `web/app.js`
- `web/calculator_ui_registry.js`
- `web/simple_calculator_ui.js`
- `web/ui_common.js`
- `web/cavity_mode_ui.js`
- `web/styles.css`

In the current frontend split:

- `web/app.js` is the application shell and runtime orchestrator,
- `web/calculator_ui_registry.js` maps calculator layouts to focused UI modules,
- `web/simple_calculator_ui.js` is the fallback UI for form-style calculators,
- `web/ui_common.js` contains reusable field and formatting helpers,
- `web/cavity_mode_ui.js` contains the optical-axis UI module, including
  cards, component icons, and plot decorations used by cavity-style calculators.

### 4. Static entrypoint and build scripts

These files turn the project into a deployable static site.

Important pieces:

- `index.html`
- `python_manifest.json`
- `scripts/build_pages_site.py`
- `.github/workflows/pages.yml`

## Runtime Model

The browser runtime works as follows.

1. `index.html` loads the static frontend.
2. `web/app.js` loads Pyodide in the browser and imports the shared frontend modules it needs.
3. The frontend fetches `python_manifest.json` and writes only the shared Python runtime files into Pyodide's in-memory filesystem.
4. The frontend imports `app.registry`.
5. The frontend asks the registry for the list of calculators.
6. The frontend loads the default calculator's Python files on demand, then asks the registry for:
   - the schema for the active calculator,
   - the result of evaluating the current state.
7. When the user clicks a different calculator tab for the first time, the frontend fetches only that calculator's Python files, writes them into Pyodide, and then requests its schema and result.
8. The frontend renders the returned JSON, including plot data, scene data, and optional metric cards.

No backend server is required for the normal user path.

### Lazy Python Loading

The browser runtime does not eagerly load every calculator module at startup.

Instead:

- `python_manifest.json` is split into shared files and per-calculator files,
- `app.registry` exposes lightweight calculator metadata without importing every wrapper module,
- the active default tab is loaded immediately,
- other calculators are loaded only when their tab is first activated.

This keeps initial page load smaller while preserving the same calculator contract.

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
- `plot_metrics`

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

The current registry also keeps startup light by storing calculator metadata separately from the actual wrapper imports, so adding more calculators does not automatically force every Python file to load on first page visit.

### Frontend Reuse

The frontend is no longer treated as one large file.

Shared browser behavior can live in reusable modules, while layout-specific
logic can be kept in dedicated files. This keeps a calculator-specific UI from
turning into a project-wide tangle.

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

Within `web/`, prefer a second split:

- put general-purpose browser helpers in shared modules such as `web/ui_common.js`,
- register calculator- or layout-specific rendering logic through
  `web/calculator_ui_registry.js`,
- keep focused UI modules such as `web/simple_calculator_ui.js` or
  `web/cavity_mode_ui.js` free of runtime bootstrapping concerns,
- keep `web/app.js` as the orchestration layer that owns runtime state,
  registry calls, and high-level rendering flow.

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
