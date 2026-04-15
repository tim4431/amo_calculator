import marimo

__generated_with = "0.23.1"
app = marimo.App(width="full")


# ── Imports & path setup ──────────────────────────────────────────────────────

@app.cell
def _():
    import sys, os
    import marimo as mo
    import numpy as np

    _root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if _root not in sys.path:
        sys.path.insert(0, _root)

    from core.hf_pol import SUPPORTED_ATOMS, get_F_values, get_mF_values, fmt_qnum
    from core.trap_model import TrapModel

    return mo, np, SUPPORTED_ATOMS, get_F_values, get_mF_values, fmt_qnum, TrapModel


# ── Atom & mode widgets ───────────────────────────────────────────────────────

@app.cell
def _(mo, SUPPORTED_ATOMS):
    atom_select = mo.ui.dropdown(
        options=list(SUPPORTED_ATOMS.keys()),
        value="Rb85",
        label="Atom",
    )
    mode_select = mo.ui.radio(
        options={"Lattice": "lattice", "Dipole": "dipole"},
        value="Lattice",
        label="Trap type",
    )
    return atom_select, mode_select


# ── F widget – options depend on atom ────────────────────────────────────────

@app.cell
def _(mo, atom_select, SUPPORTED_ATOMS, get_F_values, fmt_qnum):
    _info   = SUPPORTED_ATOMS[atom_select.value]
    _F_vals = get_F_values(_info["I"], _info["J_ground"])
    F_select = mo.ui.dropdown(
        options={fmt_qnum(f): f for f in _F_vals},
        value=fmt_qnum(_F_vals[-1]),
        label="F",
    )
    return (F_select,)


# ── mF & q widgets – mF options depend on F ──────────────────────────────────

@app.cell
def _(mo, F_select, get_mF_values, fmt_qnum):
    _mF_vals = get_mF_values(F_select.value)
    mF_select = mo.ui.dropdown(
        options={fmt_qnum(m): m for m in _mF_vals},
        value=fmt_qnum(_mF_vals[-1]),
        label="mF",
    )
    q_select = mo.ui.radio(
        options={"σ⁻  (q=-1)": -1, "π  (q=0)": 0, "σ⁺  (q=+1)": 1},
        value="π  (q=0)",
        label="Polarization q",
    )
    return mF_select, q_select


# ── Beam-parameter inputs ─────────────────────────────────────────────────────

@app.cell
def _(mo):
    wavelength_input = mo.ui.number(
        start=300, stop=2000, step=1, value=830,
        label="Wavelength (nm)",
    )
    waist_slider = mo.ui.slider(
        start=10, stop=1000, step=5, value=250,
        label="Beam waist (μm)", debounce=True,
    )
    power_input = mo.ui.number(
        start=0.001, stop=1000.0, step=0.1, value=1.0,
        label="Power (W)",
    )
    return wavelength_input, waist_slider, power_input


# ── Build TrapModel ───────────────────────────────────────────────────────────

@app.cell
def _(atom_select, F_select, mF_select, q_select, SUPPORTED_ATOMS, TrapModel):
    _info = SUPPORTED_ATOMS[atom_select.value]
    model = TrapModel(
        atom_select.value,
        _info["n_ground"], _info["L_ground"], _info["J_ground"],
        F_select.value, mF_select.value, q_select.value,
    )
    return (model,)


# ── Compute polarizability ────────────────────────────────────────────────────

@app.cell
def _(model, wavelength_input):
    alpha_hz = model.get_polarizability(wavelength_input.value * 1e-9)
    return (alpha_hz,)


# ── Compute trap at single power ──────────────────────────────────────────────

@app.cell
def _(model, mode_select, wavelength_input, waist_slider, power_input, alpha_hz):
    _lam = wavelength_input.value * 1e-9
    _w0  = waist_slider.value * 1e-6
    _P   = power_input.value

    if mode_select.value == "lattice":
        trap_result = model.lattice_trap(_lam, _w0, _P, alpha_hz)
        scatter_result = model.lattice_scatter_rate(_lam, _w0, _P, alpha_hz)
    else:
        trap_result = model.dipole_trap(_lam, _w0, _P, alpha_hz)
        scatter_result = model.dipole_scatter_rate(_lam, _w0, _P, alpha_hz)
    return trap_result, scatter_result


# ── DISPLAY CELL: sidebar + results ──────────────────────────────────────────

@app.cell
def _(mo,
      atom_select, mode_select, F_select, mF_select, q_select,
      wavelength_input, waist_slider, power_input,
      trap_result, scatter_result, alpha_hz):
    import math

    _trapped = alpha_hz > 0

    def _fmt_freq(val_khz):
        if not _trapped or math.isnan(val_khz):
            return "— (anti-trapped)"
        return f"{val_khz:.3f} kHz"

    _depth_uK  = trap_result["U0_uK"]
    _f_ax      = trap_result["f_axial_kHz"]
    _f_rad     = trap_result["f_radial_kHz"]
    _alpha_sign = "repulsive / blue-det." if alpha_hz < 0 else "attractive / red-det."

    _rows = [
        ("Trap depth",          f"{_depth_uK:.2f} μK"),
        ("Trap temp (depth/k_B)", f"{abs(_depth_uK):.2f} μK  {'(anti-trapped)' if not _trapped else ''}"),
        ("Axial frequency",     _fmt_freq(_f_ax)),
        ("Radial frequency",    _fmt_freq(_f_rad)),
        ("Scatter rate",        f"{scatter_result:.2f} rad/s"),
        ("Polarizability α",    f"{alpha_hz:.3e} Hz/(V/m)²  [{_alpha_sign}]"),
    ]
    if "zR_mm" in trap_result:
        _rows.append(("Rayleigh range", f"{trap_result['zR_mm']:.2f} mm"))

    _table_md = "| Parameter | Value |\n|:---|:---|\n" + "".join(
        f"| {k} | {v} |\n" for k, v in _rows
    )

    _sidebar = mo.vstack([
        mo.md("## Optical Trap Explorer"),
        mo.md("---"),
        mo.md("**Atom & Mode**"),
        atom_select,
        mode_select,
        mo.md("**Quantum State**"),
        mo.hstack([F_select, mF_select], gap="1rem"),
        q_select,
        mo.md("**Beam Parameters**"),
        wavelength_input,
        waist_slider,
        power_input,
    ], gap="0.3rem")

    mo.hstack(
        [_sidebar, mo.md(_table_md)],
        gap="2rem",
        align="start",
    )
    return


if __name__ == "__main__":
    app.run()
