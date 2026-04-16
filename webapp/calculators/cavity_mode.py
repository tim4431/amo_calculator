"""Browser wrapper for the cavity-mode calculator."""

from __future__ import annotations

import copy
from typing import Any

import numpy as np

from core.cavity_mode import BeamPoint, OpticalAxis
from core.gaussian_beam import GaussianBeam

from ..base import CalculatorDefinition


_DEFAULT_STATE: dict[str, Any] = {
    "globals": {
        "wavelength_nm": 1064.0,
        "output_length_mm": 40.0,
        "left_environment_n": 1.0,
        "right_environment_n": 1.0,
        "cavity_left_id": "m1",
        "cavity_right_id": "m2",
    },
    "elements": [
        {
            "id": "m1",
            "kind": "curved_surface",
            "label": "M1",
            "radius_mm": 80.0,
            "reflection": 0.95,
            "transmission": 0.05,
        },
        {
            "id": "m2",
            "kind": "curved_surface",
            "label": "M2",
            "radius_mm": -80.0,
            "reflection": 0.95,
            "transmission": 0.05,
        },
    ],
    "gaps": [
        {
            "label": "Gap 1",
            "distance_mm": 80.0,
            "refractive_index": 1.0,
        }
    ],
}


def _safe_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _positive_float(value: Any, default: float, minimum: float = 1e-9) -> float:
    return max(minimum, _safe_float(value, default))


def _clamped_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, _safe_float(value, default)))


def _kind_prefix(kind: str) -> str:
    return {
        "curved_surface": "mirror",
        "plane_surface": "surface",
        "lens": "lens",
    }.get(kind, "element")


def _kind_title(kind: str) -> str:
    return {
        "curved_surface": "Curved Surface",
        "plane_surface": "Plane Surface",
        "lens": "Lens",
    }.get(kind, "Element")


