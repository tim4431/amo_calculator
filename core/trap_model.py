"""
Optical trap physics for lattice and single-beam dipole traps.

TrapModel wraps HFPolarizabilityCalculator and provides depth, trap-frequency,
and photon-scattering-rate calculations for both trap geometries.
"""

import numpy as np
from scipy.constants import epsilon_0 as eps0, c, k as kB, h, hbar

from .hf_pol import HFPolarizabilityCalculator, SUPPORTED_ATOMS


class TrapModel:
    """Unified model for optical lattice and Gaussian dipole traps.

    Parameters
    ----------
    atom_name : str
        Key in SUPPORTED_ATOMS (e.g. "Rb85").
    n, L, J : int/float
        Electronic quantum numbers of the state to polarise.
    F, mF : float
        Hyperfine quantum numbers.
    q : int
        Light polarisation: -1 (σ⁻), 0 (π), +1 (σ⁺).
    """

    def __init__(self, atom_name: str, n: int, L: int, J: float,
                 F: float, mF: float, q: int):
        self.atom_name = atom_name
        self._hfpol = HFPolarizabilityCalculator(atom_name, n, L, J, F, mF, q)
        self.m_atom = self._hfpol.get_atom_mass()

    # ── Polarizability ────────────────────────────────────────────────────────

    def get_polarizability(self, wavelength_m: float) -> float:
        """Dynamic polarizability [Hz/(V/m)²] at wavelength_m [m]."""
        return self._hfpol.calculate(wavelength_m)

    # ── Lattice trap ──────────────────────────────────────────────────────────

    def lattice_trap(self, lam: float, w0: float, power: float,
                     alpha_hz: float, power_is_total: bool = False) -> dict:
        """Trap depth and frequencies for a 1D standing-wave lattice.

        Parameters
        ----------
        lam        : wavelength [m]
        w0         : Gaussian beam waist [m]
        power      : per-beam power [W] (or total power if power_is_total=True)
        alpha_hz   : polarizability [Hz/(V/m)²]
        power_is_total : if True, power is split equally between the two beams

        Returns
        -------
        dict with keys: U0_uK, f_axial_kHz, f_radial_kHz
        """
        if power_is_total:
            power /= 2.0

        k = 2 * np.pi / lam
        u0_hz = 4 * alpha_hz * power / (np.pi * eps0 * c * w0**2)
        u0_j  = h * u0_hz

        if u0_j > 0:
            omega_ax  = np.sqrt(2 * u0_j * k**2 / self.m_atom)
            omega_rad = np.sqrt(4 * u0_j / (self.m_atom * w0**2))
            f_ax  = omega_ax  / (2 * np.pi) * 1e-3
            f_rad = omega_rad / (2 * np.pi) * 1e-3
        else:
            f_ax  = float("nan")
            f_rad = float("nan")

        return {
            "U0_uK":       u0_j / kB * 1e6,
            "f_axial_kHz": f_ax,
            "f_radial_kHz":f_rad,
        }

    def lattice_scatter_rate(self, lam: float, w0: float, power: float,
                             alpha_hz: float, power_is_total: bool = False) -> float:
        """Rayleigh photon scattering rate [rad/s] for a standing-wave lattice."""
        if power_is_total:
            power /= 2.0
        # Peak standing-wave intensity: 4 × single-beam peak × (2 for standing wave /2 for gaussian) = 8P/(πw²)
        I_peak = 8 * power / (np.pi * w0**2)
        return self._rayleigh_rate(lam, I_peak, alpha_hz)

    # ── Dipole trap ───────────────────────────────────────────────────────────

    def dipole_trap(self, lam: float, w0: float, power: float,
                    alpha_hz: float) -> dict:
        """Trap depth, frequencies, and Rayleigh range for a single Gaussian beam.

        Returns
        -------
        dict with keys: U0_uK, f_radial_kHz, f_axial_kHz, zR_mm
        """
        u0_hz = alpha_hz * power / (np.pi * eps0 * c * w0**2)
        u0_j  = h * u0_hz
        z_r   = np.pi * w0**2 / lam

        if u0_j > 0:
            omega_rad = np.sqrt(4 * u0_j / (self.m_atom * w0**2))
            omega_ax  = np.sqrt(2 * u0_j / (self.m_atom * z_r**2))
            f_rad = omega_rad / (2 * np.pi) * 1e-3
            f_ax  = omega_ax  / (2 * np.pi) * 1e-3
        else:
            f_rad = float("nan")
            f_ax  = float("nan")

        return {
            "U0_uK":        u0_j / kB * 1e6,
            "f_radial_kHz": f_rad,
            "f_axial_kHz":  f_ax,
            "zR_mm":        z_r * 1e3,
        }

    def dipole_scatter_rate(self, lam: float, w0: float, power: float,
                            alpha_hz: float) -> float:
        """Rayleigh photon scattering rate [rad/s] for a single Gaussian beam."""
        I_peak = 2 * power / (np.pi * w0**2)
        return self._rayleigh_rate(lam, I_peak, alpha_hz)

    # ── Vectorised sweeps ─────────────────────────────────────────────────────

    def compute_traces(self, mode: str, wavelength_m: float, waist_m: float,
                       alpha_hz: float, powers: np.ndarray) -> dict:
        """Compute trap properties over a power array.

        Parameters
        ----------
        mode       : "lattice" or "dipole"
        wavelength_m, waist_m : SI units
        alpha_hz   : pre-computed polarizability [Hz/(V/m)²]
        powers     : 1-D array of powers [W]

        Returns
        -------
        dict with arrays: U0_uK, f_axial_kHz, f_radial_kHz, scatter_rad_s
        (dipole mode also includes zR_mm)
        """
        n = len(powers)
        depths   = np.empty(n)
        f_axs    = np.empty(n)
        f_rads   = np.empty(n)
        scatters = np.empty(n)
        zRs      = np.empty(n) if mode == "dipole" else None

        for i, P in enumerate(powers):
            if mode == "lattice":
                trap     = self.lattice_trap(wavelength_m, waist_m, P, alpha_hz)
                scatter  = self.lattice_scatter_rate(wavelength_m, waist_m, P, alpha_hz)
            else:
                trap     = self.dipole_trap(wavelength_m, waist_m, P, alpha_hz)
                scatter  = self.dipole_scatter_rate(wavelength_m, waist_m, P, alpha_hz)
                zRs[i]   = trap["zR_mm"]

            depths[i]   = trap["U0_uK"]
            f_axs[i]    = trap["f_axial_kHz"]
            f_rads[i]   = trap["f_radial_kHz"]
            scatters[i] = scatter

        result = {
            "U0_uK":        depths,
            "f_axial_kHz":  f_axs,
            "f_radial_kHz": f_rads,
            "scatter_rad_s": scatters,
        }
        if zRs is not None:
            result["zR_mm"] = zRs
        return result

    # ── Shared helper ─────────────────────────────────────────────────────────

    def _rayleigh_rate(self, lam: float, I_peak: float, alpha_hz: float) -> float:
        """Rayleigh scattering rate [rad/s] given peak intensity.

        Uses the dipole cross-section σ = k⁴|α|² / (6π ε₀²).
        The returned rate is angular: Γ [rad/s] = 2π × Γ_Hz.
        """
        alpha_si = h * alpha_hz          # [C·m / (V/m)] = [C²·s²/kg]
        k        = 2 * np.pi / lam
        omega    = 2 * np.pi * c / lam
        sigma    = k**4 * abs(alpha_si)**2 / (6 * np.pi * eps0**2)
        Gamma_hz = sigma * I_peak / (hbar * omega)
        return 2 * np.pi * Gamma_hz      # rad/s
