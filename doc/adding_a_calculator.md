# Adding A Calculator

Two kinds of tabs:

- **Python-backed** — physics runs in Pyodide. Use this for anything numerical.
- **Frontend-only** — tab owns its own schema and rendering, no Pyodide. Use this for links, dashboards, or pure-JS tools (see `web/external_link_ui.js`).

## Python-backed tab

### 1. Core computation

Add `core/<name>.py` with plain Python functions or classes. No plot, tab, or card concepts.

### 2. Browser wrapper

Add `app/calculators/<name>.py` subclassing `CalculatorDefinition`:

- `schema()` returns `{id, title, description, layout, default_state, global_fields, ...}`.
- `evaluate(state)` validates inputs (use `safe_float`, `positive_float`, `clamped_float` from `app.base`), calls `core/`, and returns a JSON-safe dict with `ok`, `error`, `warnings`, `normalized_state`, `plot`, `summary_cards`, `plot_metrics`, optional `scene`. Pass the final dict through `to_serializable()` to convert numpy.

Convert user-facing units (mm, nm, MHz) to SI inside the wrapper — do not leak units into `core/`.

### 3. Register in Python

Edit `app/registry.py` and add a new entry to `CALCULATOR_SPECS` with `id`, `title`, `description`, `layout`, `module`, `class_name`, and `python_files` (every `.py` the browser must fetch before running this calculator).

### 4. Register in the frontend

Edit `web/tabs.js` and add an entry to `TAB_REGISTRY`:

```js
{ id: "<id>", title: "<title>", source: "python", createTab: createSimpleCalculatorTab }
```

Use `createSimpleCalculatorTab` if the calculator fits the hero + plot + messages layout. For custom interaction, write a focused `web/<name>_ui.js` that exports `createFooTab({title})` returning `{mount(workspace, services) -> {update, unmount}}`, and import it in `web/tabs.js`.

Use the panel factories in `web/panels.js` (`createHeroPanel`, `createPlotPanel`, `createBuilderPanel`, `createMessagesPanel`, `createContentPanel`) so panels stay consistent.

### 5. Verify

```bash
conda run --no-capture-output -n calc python -m py_compile \
  core/<name>.py app/calculators/<name>.py
conda run --no-capture-output -n calc python -c "
from app.registry import get_calculator_schema, run_calculator
print(run_calculator('<id>', get_calculator_schema('<id>')['default_state'])['ok'])
"
```

Then hard-reload the page and click the new tab.

## Frontend-only tab

Skip `core/`, `app/`, and `app/registry.py` entirely.

Create `web/<name>_ui.js` exporting a factory that returns:

```js
{
  frontend: { manifest, schema, defaultState, initialResult },
  mount(workspace) { /* ... */ return { update, unmount }; }
}
```

Register it in `web/tabs.js` with `source: "frontend"`. See `web/external_link_ui.js` for a complete example.

## Design rules

- Keep unit conversion in the wrapper, not the core.
- Normalize partial/legacy state in one place inside the wrapper so the frontend can stay interactive.
- Name result fields explicitly — `plot_metrics` for values near the plot, `summary_cards` for global readouts.
- Do not add calculator-specific logic to `web/app.js`. Put it in a focused `web/<name>_ui.js`.
