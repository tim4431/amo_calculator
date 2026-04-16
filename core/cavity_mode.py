"""
Paraxial cavity-mode calculations on a position-defined 1D optical axis.

Design
------
- Optical elements live at explicit axis positions and return stable references
  when added to the axis.
- Propagation is inferred automatically from distances between element
  positions. You do not add free-space elements manually.
- Refractive index belongs to axis sectors, not to elements. Sector indices are
  assigned with ``set_sector(left_ref, right_ref, refractive_index)`` and are
  read automatically by surfaces.
- The cavity mode is solved between two endpoint element references. The
  returned result includes the intracavity branch plus left/right transmitted
  branches outside the cavity, with propagation stopping automatically at fully
  blocking components.

Sign Convention
---------------
For ``CurvedSurface``, ``radius > 0`` means the center of curvature lies to the
right along the global axis. Transmission uses the standard paraxial interface
sign convention. Reflection automatically flips the effective curvature when
the surface is encountered from the opposite side, so one physical surface can
be used consistently from either direction.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from typing import Union

import numpy as np
try:
    from scipy.constants import c as SPEED_OF_LIGHT
except Exception:  # pragma: no cover - fallback for environments without scipy
    SPEED_OF_LIGHT = 299792458.0

from .gaussian_beam import GaussianBeam


ElementRefLike = Union[int, str, "ElementReference"]


def _is_close(a: float, b: float, tol: float = 1e-12) -> bool:
    scale = max(1.0, abs(a), abs(b))
    return abs(a - b) <= tol * scale


def _to_float(value) -> float:
    return float(np.asarray(np.real_if_close(value)).item())


def _real_inverse_q(q: complex) -> float:
    with np.errstate(divide="ignore", invalid="ignore"):
        return float(np.real(1.0 / q))


def _validate_probability(name: str, value: float, label: str) -> None:
    if not (0.0 <= value <= 1.0):
        raise ValueError(f"{label}: {name} must lie in [0, 1], got {value}.")


def _validate_reflection(reflection: float, label: str) -> None:
    _validate_probability("reflection", reflection, label)


def _direction_sign(direction: int) -> int:
    if direction not in (-1, 1):
        raise ValueError(f"direction must be +1 or -1, got {direction}.")
    return direction


@dataclass(frozen=True)
class ABCDMatrix:
    """Ray-transfer matrix for paraxial optics."""

    A: float
    B: float
    C: float
    D: float
    label: str = ""

    @classmethod
    def identity(cls, label: str = "identity") -> "ABCDMatrix":
        return cls(1.0, 0.0, 0.0, 1.0, label=label)

    @property
    def array(self) -> np.ndarray:
        return np.array([[self.A, self.B], [self.C, self.D]], dtype=float)

    @property
    def determinant(self) -> float:
        return self.A * self.D - self.B * self.C

    @property
    def trace(self) -> float:
        return self.A + self.D

    @property
    def stability_discriminant(self) -> float:
        """Return ``trace**2 - 4 * determinant`` for the cavity fixed-point equation.

        A real ABCD matrix is strictly stable when this quantity is negative,
        marginally stable when it vanishes, and unstable when it is positive.
        For unit-determinant systems this reduces to the familiar
        ``|A + D| < 2`` criterion.
        """
        return self.trace**2 - 4.0 * self.determinant

    @property
    def stability_parameter(self) -> float:
        """Return the normalized half-trace used in cavity-stability diagrams.

        This is ``(A + D) / (2 * sqrt(det(M)))`` when ``det(M) > 0`` and
        ``nan`` otherwise.
        """
        det = self.determinant
        if det <= 0:
            return float("nan")
        return self.trace / (2.0 * np.sqrt(det))

    def is_stable(self, tol: float = 1e-12) -> bool:
        """Return whether the real ABCD matrix lies inside the stable region."""
        det = self.determinant
        if det <= tol:
            return False
        return self.stability_discriminant < -tol

    def is_marginally_stable(self, tol: float = 1e-12) -> bool:
        """Return whether the matrix lies on the stability boundary."""
        det = self.determinant
        if det <= tol:
            return False
        return abs(self.stability_discriminant) <= tol

    def stability_diagram(
        self, span: float | None = None, num_points: int = 512
    ) -> dict[str, float | bool | np.ndarray]:
        """Return trace-determinant stability-diagram data for this matrix.

        The returned boundary curve is the parabola
        ``determinant = trace**2 / 4``, which separates stable and unstable
        regions for real ABCD matrices. The current matrix position is included
        so callers can plot it directly on the diagram.
        """
        if num_points < 2:
            raise ValueError("num_points must be at least 2.")

        trace = self.trace
        determinant = self.determinant
        if span is None:
            span = max(2.5, 1.25 * abs(trace), 1.25 * np.sqrt(max(determinant, 0.0)))

        trace_axis = np.linspace(-span, span, num_points, dtype=float)
        boundary_determinant = 0.25 * trace_axis**2
        return {
            "trace_axis": trace_axis,
            "boundary_determinant": boundary_determinant,
            "trace": trace,
            "determinant": determinant,
            "stability_discriminant": self.stability_discriminant,
            "stability_parameter": self.stability_parameter,
            "stable": self.is_stable(),
            "marginally_stable": self.is_marginally_stable(),
        }

    def inverse(self) -> "ABCDMatrix":
        det = self.determinant
        if _is_close(det, 0.0):
            raise ValueError("The ABCD matrix is singular and cannot be inverted.")
        return ABCDMatrix(
            A=self.D / det,
            B=-self.B / det,
            C=-self.C / det,
            D=self.A / det,
            label=f"{self.label}^-1" if self.label else "inverse",
        )

    def transform_q(self, q: complex) -> complex:
        """Apply the ABCD transform to a Gaussian-beam ``q`` parameter."""
        denominator = self.C * q + self.D
        if abs(denominator) == 0:
            raise ZeroDivisionError(
                f"{self.label or 'ABCD matrix'} maps q to a singular point."
            )
        return (self.A * q + self.B) / denominator

    def solve_cavity_q(self, imag_tol: float = 1e-12) -> complex:
        """Solve the self-consistent cavity condition ``q = (Aq+B)/(Cq+D)``."""
        if _is_close(self.C, 0.0):
            denominator = self.D - self.A
            if _is_close(denominator, 0.0):
                raise ValueError(
                    "The round-trip matrix is degenerate and does not define a unique cavity mode."
                )
            q = self.B / denominator
            if np.imag(q) <= imag_tol:
                raise ValueError(
                    "The round-trip matrix does not yield a stable cavity mode with Im(q) > 0."
                )
            return complex(q)

        roots = np.roots([self.C, self.D - self.A, -self.B])
        stable_roots = [complex(root) for root in roots if np.imag(root) > imag_tol]
        if not stable_roots:
            raise ValueError(
                "No stable cavity mode found. Check the cavity geometry or sign conventions."
            )
        return max(stable_roots, key=np.imag)

    def __matmul__(self, other: "ABCDMatrix") -> "ABCDMatrix":
        """Compose matrices so that ``self @ other`` means ``self(other(x))``."""
        return ABCDMatrix(
            A=self.A * other.A + self.B * other.C,
            B=self.A * other.B + self.B * other.D,
            C=self.C * other.A + self.D * other.C,
            D=self.C * other.B + self.D * other.D,
            label=self.label or other.label,
        )


@dataclass(frozen=True)
class ElementReference:
    """Stable handle returned when an optical element is placed on the axis."""

    element_id: int
    label: str
    position: float


@dataclass(frozen=True)
class SectorDefinition:
    """Refractive-index sector between two element references."""

    left: ElementReference | None
    right: ElementReference | None
    refractive_index: float
    label: str = ""


class OpticalElement:
    """Base class for axis elements."""

    label: str
    reflection: float

    @property
    def transmission(self) -> float:
        return 1.0 - self.reflection

    @property
    def kind(self) -> str:
        return self.__class__.__name__

    def transmission_matrix(
        self, n_left: float, n_right: float, direction: int = 1
    ) -> ABCDMatrix:
        raise NotImplementedError

    def reflection_matrix(
        self, n_left: float, n_right: float, direction: int = 1
    ) -> ABCDMatrix:
        _direction_sign(direction)
        return ABCDMatrix.identity(label=f"{self.label} reflect")

    def interaction_coefficient(self, interaction: str) -> float:
        if interaction == "transmit":
            return self.transmission
        if interaction == "reflect":
            return self.reflection
        raise ValueError(f"Unknown interaction {interaction!r}.")


@dataclass(frozen=True)
class Lens(OpticalElement):
    """Thin lens with focal length ``f``."""

    focal_length: float
    label: str = "lens"
    reflection: float = 0.0

    def __post_init__(self):
        if _is_close(self.focal_length, 0.0):
            raise ValueError("Lens focal length must be non-zero.")
        _validate_reflection(self.reflection, self.label)

    def transmission_matrix(
        self, n_left: float, n_right: float, direction: int = 1
    ) -> ABCDMatrix:
        _direction_sign(direction)
        if not _is_close(n_left, n_right):
            raise ValueError(
                f"{self.label} is a thin lens and expects the same refractive index on both sides, "
                f"got n_left={n_left} and n_right={n_right}."
            )
        return ABCDMatrix(1.0, 0.0, -1.0 / self.focal_length, 1.0, label=self.label)


@dataclass(frozen=True)
class PlaneSurface(OpticalElement):
    """Planar interface that reads its left/right refractive indices from sectors."""

    label: str = "plane surface"
    reflection: float = 0.0

    def __post_init__(self):
        _validate_reflection(self.reflection, self.label)

    def transmission_matrix(
        self, n_left: float, n_right: float, direction: int = 1
    ) -> ABCDMatrix:
        direction = _direction_sign(direction)
        if direction == 1:
            n_in = n_left
            n_out = n_right
        else:
            n_in = n_right
            n_out = n_left

        return ABCDMatrix(
            1.0,
            0.0,
            0.0,
            n_in / n_out,
            label=f"{self.label} transmit",
        )


@dataclass(frozen=True)
class CurvedSurface(OpticalElement):
    """Spherical interface with global-axis radius of curvature ``radius``."""

    radius: float
    label: str = "curved surface"
    reflection: float = 0.0

    def __post_init__(self):
        if _is_close(self.radius, 0.0):
            raise ValueError("CurvedSurface radius must be non-zero.")
        _validate_reflection(self.reflection, self.label)

    def transmission_matrix(
        self, n_left: float, n_right: float, direction: int = 1
    ) -> ABCDMatrix:
        direction = _direction_sign(direction)
        if direction == 1:
            n_in = n_left
            n_out = n_right
            radius = self.radius
        else:
            n_in = n_right
            n_out = n_left
            radius = -self.radius

        curvature_term = (n_in - n_out) / (radius * n_out)
        return ABCDMatrix(
            1.0,
            0.0,
            curvature_term,
            n_in / n_out,
            label=f"{self.label} transmit",
        )

    def reflection_matrix(
        self, n_left: float, n_right: float, direction: int = 1
    ) -> ABCDMatrix:
        direction = _direction_sign(direction)
        local_radius = -direction * self.radius
        return ABCDMatrix(
            1.0,
            0.0,
            -2.0 / local_radius,
            1.0,
            label=f"{self.label} reflect",
        )


@dataclass(frozen=True)
class _PlacedElement:
    """Internal axis placement."""

    ref: ElementReference
    element: OpticalElement


@dataclass(frozen=True)
class _ResolvedElement:
    """Element placement plus surrounding sector indices."""

    ref: ElementReference
    element: OpticalElement
    order_index: int
    index_left: float
    index_right: float


@dataclass(frozen=True)
class _TraversalUnit:
    """Internal propagation or element interaction used to build a path."""

    label: str
    kind: str
    interaction: str
    direction: int
    position_in: float
    position_out: float
    index_in: float
    index_out: float
    matrix: ABCDMatrix
    coefficient: float
    element_ref: ElementReference | None = None
    element: OpticalElement | None = None
    sector_label: str = ""

    @property
    def physical_length(self) -> float:
        return abs(self.position_out - self.position_in)


@dataclass(frozen=True)
class BeamPoint:
    """Beam diagnostics evaluated at one plane on the axis."""

    position: float
    refractive_index: float
    direction: int
    q: complex
    distance_to_waist: float
    waist_radius: float
    waist_position: float
    rayleigh_range: float
    spot_size: float
    radius_of_curvature: float

    @classmethod
    def from_q(
        cls,
        position: float,
        q: complex,
        wavelength: float,
        refractive_index: float,
        direction: int = 1,
    ) -> "BeamPoint":
        direction = _direction_sign(direction)
        distance_to_waist = _to_float(GaussianBeam.distance_to_waist(q))
        rayleigh_range = _to_float(GaussianBeam.rayleigh_range(q))
        waist_radius = _to_float(GaussianBeam.waist(q, wavelength, refractive_index))

        q_waist = 1j * rayleigh_range
        spot_size = _to_float(
            GaussianBeam.spot_size(
                q_waist,
                distance_to_waist,
                wavelength,
                refractive_index,
            )
        )

        with np.errstate(divide="ignore", invalid="ignore"):
            curvature = GaussianBeam.radius_of_curvature(q)

        curvature_array = np.asarray(np.real_if_close(curvature))
        if curvature_array.ndim != 0:
            raise ValueError("BeamPoint expects a scalar q parameter.")

        if np.isfinite(curvature_array.item()):
            radius_of_curvature = float(curvature_array.item())
        else:
            radius_of_curvature = float("inf")

        return cls(
            position=position,
            refractive_index=refractive_index,
            direction=direction,
            q=complex(q),
            distance_to_waist=distance_to_waist,
            waist_radius=waist_radius,
            waist_position=position - direction * distance_to_waist,
            rayleigh_range=rayleigh_range,
            spot_size=spot_size,
            radius_of_curvature=radius_of_curvature,
        )


@dataclass(frozen=True)
class ModeStep:
    """Propagated Gaussian mode across one inferred segment or element."""

    label: str
    kind: str
    interaction: str
    direction: int
    position_in: float
    position_out: float
    index_in: float
    index_out: float
    q_in: complex
    q_out: complex
    coefficient: float
    cumulative_coefficient: float
    beam_in: BeamPoint
    beam_out: BeamPoint
    element_ref: ElementReference | None = None
    element: OpticalElement | None = None
    sector_label: str = ""

    @property
    def physical_length(self) -> float:
        return abs(self.position_out - self.position_in)

    @property
    def optical_path_length(self) -> float:
        if self.kind != "propagation":
            return 0.0
        return self.index_in * self.physical_length


@dataclass(frozen=True)
class PropagationPath:
    """One propagated branch of the cavity mode."""

    name: str
    wavelength: float
    direction: int
    start_position: float
    start_index: float
    start_q: complex
    steps: tuple[ModeStep, ...]
    blocked_by: ElementReference | None = None
    blocked_element: OpticalElement | None = None
    blocked_position: float | None = None

    @property
    def start_beam(self) -> BeamPoint:
        if self.steps:
            return self.steps[0].beam_in
        return BeamPoint.from_q(
            position=self.start_position,
            q=self.start_q,
            wavelength=self.wavelength,
            refractive_index=self.start_index,
            direction=self.direction,
        )

    @property
    def end_beam(self) -> BeamPoint:
        if self.steps:
            return self.steps[-1].beam_out
        return self.start_beam

    @property
    def end_q(self) -> complex:
        return self.end_beam.q

    @property
    def cumulative_coefficient(self) -> float:
        if not self.steps:
            return 1.0
        return self.steps[-1].cumulative_coefficient

    @property
    def geometric_length(self) -> float:
        return float(
            sum(step.physical_length for step in self.steps if step.kind == "propagation")
        )

    @property
    def optical_path_length(self) -> float:
        return float(sum(step.optical_path_length for step in self.steps))

    @property
    def is_blocked(self) -> bool:
        return self.blocked_by is not None

    def beam_at(self, position: float) -> BeamPoint:
        """Evaluate the solved mode at an exact position on this branch."""
        if not self.steps:
            if _is_close(position, self.start_position):
                return self.start_beam
            raise ValueError(
                f"Position {position} does not lie on the path {self.name!r}."
            )

        if _is_close(position, self.start_position):
            return self.start_beam

        for step in self.steps:
            low = min(step.position_in, step.position_out)
            high = max(step.position_in, step.position_out)
            if step.kind == "propagation" and low <= position <= high:
                distance = abs(position - step.position_in)
                q = GaussianBeam.q_at_z(step.q_in, distance)
                return BeamPoint.from_q(
                    position=position,
                    q=q,
                    wavelength=self.wavelength,
                    refractive_index=step.index_in,
                    direction=self.direction,
                )

            if _is_close(position, step.position_out):
                return step.beam_out

            if _is_close(position, step.position_in):
                return step.beam_in

        raise ValueError(f"Position {position} does not lie on the path {self.name!r}.")

    def profile(self, samples_per_segment: int = 64) -> dict[str, np.ndarray]:
        """Sample the propagated mode along this path."""
        if samples_per_segment < 1:
            raise ValueError("samples_per_segment must be at least 1.")

        start = self.start_beam
        positions = [start.position]
        q_values = [start.q]
        spot_sizes = [start.spot_size]
        refractive_indices = [start.refractive_index]

        for step in self.steps:
            if step.kind == "propagation" and step.physical_length > 0:
                z_local = np.linspace(
                    0.0,
                    step.physical_length,
                    samples_per_segment + 1,
                    dtype=float,
                )[1:]
                q_local = GaussianBeam.q_at_z(step.q_in, z_local)
                z_from_waist = GaussianBeam.distance_to_waist(step.q_in) + z_local
                q_waist = 1j * GaussianBeam.rayleigh_range(step.q_in)
                w_local = GaussianBeam.spot_size(
                    q_waist,
                    z_from_waist,
                    self.wavelength,
                    step.index_in,
                )

                positions.extend(step.position_in + step.direction * z_local)
                q_values.extend(np.asarray(q_local, dtype=complex).tolist())
                spot_sizes.extend(np.asarray(w_local, dtype=float).tolist())
                refractive_indices.extend([step.index_in] * len(z_local))
            else:
                positions.append(step.beam_out.position)
                q_values.append(step.beam_out.q)
                spot_sizes.append(step.beam_out.spot_size)
                refractive_indices.append(step.beam_out.refractive_index)

        return {
            "position": np.asarray(positions, dtype=float),
            "q": np.asarray(q_values, dtype=complex),
            "spot_size": np.asarray(spot_sizes, dtype=float),
            "refractive_index": np.asarray(refractive_indices, dtype=float),
        }


@dataclass(frozen=True)
class CavityModeSolution:
    """Self-consistent cavity mode solved between two endpoint references."""

    wavelength: float
    left_endpoint: ElementReference
    right_endpoint: ElementReference
    q_left: complex
    q_right: complex
    one_way_forward_matrix: ABCDMatrix
    one_way_backward_matrix: ABCDMatrix
    round_trip_matrix: ABCDMatrix
    inside_path: PropagationPath
    left_path: PropagationPath
    right_path: PropagationPath
    one_way_coefficient: float
    round_trip_coefficient: float

    @property
    def reference_beam(self) -> BeamPoint:
        return self.inside_path.start_beam

    @property
    def paths(self) -> dict[str, PropagationPath]:
        return {
            "inside": self.inside_path,
            "left": self.left_path,
            "right": self.right_path,
        }

    @property
    def waist_radius(self) -> float:
        return self.reference_beam.waist_radius

    @property
    def waist_position(self) -> float:
        return self.reference_beam.waist_position

    @property
    def rayleigh_range(self) -> float:
        return self.reference_beam.rayleigh_range

    @property
    def round_trip_power_retention(self) -> float:
        """Return the effective round-trip power-retention coefficient."""
        return float(np.clip(self.round_trip_coefficient, 0.0, 1.0))

    @property
    def round_trip_amplitude_retention(self) -> float:
        """Return the effective round-trip field-amplitude coefficient."""
        return float(np.sqrt(self.round_trip_power_retention))

    @property
    def one_way_geometric_length(self) -> float:
        """Return the one-way geometric length between the selected endpoints."""
        return self.inside_path.geometric_length

    @property
    def one_way_optical_path_length(self) -> float:
        """Return the one-way optical path length ``sum(n_i * L_i)`` inside the cavity."""
        return self.inside_path.optical_path_length

    @property
    def round_trip_optical_path_length(self) -> float:
        """Return the round-trip optical path length."""
        return 2.0 * self.one_way_optical_path_length

    @property
    def stability_parameter(self) -> float:
        """Return the normalized stability parameter of the round-trip matrix."""
        return self.round_trip_matrix.stability_parameter

    @property
    def is_stable(self) -> bool:
        """Return whether the solved round-trip matrix is strictly stable."""
        return self.round_trip_matrix.is_stable()

    @property
    def is_marginally_stable(self) -> bool:
        """Return whether the solved round-trip matrix is on the stability edge."""
        return self.round_trip_matrix.is_marginally_stable()

    @property
    def finesse(self) -> float:
        """Return the cavity finesse from the effective round-trip retention.

        The stored ``round_trip_coefficient`` is an effective round-trip power
        retention. Converting it to the corresponding field-amplitude
        coefficient ``r_rt`` gives the usual Fabry-Perot estimate

        ``F = pi * sqrt(r_rt) / (1 - r_rt)``.
        """
        r_rt = self.round_trip_amplitude_retention
        if r_rt <= 0:
            return 0.0
        if r_rt >= 1.0 - 1e-12:
            return float("inf")
        return float(np.pi * np.sqrt(r_rt) / (1.0 - r_rt))

    @property
    def free_spectral_range(self) -> float:
        """Return the cavity free spectral range in Hz.

        For a linear cavity this is ``c / (2 * sum(n_i * L_i))`` using the
        one-way optical path between the chosen endpoints.
        """
        optical_length = self.one_way_optical_path_length
        if optical_length <= 0:
            return float("inf")
        return float(SPEED_OF_LIGHT / (2.0 * optical_length))

    def stability_diagram(
        self, span: float | None = None, num_points: int = 512
    ) -> dict[str, float | bool | np.ndarray]:
        """Return stability-diagram data for the cavity round-trip matrix."""
        return self.round_trip_matrix.stability_diagram(span=span, num_points=num_points)

    def beam_at(self, position: float, branch: str = "inside") -> BeamPoint:
        """Evaluate the solved mode at an exact position on one branch."""
        try:
            path = self.paths[branch]
        except KeyError as exc:
            raise ValueError(
                f"Unknown branch {branch!r}. Use one of {sorted(self.paths)}."
            ) from exc
        return path.beam_at(position)

    def profiles(self, samples_per_segment: int = 64) -> dict[str, dict[str, np.ndarray]]:
        """Return sampled profiles for the accessible branches."""
        return {
            "inside": self.inside_path.profile(samples_per_segment=samples_per_segment),
            "left": self.left_path.profile(samples_per_segment=samples_per_segment),
            "right": self.right_path.profile(samples_per_segment=samples_per_segment),
        }


IntervalCavityModeSolution = CavityModeSolution


@dataclass
class OpticalAxis:
    """Position-defined optical axis with sector-based refractive indices."""

    default_refractive_index: float = 1.0
    _elements: list[_PlacedElement] = field(default_factory=list, init=False, repr=False)
    _sectors: list[SectorDefinition] = field(default_factory=list, init=False, repr=False)
    _next_element_id: int = field(default=0, init=False, repr=False)

    def __post_init__(self):
        if self.default_refractive_index <= 0:
            raise ValueError("default_refractive_index must be positive.")

    def add_lens(
        self,
        position: float,
        focal_length: float,
        label: str = "lens",
        reflection: float = 0.0,
    ) -> ElementReference:
        return self._add_element(
            Lens(
                focal_length=focal_length,
                label=label,
                reflection=reflection,
            ),
            position=position,
        )

    def add_plane_surface(
        self,
        position: float,
        label: str = "plane surface",
        reflection: float = 0.0,
    ) -> ElementReference:
        return self._add_element(
            PlaneSurface(
                label=label,
                reflection=reflection,
            ),
            position=position,
        )

    def add_curved_surface(
        self,
        position: float,
        radius: float,
        label: str = "curved surface",
        reflection: float = 0.0,
    ) -> ElementReference:
        return self._add_element(
            CurvedSurface(
                radius=radius,
                label=label,
                reflection=reflection,
            ),
            position=position,
        )

    def _add_element(self, element: OpticalElement, position: float) -> ElementReference:
        ref = ElementReference(
            element_id=self._next_element_id,
            label=element.label,
            position=float(position),
        )
        self._next_element_id += 1
        self._elements.append(_PlacedElement(ref=ref, element=element))
        return ref

    def set_sector(
        self,
        left: ElementRefLike | None,
        right: ElementRefLike | None,
        refractive_index: float,
        label: str = "",
    ) -> SectorDefinition:
        """Set the refractive index on the sector between two boundaries."""
        if refractive_index <= 0:
            raise ValueError("refractive_index must be positive.")

        left_ref = self._resolve_reference(left) if left is not None else None
        right_ref = self._resolve_reference(right) if right is not None else None

        left_position = -np.inf if left_ref is None else left_ref.position
        right_position = np.inf if right_ref is None else right_ref.position
        if not left_position < right_position:
            raise ValueError("Sector boundaries must satisfy left.position < right.position.")

        sector = SectorDefinition(
            left=left_ref,
            right=right_ref,
            refractive_index=float(refractive_index),
            label=label,
        )
        self._sectors.append(sector)
        return sector

    def set_refractive_index(
        self,
        left: ElementRefLike | None,
        right: ElementRefLike | None,
        refractive_index: float,
        label: str = "",
    ) -> SectorDefinition:
        """Alias for ``set_sector``."""
        return self.set_sector(left, right, refractive_index, label=label)

    @property
    def elements(self) -> tuple[ElementReference, ...]:
        ordered = self._ordered_elements()
        return tuple(placed.ref for placed in ordered)

    @property
    def sectors(self) -> tuple[SectorDefinition, ...]:
        return tuple(self._sectors)

    def solve_cavity_mode(
        self,
        wavelength: float,
        left_endpoint: ElementRefLike,
        right_endpoint: ElementRefLike,
    ) -> CavityModeSolution:
        """Solve the cavity mode between two endpoint element references."""
        if wavelength <= 0:
            raise ValueError("wavelength must be positive.")
        if not self._elements:
            raise ValueError("The optical axis is empty.")

        ordered = self._resolved_elements()
        by_id = {item.ref.element_id: item for item in ordered}

        left_ref = self._resolve_reference(left_endpoint)
        right_ref = self._resolve_reference(right_endpoint)
        left_item = by_id[left_ref.element_id]
        right_item = by_id[right_ref.element_id]

        if left_item.order_index >= right_item.order_index:
            raise ValueError("left_endpoint must appear before right_endpoint on the axis.")

        if left_item.element.reflection <= 0:
            raise ValueError(
                f"Left endpoint {left_item.ref.label!r} has zero reflection and cannot close the cavity."
            )
        if right_item.element.reflection <= 0:
            raise ValueError(
                f"Right endpoint {right_item.ref.label!r} has zero reflection and cannot close the cavity."
            )

        inside_forward_units = self._build_inside_units(
            ordered, left_item.order_index, right_item.order_index, direction=1
        )
        inside_backward_units = self._build_inside_units(
            ordered, left_item.order_index, right_item.order_index, direction=-1
        )

        blocked_inside = [
            unit.label for unit in inside_forward_units if unit.coefficient <= 0
        ]
        if blocked_inside:
            raise ValueError(
                "The chosen cavity interval contains fully blocking elements: "
                + ", ".join(blocked_inside)
            )

        one_way_forward_matrix = self._matrix_for_units(inside_forward_units)
        one_way_backward_matrix = self._matrix_for_units(inside_backward_units)
        one_way_coefficient = self._coefficient_for_units(inside_forward_units)

        right_reflection = right_item.element.reflection_matrix(
            right_item.index_left,
            right_item.index_right,
            direction=1,
        )
        left_reflection = left_item.element.reflection_matrix(
            left_item.index_left,
            left_item.index_right,
            direction=-1,
        )

        round_trip_matrix = (
            left_reflection
            @ one_way_backward_matrix
            @ right_reflection
            @ one_way_forward_matrix
        )
        try:
            q_left = round_trip_matrix.solve_cavity_q()
        except ValueError as exc:
            if "degenerate" not in str(exc):
                raise
            q_left = self._solve_degenerate_cavity_q(
                left_item=left_item,
                right_item=right_item,
                one_way_forward_matrix=one_way_forward_matrix,
            )
        q_right = one_way_forward_matrix.transform_q(q_left)
        q_right_reflected = right_reflection.transform_q(q_right)
        q_left_incident = one_way_backward_matrix.transform_q(q_right_reflected)

        inside_path = self._propagate_units(
            inside_forward_units,
            q0=q_left,
            wavelength=wavelength,
            direction=1,
            name="inside cavity",
            start_position=left_item.ref.position,
            start_index=left_item.index_right,
        )

        left_units = self._build_outside_units(
            ordered, boundary_order_index=left_item.order_index, direction=-1
        )
        left_transmit = self._build_surface_unit(left_item, direction=-1, interaction="transmit")
        left_path = self._propagate_units(
            (left_transmit,) + left_units,
            q0=q_left_incident,
            wavelength=wavelength,
            direction=-1,
            name="left branch",
            start_position=left_item.ref.position,
            start_index=left_item.index_right,
        )

        right_units = self._build_outside_units(
            ordered, boundary_order_index=right_item.order_index, direction=1
        )
        right_transmit = self._build_surface_unit(right_item, direction=1, interaction="transmit")
        right_path = self._propagate_units(
            (right_transmit,) + right_units,
            q0=q_right,
            wavelength=wavelength,
            direction=1,
            name="right branch",
            start_position=right_item.ref.position,
            start_index=right_item.index_left,
        )

        round_trip_coefficient = (
            left_item.element.reflection
            * right_item.element.reflection
            * one_way_coefficient**2
        )

        return CavityModeSolution(
            wavelength=wavelength,
            left_endpoint=left_item.ref,
            right_endpoint=right_item.ref,
            q_left=q_left,
            q_right=q_right,
            one_way_forward_matrix=one_way_forward_matrix,
            one_way_backward_matrix=one_way_backward_matrix,
            round_trip_matrix=round_trip_matrix,
            inside_path=inside_path,
            left_path=left_path,
            right_path=right_path,
            one_way_coefficient=one_way_coefficient,
            round_trip_coefficient=round_trip_coefficient,
        )

    def _solve_degenerate_cavity_q(
        self,
        left_item: _ResolvedElement,
        right_item: _ResolvedElement,
        one_way_forward_matrix: ABCDMatrix,
    ) -> complex:
        """Fallback solver for degenerate round-trip matrices such as confocal cavities."""
        left_target_inv = self._endpoint_target_inverse_curvature(left_item)
        right_target_inv = self._endpoint_target_inverse_curvature(right_item)
        cavity_length = right_item.ref.position - left_item.ref.position

        def equations(vec: np.ndarray) -> np.ndarray:
            x, y = vec
            if y <= 0:
                return np.array([1e6 + y**2, 1e6 + y**2], dtype=float)

            q_left = complex(x, y)
            q_right = one_way_forward_matrix.transform_q(q_left)
            return np.array(
                [
                    _real_inverse_q(q_left) - left_target_inv,
                    _real_inverse_q(q_right) - right_target_inv,
                ],
                dtype=float,
            )

        guesses = [
            np.array([-0.5 * cavity_length, 0.5 * cavity_length], dtype=float),
            np.array([-0.5 * cavity_length, 0.25 * cavity_length], dtype=float),
            np.array([0.0, 0.5 * cavity_length], dtype=float),
            np.array([-0.25 * cavity_length, 0.5 * cavity_length], dtype=float),
        ]

        best_q: complex | None = None
        best_residual = np.inf

        for guess in guesses:
            result = self._solve_nonlinear_system(equations, guess)
            if result is None:
                continue

            q_candidate = complex(result[0], result[1])
            if np.imag(q_candidate) <= 0:
                continue

            residual = float(np.linalg.norm(equations(result)))
            if residual < best_residual:
                best_residual = residual
                best_q = q_candidate

        if best_q is None or best_residual > 1e-8:
            raise ValueError(
                "The round-trip matrix is degenerate and the curvature-based fallback solver "
                "could not determine a unique cavity mode."
            )

        return best_q

    @staticmethod
    def _solve_nonlinear_system(
        equations,
        initial_guess: np.ndarray,
        max_iterations: int = 50,
        tolerance: float = 1e-12,
    ) -> np.ndarray | None:
        """Solve a 2D nonlinear system with a damped Newton iteration."""
        x = np.asarray(initial_guess, dtype=float)

        for _ in range(max_iterations):
            f = np.asarray(equations(x), dtype=float)
            residual = float(np.linalg.norm(f))
            if not np.isfinite(residual):
                return None
            if residual < tolerance:
                return x

            step_scale = 1e-8 * max(1.0, np.linalg.norm(x))
            jacobian = np.empty((2, 2), dtype=float)
            for idx in range(2):
                delta = np.zeros(2, dtype=float)
                delta[idx] = step_scale
                jacobian[:, idx] = (np.asarray(equations(x + delta), dtype=float) - f) / step_scale

            try:
                delta_x = np.linalg.solve(jacobian, -f)
            except np.linalg.LinAlgError:
                return None

            accepted = False
            damping = 1.0
            while damping >= 1e-4:
                candidate = x + damping * delta_x
                if candidate[1] <= 0:
                    damping *= 0.5
                    continue

                candidate_f = np.asarray(equations(candidate), dtype=float)
                candidate_residual = float(np.linalg.norm(candidate_f))
                if np.isfinite(candidate_residual) and candidate_residual < residual:
                    x = candidate
                    accepted = True
                    break
                damping *= 0.5

            if not accepted:
                return None

        final_residual = float(np.linalg.norm(np.asarray(equations(x), dtype=float)))
        if np.isfinite(final_residual) and final_residual < tolerance:
            return x
        return None

    @staticmethod
    def _endpoint_target_inverse_curvature(item: _ResolvedElement) -> float:
        if isinstance(item.element, PlaneSurface):
            return 0.0
        if isinstance(item.element, CurvedSurface):
            return -1.0 / item.element.radius
        raise ValueError(
            "Degenerate cavity fallback is only supported when the endpoints are "
            "PlaneSurface or CurvedSurface elements."
        )

    def _resolve_reference(self, ref: ElementRefLike) -> ElementReference:
        if isinstance(ref, ElementReference):
            for placed in self._elements:
                if placed.ref.element_id == ref.element_id:
                    return placed.ref
            raise ValueError("The referenced element does not belong to this axis.")

        if isinstance(ref, int):
            for placed in self._elements:
                if placed.ref.element_id == ref:
                    return placed.ref
            raise ValueError(f"No element with id {ref} exists on this axis.")

        if isinstance(ref, str):
            matches = [placed.ref for placed in self._elements if placed.ref.label == ref]
            if not matches:
                raise ValueError(f"No element with label {ref!r} exists on this axis.")
            if len(matches) > 1:
                raise ValueError(
                    f"Label {ref!r} is ambiguous. Use the reference returned by add_xxx."
                )
            return matches[0]

        raise TypeError(f"Unsupported element reference {ref!r}.")

    def _ordered_elements(self) -> tuple[_PlacedElement, ...]:
        return tuple(
            sorted(
                self._elements,
                key=lambda placed: (placed.ref.position, placed.ref.element_id),
            )
        )

    def _ordered_positions(self, ordered: tuple[_PlacedElement, ...]) -> tuple[float, ...]:
        if not ordered:
            return tuple()
        return tuple(sorted({placed.ref.position for placed in ordered}))

    def _interval_bounds_for_sector(
        self, sector: SectorDefinition
    ) -> tuple[float, float]:
        left = -np.inf if sector.left is None else sector.left.position
        right = np.inf if sector.right is None else sector.right.position
        return left, right

    def _index_for_interval(self, left: float, right: float) -> tuple[float, str]:
        if not left < right:
            raise ValueError("Intervals used to determine refractive index must have left < right.")

        matches: list[tuple[float, SectorDefinition]] = []
        for sector in self._sectors:
            sector_left, sector_right = self._interval_bounds_for_sector(sector)
            if sector_left <= left and sector_right >= right:
                matches.append((sector_right - sector_left, sector))

        if not matches:
            return self.default_refractive_index, ""

        matches.sort(key=lambda item: item[0])
        best_width, best_sector = matches[0]
        tied = [sector for width, sector in matches if _is_close(width, best_width)]
        if len(tied) > 1:
            raise ValueError(
                "Overlapping sector definitions make the refractive index ambiguous."
            )
        return best_sector.refractive_index, best_sector.label

    def _resolved_elements(self) -> tuple[_ResolvedElement, ...]:
        ordered = self._ordered_elements()
        positions = self._ordered_positions(ordered)
        resolved: list[_ResolvedElement] = []

        for order_index, placed in enumerate(ordered):
            position = placed.ref.position
            left_idx = bisect_left(positions, position)
            right_idx = bisect_right(positions, position)

            left_bound = positions[left_idx - 1] if left_idx > 0 else -np.inf
            right_bound = positions[right_idx] if right_idx < len(positions) else np.inf

            index_left, _ = self._index_for_interval(left_bound, position)
            index_right, _ = self._index_for_interval(position, right_bound)

            resolved.append(
                _ResolvedElement(
                    ref=placed.ref,
                    element=placed.element,
                    order_index=order_index,
                    index_left=index_left,
                    index_right=index_right,
                )
            )

        return tuple(resolved)

    def _propagation_unit(
        self, position_a: float, position_b: float, direction: int
    ) -> _TraversalUnit:
        direction = _direction_sign(direction)
        left = min(position_a, position_b)
        right = max(position_a, position_b)
        refractive_index, sector_label = self._index_for_interval(left, right)

        return _TraversalUnit(
            label=sector_label or f"sector n={refractive_index:g}",
            kind="propagation",
            interaction="propagate",
            direction=direction,
            position_in=position_a,
            position_out=position_b,
            index_in=refractive_index,
            index_out=refractive_index,
            matrix=ABCDMatrix(
                1.0,
                abs(position_b - position_a),
                0.0,
                1.0,
                label=sector_label or "propagation",
            ),
            coefficient=1.0,
            sector_label=sector_label,
        )

    def _build_surface_unit(
        self,
        item: _ResolvedElement,
        direction: int,
        interaction: str = "transmit",
    ) -> _TraversalUnit:
        direction = _direction_sign(direction)
        if interaction == "transmit":
            matrix = item.element.transmission_matrix(
                item.index_left,
                item.index_right,
                direction=direction,
            )
        elif interaction == "reflect":
            matrix = item.element.reflection_matrix(
                item.index_left,
                item.index_right,
                direction=direction,
            )
        else:
            raise ValueError(f"Unknown interaction {interaction!r}.")

        if direction == 1:
            index_in = item.index_left
            index_out = item.index_right if interaction == "transmit" else item.index_left
        else:
            index_in = item.index_right
            index_out = item.index_left if interaction == "transmit" else item.index_right

        return _TraversalUnit(
            label=item.ref.label,
            kind=item.element.kind,
            interaction=interaction,
            direction=direction,
            position_in=item.ref.position,
            position_out=item.ref.position,
            index_in=index_in,
            index_out=index_out,
            matrix=matrix,
            coefficient=item.element.interaction_coefficient(interaction),
            element_ref=item.ref,
            element=item.element,
        )

    def _build_inside_units(
        self,
        ordered: tuple[_ResolvedElement, ...],
        left_order_index: int,
        right_order_index: int,
        direction: int,
    ) -> tuple[_TraversalUnit, ...]:
        direction = _direction_sign(direction)
        units: list[_TraversalUnit] = []
        if direction == 1:
            current_position = ordered[left_order_index].ref.position
            for item in ordered[left_order_index + 1:right_order_index]:
                if item.ref.position > current_position:
                    units.append(
                        self._propagation_unit(
                            current_position,
                            item.ref.position,
                            direction=1,
                        )
                    )
                units.append(self._build_surface_unit(item, direction=1, interaction="transmit"))
                current_position = item.ref.position

            right_position = ordered[right_order_index].ref.position
            if right_position > current_position:
                units.append(self._propagation_unit(current_position, right_position, direction=1))
        else:
            current_position = ordered[right_order_index].ref.position
            for item in reversed(ordered[left_order_index + 1:right_order_index]):
                if current_position > item.ref.position:
                    units.append(
                        self._propagation_unit(
                            current_position,
                            item.ref.position,
                            direction=-1,
                        )
                    )
                units.append(self._build_surface_unit(item, direction=-1, interaction="transmit"))
                current_position = item.ref.position

            left_position = ordered[left_order_index].ref.position
            if current_position > left_position:
                units.append(self._propagation_unit(current_position, left_position, direction=-1))

        return tuple(units)

    def _build_outside_units(
        self,
        ordered: tuple[_ResolvedElement, ...],
        boundary_order_index: int,
        direction: int,
    ) -> tuple[_TraversalUnit, ...]:
        direction = _direction_sign(direction)
        units: list[_TraversalUnit] = []

        if direction == 1:
            current_position = ordered[boundary_order_index].ref.position
            for item in ordered[boundary_order_index + 1:]:
                if item.ref.position > current_position:
                    units.append(self._propagation_unit(current_position, item.ref.position, 1))
                units.append(self._build_surface_unit(item, direction=1, interaction="transmit"))
                current_position = item.ref.position
        else:
            current_position = ordered[boundary_order_index].ref.position
            for item in reversed(ordered[:boundary_order_index]):
                if current_position > item.ref.position:
                    units.append(self._propagation_unit(current_position, item.ref.position, -1))
                units.append(self._build_surface_unit(item, direction=-1, interaction="transmit"))
                current_position = item.ref.position

        return tuple(units)

    @staticmethod
    def _matrix_for_units(units: tuple[_TraversalUnit, ...]) -> ABCDMatrix:
        total = ABCDMatrix.identity()
        for unit in units:
            total = unit.matrix @ total
        return total

    @staticmethod
    def _coefficient_for_units(units: tuple[_TraversalUnit, ...]) -> float:
        coefficient = 1.0
        for unit in units:
            coefficient *= unit.coefficient
        return coefficient

    def _propagate_units(
        self,
        units: tuple[_TraversalUnit, ...],
        q0: complex,
        wavelength: float,
        direction: int,
        name: str,
        start_position: float,
        start_index: float,
    ) -> PropagationPath:
        direction = _direction_sign(direction)
        if wavelength <= 0:
            raise ValueError("wavelength must be positive.")

        current_q = complex(q0)
        cumulative = 1.0
        steps: list[ModeStep] = []
        blocked_by: ElementReference | None = None
        blocked_element: OpticalElement | None = None
        blocked_position: float | None = None

        for unit in units:
            if unit.coefficient <= 0:
                blocked_by = unit.element_ref
                blocked_element = unit.element
                blocked_position = unit.position_in
                break

            beam_in = BeamPoint.from_q(
                position=unit.position_in,
                q=current_q,
                wavelength=wavelength,
                refractive_index=unit.index_in,
                direction=direction,
            )
            q_next = unit.matrix.transform_q(current_q)
            beam_out = BeamPoint.from_q(
                position=unit.position_out,
                q=q_next,
                wavelength=wavelength,
                refractive_index=unit.index_out,
                direction=direction,
            )

            cumulative *= unit.coefficient
            steps.append(
                ModeStep(
                    label=unit.label,
                    kind=unit.kind,
                    interaction=unit.interaction,
                    direction=direction,
                    position_in=unit.position_in,
                    position_out=unit.position_out,
                    index_in=unit.index_in,
                    index_out=unit.index_out,
                    q_in=current_q,
                    q_out=q_next,
                    coefficient=unit.coefficient,
                    cumulative_coefficient=cumulative,
                    beam_in=beam_in,
                    beam_out=beam_out,
                    element_ref=unit.element_ref,
                    element=unit.element,
                    sector_label=unit.sector_label,
                )
            )
            current_q = q_next

        return PropagationPath(
            name=name,
            wavelength=wavelength,
            direction=direction,
            start_position=start_position,
            start_index=start_index,
            start_q=q0,
            steps=tuple(steps),
            blocked_by=blocked_by,
            blocked_element=blocked_element,
            blocked_position=blocked_position,
        )


__all__ = [
    "ABCDMatrix",
    "BeamPoint",
    "CavityModeSolution",
    "CurvedSurface",
    "ElementReference",
    "GaussianBeam",
    "IntervalCavityModeSolution",
    "Lens",
    "ModeStep",
    "OpticalAxis",
    "OpticalElement",
    "PlaneSurface",
    "PropagationPath",
    "SectorDefinition",
]
