# Cavity Mode Calculator

## Purpose

The cavity-mode calculator is the main reference implementation for the browser architecture in this repository.

It demonstrates:

- a nontrivial scientific solver in `core/`,
- a browser wrapper in `app/`,
- a rich interactive frontend in `web/`,
- deployment as a static GitHub Pages application.

This document walks through the entire stack.

## Files Involved

### Scientific core

- `core/cavity_mode.py`
- `core/gaussian_beam.py`

### Browser wrapper

- `app/calculators/cavity_mode.py`

### Frontend

- `web/app.js`
- `web/ui_common.js`
- `web/cavity_mode_ui.js`
- `web/styles.css`
- `index.html`
- `assets/curved_surface.svg`
- `assets/plane_surface.svg`
- `assets/lens.svg`

## What The Calculator Does

The calculator lets the user build a one-dimensional optical axis, place elements on it, define the refractive index of the sectors between those elements, choose two endpoints for the cavity, and solve for the self-consistent Gaussian cavity mode using ABCD matrices.

It also computes:

- the intracavity propagation path,
- outgoing branches outside the cavity,
- local Gaussian beam properties for each propagation segment,
- cavity finesse,
- cavity free spectral range from the selected endpoint interval,
- inline browser visualizations and hover diagnostics.

## Core Solver Design

### Elements and sectors

In `core/cavity_mode.py`:

- optical elements are placed at explicit positions on the axis,
- refractive index belongs to the *sector between elements*, not to the elements themselves,
- the axis returns stable references when elements are added.

The supported optical elements are:

- `Lens`
- `PlaneSurface`
- `CurvedSurface`

Free-space propagation is inferred automatically from the spacing between placed elements.

### Reflection and transmission model

The core stores only `reflection` on each optical element.

Transmission is derived as:

```text
transmission = 1 - reflection
```

This avoids keeping two independent coefficients that could become inconsistent.

### Solving the cavity mode

The cavity mode is solved from the Gaussian beam `q` parameter and the round-trip ABCD matrix.

The solver:

1. constructs the ordered optical axis,
2. infers the forward and backward one-way matrices,
3. builds the round-trip matrix,
4. solves the self-consistent cavity equation for `q`,
5. propagates the result through the chosen interval and outgoing branches.

### Local beam diagnostics

The core does not only compute a single global waist marker.

Instead, it computes local beam diagnostics from the `q` parameter at each point or segment.

Important fields on `BeamPoint` include:

- `waist_radius`
- `waist_position`
- `rayleigh_range`
- `spot_size`
- `radius_of_curvature`

This matters because once you move to another branch or cross an element, the local `q` changes, and the corresponding local waist description may also change.

### Cavity metrics

The core now also exposes cavity-level metrics directly on the solved
`CavityModeSolution`.

Important examples are:

- `finesse`
- `one_way_optical_path_length`
- `free_spectral_range`

The FSR is computed from the selected endpoint interval as:

```text
FSR = c / (2 * sum(n_i * L_i))
```

where the sum runs over the one-way propagation sectors inside the cavity.

## Wrapper Design

The browser wrapper lives in `app/calculators/cavity_mode.py`.

Its job is to translate between frontend state and the scientific solver.

### Default state

The wrapper defines:

- a global wavelength setting,
- a list of elements,
- a list of gaps,
- left and right boundary objects,
- the list of currently selected cavity endpoints.

The boundary objects carry:

- refractive index,
- outgoing-beam display extent,
- boundary label.

### State normalization

Before solving, the wrapper normalizes:

- element IDs,
- missing element labels,
- reflection values,
- gap distances,
- gap refractive indices,
- endpoint selection.

This normalization step is important because it lets the frontend remain interactive without requiring every intermediate edit state to already be perfect.

### Scene payload

The wrapper returns a `scene` object for the frontend.

This scene describes:

- placed elements,
- gaps,
- left and right boundary cards,
- axis positions in display units.

The frontend uses this scene to build the draggable visual editor.

### Plot payload

The wrapper also returns a `plot` object.

For the cavity-mode calculator, the most important plot field is:

- `segments`

Each segment contains data such as:

- the displayed branch,
- the x coordinates,
- the beam envelope radius values,
- the local waist radius,
- the local waist position,
- the local Rayleigh range,
- the refractive index,
- the segment bounds.

This gives the frontend enough information to implement custom hover behavior without recomputing the physics in JavaScript.