class CavityModeCalculator(CalculatorDefinition):
    """Interactive cavity-mode calculator for the browser runtime."""

    calculator_id = "cavity-mode"
    title = "Cavity Mode"
    description = "Build a 1D cavity, reorder elements, edit sectors, and inspect the intracavity mode."
    layout = "optical_axis"

    def schema(self) -> dict[str, Any]:
        return {
            "id": self.calculator_id,
            "title": self.title,
            "description": self.description,
            "layout": self.layout,
            "default_state": copy.deepcopy(_DEFAULT_STATE),
            "palette": [
                {"kind": "curved_surface", "label": "Curved Surface"},
                {"kind": "plane_surface", "label": "Plane Surface"},
                {"kind": "lens", "label": "Lens"},
            ],
            "global_fields": [
                {
                    "path": "globals.wavelength_nm",
                    "label": "Wavelength",
                    "type": "range_number",
                    "min": 266.0,
                    "max": 2000.0,
                    "step": 1.0,
                    "unit": "nm",
                },
                {
                    "path": "globals.output_length_mm",
                    "label": "Outgoing beam extent",
                    "type": "range_number",
                    "min": 0.0,
                    "max": 200.0,
                    "step": 1.0,
                    "unit": "mm",
                },
                {
                    "path": "globals.left_environment_n",
                    "label": "Left environment n",
                    "type": "range_number",
                    "min": 1.0,
                    "max": 3.0,
                    "step": 0.001,
                    "unit": "",
                },
                {
                    "path": "globals.right_environment_n",
                    "label": "Right environment n",
                    "type": "range_number",
                    "min": 1.0,
                    "max": 3.0,
                    "step": 0.001,
                    "unit": "",
                },
                {
                    "path": "globals.cavity_left_id",
                    "label": "Left cavity endpoint",
                    "type": "select",
                    "options_source": "elements",
                },
                {
                    "path": "globals.cavity_right_id",
                    "label": "Right cavity endpoint",
                    "type": "select",
                    "options_source": "elements",
                },
            ],
            "element_forms": {
                "curved_surface": [
                    {"key": "label", "label": "Label", "type": "text"},
                    {
                        "key": "radius_mm",
                        "label": "Radius of curvature",
                        "type": "number",
                        "step": 0.1,
                        "unit": "mm",
                    },
                    {
                        "key": "reflection",
                        "label": "Reflection",
                        "type": "range_number",
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "unit": "",
                    },
                    {
                        "key": "transmission",
                        "label": "Transmission",
                        "type": "range_number",
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "unit": "",
                    },
                ],
                "plane_surface": [
                    {"key": "label", "label": "Label", "type": "text"},
                    {
                        "key": "reflection",
                        "label": "Reflection",
                        "type": "range_number",
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "unit": "",
                    },
                    {
                        "key": "transmission",
                        "label": "Transmission",
                        "type": "range_number",
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "unit": "",
                    },
                ],
                "lens": [
                    {"key": "label", "label": "Label", "type": "text"},
                    {
                        "key": "focal_length_mm",
                        "label": "Focal length",
                        "type": "number",
                        "step": 0.1,
                        "unit": "mm",
                    },
                    {
                        "key": "reflection",
                        "label": "Reflection",
                        "type": "range_number",
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "unit": "",
                    },
                    {
                        "key": "transmission",
                        "label": "Transmission",
                        "type": "range_number",
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "unit": "",
                    },
                ],
            },
            "gap_fields": [
                {"key": "label", "label": "Label", "type": "text"},
                {
                    "key": "refractive_index",
                    "label": "Refractive index",
                    "type": "range_number",
                    "min": 1.0,
                    "max": 3.0,
                    "step": 0.001,
                    "unit": "",
                },
                {
                    "key": "distance_mm",
                    "label": "Distance",
                    "type": "range_number",
                    "min": 0.1,
                    "max": 300.0,
                    "step": 0.1,
                    "unit": "mm",
                },
            ],
        }

    def evaluate(self, state: dict[str, Any]) -> dict[str, Any]:
        normalized = self._normalize_state(state)
        scene = self._build_scene(normalized)
        warnings: list[str] = []

        if len(normalized["elements"]) < 2:
            return {
                "ok": False,
                "error": "Add at least two elements before solving a cavity mode.",
                "warnings": warnings,
                "normalized_state": normalized,
                "scene": scene,
                "plot": self._empty_plot(scene),
                "summary_cards": [],
            }

        try:
            mode = self._solve_mode(normalized)
        except Exception as exc:
            return {
                "ok": False,
                "error": str(exc),
                "warnings": warnings,
                "normalized_state": normalized,
                "scene": scene,
                "plot": self._empty_plot(scene),
                "summary_cards": [],
            }

        return {
            "ok": True,
            "error": None,
            "warnings": warnings,
            "normalized_state": normalized,
            "scene": scene,
            "plot": self._build_plot(mode, scene, normalized),
            "summary_cards": self._summary_cards(mode),
        }

    def _normalize_state(self, state: dict[str, Any]) -> dict[str, Any]:
        raw_globals = dict(_DEFAULT_STATE["globals"])
        raw_globals.update(state.get("globals", {}))

        raw_elements = state.get("elements", [])
        raw_gaps = state.get("gaps", [])

        elements = self._normalize_elements(raw_elements)
        gaps = self._normalize_gaps(raw_gaps, len(elements))

        element_ids = [element["id"] for element in elements]
        if element_ids:
            left_id, right_id = self._normalize_endpoint_ids(
                element_ids,
                raw_globals.get("cavity_left_id"),
                raw_globals.get("cavity_right_id"),
            )
        else:
            left_id = None
            right_id = None

        return {
            "globals": {
                "wavelength_nm": _positive_float(raw_globals.get("wavelength_nm"), 1064.0),
                "output_length_mm": max(0.0, _safe_float(raw_globals.get("output_length_mm"), 40.0)),
                "left_environment_n": _positive_float(
                    raw_globals.get("left_environment_n"), 1.0, minimum=1e-6
                ),
                "right_environment_n": _positive_float(
                    raw_globals.get("right_environment_n"), 1.0, minimum=1e-6
                ),
                "cavity_left_id": left_id,
                "cavity_right_id": right_id,
            },
            "elements": elements,
            "gaps": gaps,
        }

    def _normalize_elements(self, raw_elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
        elements: list[dict[str, Any]] = []
        used_ids: set[str] = set()
        kind_counts = {"curved_surface": 0, "plane_surface": 0, "lens": 0}

        for raw in raw_elements:
            kind = str(raw.get("kind", "curved_surface"))
            if kind not in kind_counts:
                kind = "curved_surface"
            kind_counts[kind] += 1

            base_id = str(raw.get("id") or f"{_kind_prefix(kind)}-{kind_counts[kind]}")
            element_id = base_id
            suffix = 2
            while element_id in used_ids:
                element_id = f"{base_id}-{suffix}"
                suffix += 1
            used_ids.add(element_id)

            label = str(raw.get("label") or f"{_kind_title(kind)} {kind_counts[kind]}")
            element = {
                "id": element_id,
                "kind": kind,
                "label": label,
                "reflection": _clamped_float(raw.get("reflection"), 0.0, 0.0, 1.0),
                "transmission": _clamped_float(raw.get("transmission"), 1.0, 0.0, 1.0),
            }
            if kind == "curved_surface":
                radius_mm = _safe_float(raw.get("radius_mm"), 50.0)
                if abs(radius_mm) < 1e-9:
                    radius_mm = 50.0
                element["radius_mm"] = radius_mm
            elif kind == "lens":
                focal_length_mm = _safe_float(raw.get("focal_length_mm"), 50.0)
                if abs(focal_length_mm) < 1e-9:
                    focal_length_mm = 50.0
                element["focal_length_mm"] = focal_length_mm
            elements.append(element)

        return elements

    def _normalize_gaps(self, raw_gaps: list[dict[str, Any]], element_count: int) -> list[dict[str, Any]]:
        expected = max(0, element_count - 1)
        gaps: list[dict[str, Any]] = []
        for idx in range(expected):
            raw_gap = raw_gaps[idx] if idx < len(raw_gaps) else {}
            gaps.append(
                {
                    "label": str(raw_gap.get("label") or f"Gap {idx + 1}"),
                    "distance_mm": _positive_float(raw_gap.get("distance_mm"), 20.0),
                    "refractive_index": _positive_float(raw_gap.get("refractive_index"), 1.0),
                }
            )
        return gaps

    @staticmethod
    def _normalize_endpoint_ids(
        element_ids: list[str], left_id: Any, right_id: Any
    ) -> tuple[str, str]:
        left = str(left_id) if left_id in element_ids else element_ids[0]
        right = str(right_id) if right_id in element_ids else element_ids[-1]

        left_index = element_ids.index(left)
        right_index = element_ids.index(right)

        if left_index == right_index:
            if right_index < len(element_ids) - 1:
                right_index += 1
            elif left_index > 0:
                left_index -= 1

        if left_index > right_index:
            left_index, right_index = right_index, left_index

        return element_ids[left_index], element_ids[right_index]

    def _build_scene(self, state: dict[str, Any]) -> dict[str, Any]:
        positions_mm = self._element_positions_mm(state)
        element_by_id = {element["id"]: element for element in state["elements"]}

        elements = []
        for idx, element in enumerate(state["elements"]):
            elements.append(
                {
                    **element,
                    "position_mm": positions_mm[idx],
                    "kind_title": _kind_title(element["kind"]),
                    "is_cavity_left": element["id"] == state["globals"]["cavity_left_id"],
                    "is_cavity_right": element["id"] == state["globals"]["cavity_right_id"],
                }
            )

        gaps = []
        for idx, gap in enumerate(state["gaps"]):
            gaps.append(
                {
                    **gap,
                    "index": idx,
                    "left_id": state["elements"][idx]["id"],
                    "right_id": state["elements"][idx + 1]["id"],
                    "left_label": element_by_id[state["elements"][idx]["id"]]["label"],
                    "right_label": element_by_id[state["elements"][idx + 1]["id"]]["label"],
                    "left_position_mm": positions_mm[idx],
                    "right_position_mm": positions_mm[idx + 1],
                    "center_mm": 0.5 * (positions_mm[idx] + positions_mm[idx + 1]),
                }
            )

        total_length_mm = positions_mm[-1] if positions_mm else 0.0
        return {
            "elements": elements,
            "gaps": gaps,
            "total_length_mm": total_length_mm,
            "left_environment_n": state["globals"]["left_environment_n"],
            "right_environment_n": state["globals"]["right_environment_n"],
        }

    @staticmethod
    def _element_positions_mm(state: dict[str, Any]) -> list[float]:
        positions = []
        position_mm = 0.0
        for idx, _element in enumerate(state["elements"]):
            positions.append(position_mm)
            if idx < len(state["gaps"]):
                position_mm += state["gaps"][idx]["distance_mm"]
        return positions

    def _solve_mode(self, state: dict[str, Any]):
        axis = OpticalAxis(default_refractive_index=1.0)
        refs_by_id: dict[str, Any] = {}

        positions_mm = self._element_positions_mm(state)
        for position_mm, element in zip(positions_mm, state["elements"]):
            position_m = 1e-3 * position_mm
            if element["kind"] == "curved_surface":
                ref = axis.add_curved_surface(
                    position=position_m,
                    radius=1e-3 * element["radius_mm"],
                    label=element["label"],
                    reflection=element["reflection"],
                    transmission=element["transmission"],
                )
            elif element["kind"] == "plane_surface":
                ref = axis.add_plane_surface(
                    position=position_m,
                    label=element["label"],
                    reflection=element["reflection"],
                    transmission=element["transmission"],
                )
            elif element["kind"] == "lens":
                ref = axis.add_lens(
                    position=position_m,
                    focal_length=1e-3 * element["focal_length_mm"],
                    label=element["label"],
                    reflection=element["reflection"],
                    transmission=element["transmission"],
                )
            else:
                raise ValueError(f"Unsupported element kind {element['kind']!r}.")
            refs_by_id[element["id"]] = ref

        if state["elements"]:
            first_ref = refs_by_id[state["elements"][0]["id"]]
            last_ref = refs_by_id[state["elements"][-1]["id"]]
            axis.set_sector(
                None,
                first_ref,
                state["globals"]["left_environment_n"],
                label="Left environment",
            )
            axis.set_sector(
                last_ref,
                None,
                state["globals"]["right_environment_n"],
                label="Right environment",
            )

        for gap, left_element, right_element in zip(
            state["gaps"],
            state["elements"][:-1],
            state["elements"][1:],
        ):
            axis.set_sector(
                refs_by_id[left_element["id"]],
                refs_by_id[right_element["id"]],
                gap["refractive_index"],
                label=gap["label"],
            )

        wavelength_m = 1e-9 * state["globals"]["wavelength_nm"]
        return axis.solve_cavity_mode(
            wavelength=wavelength_m,
            left_endpoint=refs_by_id[state["globals"]["cavity_left_id"]],
            right_endpoint=refs_by_id[state["globals"]["cavity_right_id"]],
        )

    def _build_plot(self, mode, scene: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
        output_length_m = 1e-3 * state["globals"]["output_length_mm"]

        traces = [self._trace_from_path(mode.inside_path, "Inside cavity mode", "#005f73", "solid")]

        left_trace = self._trace_from_output_branch(
            mode.left_path,
            output_length_m,
            "Left outgoing beam",
            "#bb3e03",
            "dash",
        )
        if left_trace is not None:
            traces.append(left_trace)

        right_trace = self._trace_from_output_branch(
            mode.right_path,
            output_length_m,
            "Right outgoing beam",
            "#bb3e03",
            "dash",
        )
        if right_trace is not None:
            traces.append(right_trace)

        max_radius_um = 120.0
        for trace in traces:
            if trace["y_um"]:
                max_radius_um = max(max_radius_um, max(trace["y_um"]))

        return {
            "traces": traces,
            "elements": scene["elements"],
            "waist_marker": {
                "x_mm": 1e3 * mode.waist_position,
                "y_um": 0.0,
                "label": "Waist",
            },
            "y_max_um": 1.15 * max_radius_um,
        }

    def _empty_plot(self, scene: dict[str, Any]) -> dict[str, Any]:
        return {
            "traces": [],
            "elements": scene["elements"],
            "waist_marker": None,
            "y_max_um": 200.0,
        }

    def _trace_from_path(
        self,
        path,
        name: str,
        color: str,
        dash: str,
        num_points_per_segment: int = 20,
    ) -> dict[str, Any]:
        samples = self._sample_path(path, num_points_per_segment=num_points_per_segment)
        return {
            "name": name,
            "branch": path.name,
            "color": color,
            "dash": dash,
            "x_mm": [sample["position_mm"] for sample in samples],
            "y_um": [sample["spot_size_um"] for sample in samples],
            "hover_text": [sample["hover_text"] for sample in samples],
        }

    def _trace_from_output_branch(
        self,
        path,
        extension_length_m: float,
        name: str,
        color: str,
        dash: str,
        num_points_per_segment: int = 20,
    ) -> dict[str, Any] | None:
        samples = self._sample_path(path, num_points_per_segment=num_points_per_segment)
        if not samples:
            return None

        if extension_length_m > 0 and path.cumulative_coefficient > 0 and not path.is_blocked:
            extension_samples = self._sample_extension(
                end_beam=path.end_beam,
                wavelength=path.wavelength,
                direction=path.direction,
                length=extension_length_m,
                name=path.name,
                num_points=num_points_per_segment,
            )
            if extension_samples:
                samples.extend(extension_samples[1:])

        return {
            "name": name,
            "branch": path.name,
            "color": color,
            "dash": dash,
            "x_mm": [sample["position_mm"] for sample in samples],
            "y_um": [sample["spot_size_um"] for sample in samples],
            "hover_text": [sample["hover_text"] for sample in samples],
        }

    def _sample_path(self, path, num_points_per_segment: int = 20) -> list[dict[str, Any]]:
        samples = [self._serialize_beam(path.start_beam, path.name)]
        for step in path.steps:
            if step.kind == "propagation" and step.physical_length > 0:
                local_positions = self._sample_gaussian_segment(
                    step.q_in,
                    step.physical_length,
                    num_points=num_points_per_segment,
                )
                for distance in local_positions[1:]:
                    position = step.position_in + step.direction * distance
                    q_value = GaussianBeam.q_at_z(step.q_in, distance)
                    beam = BeamPoint.from_q(
                        position=position,
                        q=q_value,
                        wavelength=path.wavelength,
                        refractive_index=step.index_in,
                        direction=path.direction,
                    )
                    samples.append(self._serialize_beam(beam, path.name))
            else:
                samples.append(self._serialize_beam(step.beam_out, path.name))
        return self._deduplicate_samples(samples)

    def _sample_extension(
        self,
        end_beam: BeamPoint,
        wavelength: float,
        direction: int,
        length: float,
        name: str,
        num_points: int = 20,
    ) -> list[dict[str, Any]]:
        local_positions = self._sample_gaussian_segment(end_beam.q, length, num_points=num_points)
        samples = []
        for distance in local_positions:
            position = end_beam.position + direction * distance
            q_value = GaussianBeam.q_at_z(end_beam.q, distance)
            beam = BeamPoint.from_q(
                position=position,
                q=q_value,
                wavelength=wavelength,
                refractive_index=end_beam.refractive_index,
                direction=direction,
            )
            samples.append(self._serialize_beam(beam, name))
        return self._deduplicate_samples(samples)

    @staticmethod
    def _sample_gaussian_segment(q0: complex, length: float, num_points: int = 12) -> np.ndarray:
        if length <= 0:
            return np.array([0.0], dtype=float)

        z_to_waist = -float(GaussianBeam.distance_to_waist(q0))
        linear_samples = np.linspace(0.0, length, max(2, num_points), dtype=float)
        if z_to_waist < 0 or z_to_waist > length:
            return linear_samples

        zr = abs(float(GaussianBeam.rayleigh_range(q0)))
        extra_samples = z_to_waist + zr * np.array([-2.0, -1.0, 0.0, 1.0, 2.0], dtype=float)
        extra_samples = extra_samples[(extra_samples >= 0.0) & (extra_samples <= length)]
        return np.unique(np.sort(np.concatenate([linear_samples, extra_samples, [0.0, length]])))

    @staticmethod
    def _serialize_beam(beam: BeamPoint, branch_name: str) -> dict[str, Any]:
        curvature = beam.radius_of_curvature
        curvature_text = "inf" if not np.isfinite(curvature) else f"{1e3 * curvature:.3f} mm"
        return {
            "position_mm": 1e3 * beam.position,
            "spot_size_um": 1e6 * beam.spot_size,
            "hover_text": (
                f"<b>{branch_name}</b><br>"
                f"x = {1e3 * beam.position:.3f} mm<br>"
                f"spot size = {1e6 * beam.spot_size:.3f} um<br>"
                f"local waist = {1e6 * beam.waist_radius:.3f} um<br>"
                f"waist position = {1e3 * beam.waist_position:.3f} mm<br>"
                f"Rayleigh range = {1e3 * beam.rayleigh_range:.3f} mm<br>"
                f"R = {curvature_text}<br>"
                f"n = {beam.refractive_index:.4f}"
            ),
        }

    @staticmethod
    def _deduplicate_samples(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not samples:
            return samples

        deduplicated = [samples[0]]
        for sample in samples[1:]:
            previous = deduplicated[-1]
            if (
                abs(sample["position_mm"] - previous["position_mm"]) < 1e-9
                and abs(sample["spot_size_um"] - previous["spot_size_um"]) < 1e-9
            ):
                deduplicated[-1] = sample
            else:
                deduplicated.append(sample)
        return deduplicated

    @staticmethod
    def _summary_cards(mode) -> list[dict[str, str]]:
        return [
            {"label": "Waist radius", "value": f"{1e6 * mode.waist_radius:.3f} um"},
            {"label": "Waist position", "value": f"{1e3 * mode.waist_position:.3f} mm"},
            {"label": "Rayleigh range", "value": f"{1e3 * mode.rayleigh_range:.3f} mm"},
            {
                "label": "Left q",
                "value": f"{1e3 * np.real(mode.q_left):.3f} + {1e3 * np.imag(mode.q_left):.3f}i mm",
            },
            {
                "label": "Right q",
                "value": f"{1e3 * np.real(mode.q_right):.3f} + {1e3 * np.imag(mode.q_right):.3f}i mm",
            },
            {
                "label": "Left transmission",
                "value": f"{mode.left_path.cumulative_coefficient:.4f}",
            },
            {
                "label": "Right transmission",
                "value": f"{mode.right_path.cumulative_coefficient:.4f}",
            },
        ]


__all__ = ["CavityModeCalculator"]
