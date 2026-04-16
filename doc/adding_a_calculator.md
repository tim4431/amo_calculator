# Adding A Calculator

## Goal

This guide explains how to add a new calculator to the project while keeping the architecture clean and consistent.

The recommended workflow is:

1. write the scientific code in `core/`,
2. wrap it in `app/calculators/`,
3. register it in `app/registry.py`,
4. let the existing frontend discover it automatically.

## Step 1: Create The Core Computation Module

Add a new file in `core/`.

Examples:

- `core/trap_frequency.py`
- `core/stark_shift.py`
- `core/atom_polarizability.py`

This module should expose ordinary Python functions or classes.

Good examples of core-layer responsibilities:

- compute derived quantities from physical inputs,
- encapsulate domain objects,
- validate scientific assumptions,
- provide reusable helper methods.

Avoid putting browser concepts here.

Do not include:

- tab metadata,
- Plotly traces,
- inline editor logic,
- card layout assumptions.

## Step 2: Create The Browser Wrapper

Add a new wrapper in `app/calculators/`.

For example:

```text
app/calculators/stark_shift.py
```

The wrapper should inherit from `CalculatorDefinition`.

It should define:

- metadata,
- default state,
- schema,
- evaluation logic.

Typical wrapper responsibilities:

- convert user-facing units into SI units,
- clamp or normalize input values,
- call the `core/` implementation,
- format output into JSON-safe dictionaries.

## Step 3: Register The Calculator

Update `app/registry.py` so that the new calculator becomes visible to the frontend.

This is the step that makes it appear as a new browser tab.

In practice, registration is usually:

- importing the new wrapper class,
- constructing an instance,
- adding it to the `CALCULATORS` dictionary.

## Step 4: Decide Whether The Existing Frontend Layout Is Enough

Many calculators can reuse the current frontend patterns.

Examples:

- a calculator with a small set of scalar inputs,
- a calculator that returns one or more line plots,
- a calculator that needs summary cards and a message area.

If the calculator needs a special interaction model, you can extend the frontend by introducing a new `layout` value.

Examples:

- `layout = "form_plot"`
- `layout = "optical_axis"`
- `layout = "energy_levels"`

The wrapper declares the layout; the frontend decides how to render that layout.

In the current frontend structure, avoid putting every new interaction pattern
directly into `web/app.js`.

Instead:

- reuse shared field and formatting helpers from `web/ui_common.js`,
- add layout- or calculator-specific browser logic in a dedicated module,
- import that module from `web/app.js`.

## Step 5: Return Structured Output

Try to keep the result format explicit and predictable.

A good result object often contains:

- `ok`
- `error`
- `warnings`
- `normalized_state`
- `plot`
- `summary_cards`
- `plot_metrics`

If the calculator has a custom interactive scene, include a dedicated `scene` field as well.

## Step 6: Test At Three Levels

### Core-layer tests

Test the scientific logic directly.

Typical checks:

- known-value tests,
- sign convention tests,
- unit conversion tests,
- edge-case handling.

### Wrapper-layer tests

Test the browser wrapper as pure Python.

Typical checks:

- schema generation,
- default state evaluation,
- JSON-safe output,
- failure and warning behavior.

### Static-site tests

Test the deployable site artifact.

Typical checks:

- `py_compile`,
- registry smoke tests,
- `scripts/build_pages_site.py`.

## Recommended Design Rules

### Keep units explicit

If the frontend works in `mm`, `nm`, or `MHz`, convert clearly in the wrapper rather than spreading unit conversions across frontend and core code.

### Keep `core/` free of frontend state shape

The core module should not care how the browser stores state.

### Keep wrapper outputs explicit

A wrapper should produce field names that the frontend can understand without hidden assumptions.

If a calculator exposes metrics that belong visually near the plot rather than
in the top-level summary, return them through a separate field such as
`plot_metrics` instead of overloading `summary_cards`.

### Prefer deterministic normalization

If the user state is incomplete or partially legacy, normalize it in one place inside the wrapper.

## Example Development Flow

Suppose you want to add a Stark-shift calculator.

You might do the following.

1. Create `core/stark_shift.py` with the actual physics computation.
2. Create `app/calculators/stark_shift.py` with:
   - default inputs,
   - slider and number field schema,
   - a call into `core.stark_shift`,
   - formatted plot data.
3. Import and register `StarkShiftCalculator` in `app/registry.py`.
4. If needed, add a focused frontend module in `web/` for any special layout behavior.
5. Refresh the browser app and verify that a new tab appears.

## When To Avoid Running In The Browser

The browser architecture is excellent for lightweight to moderate Python workloads, but not every scientific package is a perfect fit.

Consider a server-backed deployment if the calculator:

- depends on complex native extensions,
- requires very large data files,
- needs heavy numerical routines that are too slow in-browser,
- or depends on third-party packages not readily available in Pyodide.

Even in that case, you can still preserve the same `core/` and wrapper separation.
