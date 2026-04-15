import marimo

__generated_with = "0.23.1"
app = marimo.App(width="full")


# ── Imports & path setup ──────────────────────────────────────────────────────

@app.cell
def _():
    import sys, os
    import marimo as mo
    import numpy as np
    import matplotlib.pyplot as plt

    _root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if _root not in sys.path:
        sys.path.insert(0, _root)

    from core.hf_pol import SUPPORTED_ATOMS, get_F_values, get_mF_values, fmt_qnum
    from core.trap_model import TrapModel

    return mo, np, plt, SUPPORTED_ATOMS, get_F_values, get_mF_values, fmt_qnum, TrapModel


# ── Title ─────────────────────────────────────────────────────────────────────

@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    # Optical Trap Explorer
    Interactive calculator for **optical lattice** and **dipole trap** properties.
    Adjust the controls below to explore trap depth, trap frequencies, and photon scattering rate.
    """)
    return


# ── Atom & mode controls ──────────────────────────────────────────────────────

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

    mo.hstack([atom_select, mode_select], gap="3rem", align="end")
    return atom_select, mode_select


# ── Quantum-state controls (F options depend on atom) ─────────────────────────

@app.cell
def _(atom_select, SUPPORTED_ATOMS, get_F_values, fmt_qnum, mo):
    _info   = SUPPORTED_ATOMS[atom_select.value]
    _F_vals = get_F_values(_info["I"], _info["J_ground"])

    F_select = mo.ui.dropdown(
        options={fmt_qnum(f): f for f in _F_vals},
        value=fmt_qnum(_F_vals[-1]),
        label="F",
    )
    # F_select is displayed together with mF and q in the cell below
    return (F_select,)


@app.cell
def _(F_select, get_mF_values, fmt_qnum, mo):
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

    mo.hstack([F_select, mF_select, q_select], gap="3rem", align="end")
    return mF_select, q_select


# ── Beam-parameter controls ───────────────────────────────────────────────────

@app.cell
def _(mo):
    wavelength_slider = mo.ui.slider(
        start=300, stop=2000, step=1, value=830,
        label="Wavelength (nm)",
        debounce=True,
    )
    waist_slider = mo.ui.slider(
        start=10, stop=1000, step=5, value=250,
        label="Beam waist (μm)",
        debounce=True,
    )

    mo.md(f"""
    **Beam parameters**

    {mo.hstack([wavelength_slider, waist_slider], gap="3rem")}
    """)
    return wavelength_slider, waist_slider


@app.cell
def _(mo):
    power_min_slider = mo.ui.slider(
        start=0.01, stop=10.0, step=0.05, value=0.05,
        label="Min power (W)",
        debounce=True,
    )
    power_max_slider = mo.ui.slider(
        start=0.1, stop=50.0, step=0.1, value=3.0,
        label="Max power (W)",
        debounce=True,
    )

    mo.md(f"""
    **Power range**

    {mo.hstack([power_min_slider, power_max_slider], gap="3rem")}
    """)
    return power_min_slider, power_max_slider


# ── Build model (only re-runs when atom / quantum state changes) ───────────────

@app.cell
def _(atom_select, F_select, mF_select, q_select, SUPPORTED_ATOMS, TrapModel):
    _info = SUPPORTED_ATOMS[atom_select.value]
    model = TrapModel(
        atom_select.value,
        _info["n_ground"],
        _info["L_ground"],
        _info["J_ground"],
        F_select.value,
        mF_select.value,
        q_select.value,
    )
    return (model,)


# ── Compute polarizability (re-runs when model or wavelength changes) ─────────

@app.cell
def _(model, wavelength_slider):
    alpha_hz = model.get_polarizability(wavelength_slider.value * 1e-9)
    return (alpha_hz,)


# ── Compute traces (re-runs when alpha, waist, power range, or mode changes) ──

@app.cell
def _(model, mode_select, wavelength_slider, waist_slider,
      power_min_slider, power_max_slider, alpha_hz, np):
    _p_min   = power_min_slider.value
    _p_max   = max(power_max_slider.value, _p_min + 0.05)
    powers   = np.linspace(_p_min, _p_max, 150)
    traces   = model.compute_traces(
        mode_select.value,
        wavelength_slider.value * 1e-9,
        waist_slider.value * 1e-6,
        alpha_hz,
        powers,
    )
    return powers, traces


# ── Plots + info table ────────────────────────────────────────────────────────

@app.cell
def _(plt, mo, powers, traces, mode_select,
      alpha_hz, wavelength_slider, waist_slider,
      atom_select, F_select, mF_select, q_select,
      SUPPORTED_ATOMS, fmt_qnum):

    mode = mode_select.value

    # ── colour palette (matches original PyQt app) ──
    C_DEPTH = "#2a6fbb"
    C_AX    = "#d1495b"
    C_RAD   = "#17643d"
    C_SCAT  = "#7f5539"
    GRID_C  = "#8a94a6"
    AX_BG   = "#ffffff"
    FIG_BG  = "#f6f8fc"

    def _style(ax, title, ylabel):
        ax.set_facecolor(AX_BG)
        ax.set_title(title, fontsize=12, fontweight="semibold")
        ax.set_ylabel(ylabel, fontsize=10)
        ax.grid(True, color=GRID_C, alpha=0.25, linewidth=0.8)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)

    fig, axes = plt.subplots(3, 1, figsize=(10, 9), facecolor=FIG_BG)
    fig.subplots_adjust(left=0.10, right=0.97, top=0.95, bottom=0.07, hspace=0.45)

    # — Trap depth —
    depths = traces["U0_uK"]
    axes[0].plot(powers, depths, color=C_DEPTH, linewidth=2.4)
    axes[0].fill_between(powers, depths, color=C_DEPTH, alpha=0.15)
    _style(axes[0],
           "Lattice Depth" if mode == "lattice" else "Dipole Trap Depth",
           "Depth (μK)")

    # — Trap frequencies —
    f_ax  = traces["f_axial_kHz"]
    f_rad = traces["f_radial_kHz"]
    if mode == "lattice":
        axes[1].plot(powers, f_ax,  color=C_AX,  linewidth=2.4, label="Axial (tight)")
        axes[1].plot(powers, f_rad, color=C_RAD,  linewidth=2.4, linestyle="--", label="Radial")
    else:
        axes[1].plot(powers, f_rad, color=C_RAD,  linewidth=2.4, label="Radial (tight)")
        axes[1].plot(powers, f_ax,  color=C_AX,  linewidth=2.4, linestyle="--", label="Axial (weak)")
    _style(axes[1], "Trap Frequencies", "Frequency (kHz)")
    axes[1].legend(frameon=False, fontsize=9)

    # — Scattering rate —
    scatter = traces["scatter_rad_s"]
    axes[2].plot(powers, scatter, color=C_SCAT, linewidth=2.4)
    axes[2].fill_between(powers, scatter, color=C_SCAT, alpha=0.12)
    _style(axes[2], "Photon Scattering Rate (Rayleigh estimate)", "Rate (rad/s)")
    axes[2].set_xlabel("Power per beam (W)", fontsize=10)

    # ── Info table ──────────────────────────────────────────────────────────
    _info    = SUPPORTED_ATOMS[atom_select.value]
    _at_max  = {k: float(v[-1]) for k, v in traces.items()}
    _trap_sign = "repulsive (blue-det.)" if alpha_hz < 0 else "attractive (red-det.)"

    _rows = [
        ("Atom",                   f"{_info['display']} | F={fmt_qnum(F_select.value)}, mF={fmt_qnum(mF_select.value)}, q={q_select.value}"),
        ("Mode",                   mode.title()),
        ("Wavelength",             f"{wavelength_slider.value} nm"),
        ("Beam waist",             f"{waist_slider.value} μm"),
        ("Polarizability α",       f"{alpha_hz:.4e} Hz/(V/m)²  —  {_trap_sign}"),
        ("Depth at max power",     f"{_at_max['U0_uK']:.2f} μK"),
        ("Axial freq at max power",   f"{_at_max['f_axial_kHz']:.2f} kHz"),
        ("Radial freq at max power",  f"{_at_max['f_radial_kHz']:.2f} kHz"),
        ("Scatter rate at max power", f"{_at_max['scatter_rad_s']:.2f} rad/s"),
    ]
    if "zR_mm" in traces:
        _rows.append(("Rayleigh range", f"{float(traces['zR_mm'][-1]):.2f} mm"))

    _table = "| Parameter | Value |\n|:---|:---|\n" + "".join(
        f"| **{k}** | {v} |\n" for k, v in _rows
    )

    mo.vstack([fig, mo.md(_table)])
    return


if __name__ == "__main__":
    app.run()
