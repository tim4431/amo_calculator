# Cavity Mode Calculator

Reference implementation combining a nontrivial solver, a browser wrapper, and a custom frontend tab.

## Files

- `core/cavity_mode.py`, `core/gaussian_beam.py` — solver.
- `app/calculators/cavity_mode.py` — browser wrapper.
- `web/cavity_mode_ui.js` — optical-axis builder and plot.
- `web/panels.js`, `web/ui_common.js` — shared shell helpers.

## What it computes

The user builds a 1D optical axis by placing elements (`Lens`, `PlaneSurface`, `CurvedSurface`), editing the refractive index of each sector between them, and picking two endpoints. The solver returns:

- the self-consistent Gaussian cavity mode via round-trip ABCD,
- intracavity propagation plus outgoing branches,
- local beam diagnostics (`waist_radius`, `waist_position`, `rayleigh_range`, `spot_size`, `radius_of_curvature`) per segment,
- cavity `finesse`, `one_way_optical_path_length`, and `free_spectral_range` (`FSR = c / (2 · Σ nᵢLᵢ)` over one-way intracavity sectors).

Each element stores `reflection` only; `transmission = 1 - reflection` is derived so the two cannot drift.

## Wrapper

`app/calculators/cavity_mode.py` defines the default state (wavelength, elements, gaps, boundaries, endpoints) and normalizes IDs, labels, reflections, gap lengths, refractive indices, and endpoint selection before solving. Normalization lets the frontend stay interactive while the user is mid-edit.

It returns:

- `scene` — placed elements, gaps, boundary cards, and axis display positions used by the builder.
- `plot.segments` — per-segment `x`, beam envelope, local waist (`w0`, `x0`), Rayleigh range, refractive index, and bounds. The frontend uses this directly for hover logic without recomputing physics.
- `plot_metrics` — `Finesse` and `FSR` shown below the plot.

## Frontend

`createCavityModeTab` mounts three panels from `web/panels.js`: builder, plot, messages.

**Builder** — a toolbar (wavelength + component picker on one row), draggable element cards, gap cards, and left/right boundary cards with endpoint toggles. Editing is inline: element title, `ROC`, `R`, gap `n` and spacing, boundary `n`, and outgoing-beam extent are edited directly on the cards.

**Plot hover model** — the cursor does not need to hit a line. A vertical cursor snaps to the segment under the pointer, that segment is emphasized, and the local Gaussian mode implied by the segment's `q` is drawn (solid inside the segment, dashed outside). The local waist is marked with `x0` and `w0` when it lies inside the visible range.

## End-to-end flow

1. Frontend requests the schema from `app.registry` (lazy-loading `core/cavity_mode.py` + wrapper).
2. User edits state in the builder; `services.commitState` stores it and schedules a recompute.
3. Wrapper normalizes state, builds an `OpticalAxis`, calls the core solver.
4. Result is serialized into `scene`, `plot`, `plot_metrics`.
5. Frontend renders the builder, plot, metrics, hover readout, and messages.

## Reuse ideas

For a new calculator, copy the *structure*, not the physics:

- Keep the solver in `core/` with no browser concepts.
- Normalize partial state in the wrapper.
- Return explicit `scene` / `plot` / `plot_metrics` payloads.
- Assemble the tab from `web/panels.js` factories and keep calculator-specific logic in its own `web/<name>_ui.js`.

## Checks

Core: solve a known stable cavity, verify curved-surface sign conventions, spot-check local waist diagnostics.

Wrapper: default-state `evaluate` is `ok`; endpoint normalization is idempotent; `scene` and `plot.segments` serialize cleanly; `Finesse` and `FSR` appear in `plot_metrics`.

Frontend: drag/reorder elements, edit inline, toggle endpoints, confirm hover overlay and that plot extents stay stable during hover.