In addition, the wrapper returns `plot_metrics` for values that belong visually
near the plot. In the current cavity-mode page, this is used for:

- `Finesse`
- `FSR`

## Frontend Design

The cavity-mode calculator uses the `optical_axis` layout coordinated by
`web/app.js`, but the implementation is intentionally split.

- `web/app.js` handles application state, Pyodide, registry calls, and generic rendering flow.
- `web/ui_common.js` provides reusable DOM, formatting, and field-rendering helpers.
- `web/cavity_mode_ui.js` provides cavity-specific descriptors, component icons, the palette, and optical-axis plot decorations.

### Builder

The Builder panel renders:

- a toolbar row with the wavelength input and the component selector on the same line,
- draggable element cards,
- gap cards,
- left and right boundary cards,
- endpoint toggles,
- inline editors for optical parameters.

### Inline editing

The current UI uses direct in-place editing rather than a separate inspector panel.

This means:

- element titles can be edited directly,
- `ROC`, `R`, and displayed `T` can be edited on the card,
- gap refractive index and spacing can be edited on the gap card,
- boundary refractive index and outgoing-beam extent can be edited directly on the boundary cards.

The current cavity page does not use the old top summary cards. Instead, the
builder remains focused on editing, while the visualization panel displays
solver metrics below the plot.

### Hover model

The plot does not rely on hitting a plotted line exactly.

Instead:

- moving the mouse anywhere across the plotting area creates a vertical cursor,
- the frontend finds the active propagation segment at that x coordinate,
- the currently active segment is emphasized,
- a local Gaussian-mode overlay is drawn,
- the local waist is marked when it lies within the current plot extent.

### Local Gaussian overlay

When the cursor is inside a segment:

- the active segment shows the local mode as a solid line,
- the same local mode is extended outside the segment with dashed lines,
- the local waist is marked with:
  - `x0`
  - `w0`

This is intentionally different from simply highlighting an existing segment. It shows the *local Gaussian mode implied by that segment*.

## Data Flow End To End

The cavity-mode calculator follows this runtime flow.

1. The frontend loads the calculator schema from `app.registry`.
2. The user edits cards, gaps, and endpoints.
3. The browser state is passed back to the cavity-mode wrapper.
4. The wrapper normalizes state and constructs an `OpticalAxis`.
5. The core solver computes the cavity mode and propagated branches.
6. The wrapper serializes the result into `scene`, `plot`, and `plot_metrics`.
7. The frontend renders:
   - the Builder toolbar and optical-axis editor,
   - the Cavity mode plot,
   - the plot metrics,
   - hover readout,
   - messages.

## Why This Calculator Is A Good Reference Example

The cavity-mode calculator is a good model for future applications because it contains all the major architectural ideas in one place.

It includes:

- nontrivial physics in `core/`,
- unit conversion in the wrapper,
- normalization of partially edited browser state,
- custom scene rendering,
- custom hover behavior,
- static deployment through Pyodide.

If you want to build another application in this repository, this calculator is the best reference implementation to copy from.

## Suggested Reuse Pattern

If you are designing a new application, reuse the cavity-mode implementation at the structural level rather than the physics level.

Reuse these ideas:

- keep the solver in `core/`,
- keep state normalization in the wrapper,
- return explicit JSON structures for scene and plot,
- keep generic browser helpers in `web/ui_common.js`,
- keep cavity- or layout-specific browser logic in dedicated files such as `web/cavity_mode_ui.js`,
- keep `web/app.js` as the orchestration shell,
- do not let the core depend on frontend behavior.

## Practical Testing Checklist

For cavity-mode development, the recommended checks are:

### Core checks

- solve a known stable cavity,
- test sign conventions for curved surfaces,
- test local waist diagnostics.

### Wrapper checks

- evaluate the default state,
- verify endpoint normalization,
- verify scene serialization,
- verify segment metadata,
- verify `Finesse` and `FSR` formatting in `plot_metrics`.

### Frontend checks

- confirm that the wavelength field and component palette share one Builder row,
- drag and reorder elements,
- edit optical coefficients inline,
- edit gap `n` and spacing inline,
- edit boundary `n` and outgoing extent inline,
- toggle endpoints,
- inspect local hover mode and waist overlay,
- confirm that plot extents remain stable during hover,
- confirm that the plot panel shows `Finesse` and `FSR` below the visualization.
