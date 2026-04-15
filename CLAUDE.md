# AMO Calculator

Interactive optical trap calculator for AMO experiments.

## Python Environment

**Always use the `calc` conda environment for all Python activities:**

```bash
conda run -n calc python script.py
# or activate first:
conda activate calc
```

The `calc` environment has `arc-alkali-rydberg-calculator`, `numpy`, `matplotlib`,
`marimo`, `sympy`, and related packages installed.

## Structure

- `core/` — pure physics calculation modules (no UI dependencies)
- `marimo/` — interactive Marimo notebooks
- `tmp/LatticeCalcs/` — original PyQt-based scripts (reference/archived)

## Running the Marimo app

```bash
# Run (display-only):
conda run -n calc marimo run marimo/trap_explorer.py

# Edit / develop:
conda run -n calc marimo edit marimo/trap_explorer.py
```
