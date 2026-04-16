"""Browser wrapper for the cavity-mode calculator."""

from __future__ import annotations

import copy
from typing import Any

import numpy as np

from core.cavity_mode import BeamPoint, OpticalAxis
from core.gaussian_beam import GaussianBeam

from ..base import CalculatorDefinition, clamped_float, positive_float, safe_float


_DEFAULT_STATE: dict[str, Any] = {
    "globals": {
        "wavelength_nm": 780.0,
        "endpoint_ids": ["m1", "m2"],
    },
    "boundaries": {
        "left": {
            "label": "Left boundary",
            "refractive_index": 1.0,
            "output_length_mm": 40.0,
        },
        "right": {
            "label": "Right boundary",
            "refractive_index": 1.0,
            "output_length_mm": 40.0,
        },
    },
    "elements": [
        {
            "id": "m1",
            "kind": "curved_surface",
            "label": "M1",
            "radius_mm": 80.0,
            "reflection": 0.95,
        },
        {
            "id": "m2",
            "kind": "curved_surface",
            "label": "M2",
            "radius_mm": -80.0,
            "reflection": 0.95,
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


def _default_reflection(kind: str) -> float:
    return {
        "curved_surface": 0.95,
        "plane_surface": 1.0,
        "lens": 0.0,
    }.get(kind, 0.0)


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
                    "type": "number",
                    "step": 1.0,
                    "unit": "nm",
                },
            ],
            "element_forms": {
                "curved_surface": [
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
                ],
                "plane_surface": [
                    {
                        "key": "reflection",
                        "label": "Reflection",
                        "type": "range_number",
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "unit": "",
                    },
                ],
                "lens": [
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
            "boundary_fields": [
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
                    "key": "output_length_mm",
                    "label": "Outgoing beam extent",
                    "type": "range_number",
                    "min": 0.0,
                    "max": 200.0,
                    "step": 1.0,
                    "unit": "mm",
                }
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
                "plot_metrics": [],
                "summary_cards": [],
            }

        if len(normalized["globals"]["endpoint_ids"]) != 2:
            return {
                "ok": False,
                "error": "Select exactly two endpoint elements to solve the cavity mode.",
                "warnings": warnings,
                "normalized_state": normalized,
                "scene": scene,
                "plot": self._empty_plot(scene),
                "plot_metrics": [],
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
                "plot_metrics": [],
                "summary_cards": [],
            }

        return {
            "ok": True,
            "error": None,
            "warnings": warnings,
            "normalized_state": normalized,
            "scene": scene,
            "plot": self._build_plot(mode, scene, normalized),
            "plot_metrics": self._plot_metrics(mode),
            "summary_cards": [],
        }

    def _normalize_state(self, state: dict[str, Any]) -> dict[str, Any]:
        raw_globals = dict(_DEFAULT_STATE["globals"])
        raw_globals.update(state.get("globals", {}))

        raw_elements = state.get("elements", [])
        raw_gaps = state.get("gaps", [])

        elements = self._normalize_elements(raw_elements)
        gaps = self._normalize_gaps(raw_gaps, len(elements))
        element_ids = [element["id"] for element in elements]
        endpoint_ids = self._normalize_endpoint_ids(
            element_ids,
            raw_globals.get("endpoint_ids"),
            raw_globals.get("cavity_left_id"),
            raw_globals.get("cavity_right_id"),
        )

        return {
            "globals": {
                "wavelength_nm": positive_float(raw_globals.get("wavelength_nm"), 780.0),
                "endpoint_ids": endpoint_ids,
            },
            "boundaries": self._normalize_boundaries(
                state.get("boundaries", {}),
                legacy_left_n=raw_globals.get("left_environment_n"),
                legacy_right_n=raw_globals.get("right_environment_n"),
                legacy_output_length=raw_globals.get("output_length_mm"),
            ),
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
            reflection_value = raw.get("reflection")
            if reflection_value is None and raw.get("transmission") is not None:
                reflection_value = 1.0 - safe_float(raw.get("transmission"), 1.0)
            element = {
                "id": element_id,
                "kind": kind,
                "label": label,
                "reflection": clamped_float(reflection_value, _default_reflection(kind), 0.0, 1.0),
            }
            if kind == "curved_surface":
                radius_mm = safe_float(raw.get("radius_mm"), 50.0)
                if abs(radius_mm) < 1e-9:
                    radius_mm = 50.0
                element["radius_mm"] = radius_mm
            elif kind == "lens":
                focal_length_mm = safe_float(raw.get("focal_length_mm"), 50.0)
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
                    "distance_mm": positive_float(raw_gap.get("distance_mm"), 20.0),
                    "refractive_index": positive_float(raw_gap.get("refractive_index"), 1.0),
                }
            )
        return gaps

    def _normalize_boundaries(
        self,
        raw_boundaries: dict[str, Any],
        legacy_left_n: Any,
        legacy_right_n: Any,
        legacy_output_length: Any,
    ) -> dict[str, dict[str, Any]]:
        left_raw = raw_boundaries.get("left", {}) if isinstance(raw_boundaries, dict) else {}
        right_raw = raw_boundaries.get("right", {}) if isinstance(raw_boundaries, dict) else {}
        default_output_length = max(0.0, safe_float(legacy_output_length, 40.0))
        return {
            "left": {
                "label": str(left_raw.get("label") or "Left boundary"),
                "refractive_index": positive_float(
                    left_raw.get("refractive_index", legacy_left_n), 1.0, minimum=1e-6
                ),
                "output_length_mm": max(
                    0.0, safe_float(left_raw.get("output_length_mm"), default_output_length)
                ),
            },
            "right": {
                "label": str(right_raw.get("label") or "Right boundary"),
                "refractive_index": positive_float(
                    right_raw.get("refractive_index", legacy_right_n), 1.0, minimum=1e-6
                ),
                "output_length_mm": max(
                    0.0, safe_float(right_raw.get("output_length_mm"), default_output_length)
                ),
            },
        }

    @staticmethod
    def _normalize_endpoint_ids(
        element_ids: list[str],
        endpoint_ids: Any,
        cavity_left_id: Any,
        cavity_right_id: Any,
    ) -> list[str]:
        normalized: list[str] = []

        if isinstance(endpoint_ids, (list, tuple)):
            for value in endpoint_ids:
                endpoint_id = str(value)
                if endpoint_id in element_ids and endpoint_id not in normalized:
                    normalized.append(endpoint_id)

        if not normalized and element_ids:
            legacy = []
            if cavity_left_id in element_ids:
                legacy.append(str(cavity_left_id))
            if cavity_right_id in element_ids:
                legacy.append(str(cavity_right_id))
            for endpoint_id in legacy:
                if endpoint_id not in normalized:
                    normalized.append(endpoint_id)

        if len(normalized) > 2:
            normalized = normalized[-2:]
        return normalized

    def _build_scene(self, state: dict[str, Any]) -> dict[str, Any]:
        positions_mm = self._element_positions_mm(state)
        endpoint_ids = set(state["globals"]["endpoint_ids"])

        elements = []
        for idx, item in enumerate(state["elements"]):
            elements.append(
                {
                    **item,
                    "transmission": 1.0 - item["reflection"],
                    "position_mm": positions_mm[idx],
                    "kind_title": _kind_title(item["kind"]),
                    "is_endpoint": item["id"] in endpoint_ids,
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
                    "left_position_mm": positions_mm[idx],
                    "right_position_mm": positions_mm[idx + 1],
                    "center_mm": 0.5 * (positions_mm[idx] + positions_mm[idx + 1]),
                }
            )

        environments = [
            {
                "side": "left",
                "label": state["boundaries"]["left"]["label"],
                "refractive_index": state["boundaries"]["left"]["refractive_index"],
                "output_length_mm": state["boundaries"]["left"]["output_length_mm"],
                "insert_index": 0,
            },
            {
                "side": "right",
                "label": state["boundaries"]["right"]["label"],
                "refractive_index": state["boundaries"]["right"]["refractive_index"],
                "output_length_mm": state["boundaries"]["right"]["output_length_mm"],
                "insert_index": len(elements),
            },
        ]

        total_length_mm = positions_mm[-1] if positions_mm else 0.0
        return {
            "elements": elements,
            "gaps": gaps,
            "environments": environments,
            "total_length_mm": total_length_mm,
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

        for position_mm, item in zip(positions_mm, state["elements"]):
            position_m = 1e-3 * position_mm
            if item["kind"] == "curved_surface":
                ref = axis.add_curved_surface(
                    position=position_m,
                    radius=1e-3 * item["radius_mm"],
                    label=item["label"],
                    reflection=item["reflection"],
                )
            elif item["kind"] == "plane_surface":
                ref = axis.add_plane_surface(
                    position=position_m,
                    label=item["label"],
                    reflection=item["reflection"],
                )
            elif item["kind"] == "lens":
                ref = axis.add_lens(
                    position=position_m,
                    focal_length=1e-3 * item["focal_length_mm"],
                    label=item["label"],
                    reflection=item["reflection"],
                )
            else:
                raise ValueError(f"Unsupported element kind {item['kind']!r}.")
            refs_by_id[item["id"]] = ref

        if state["elements"]:
            first_ref = refs_by_id[state["elements"][0]["id"]]
            last_ref = refs_by_id[state["elements"][-1]["id"]]
            axis.set_sector(
                None,
                first_ref,
                state["boundaries"]["left"]["refractive_index"],
                label=state["boundaries"]["left"]["label"],
            )
            axis.set_sector(
                last_ref,
                None,
                state["boundaries"]["right"]["refractive_index"],
                label=state["boundaries"]["right"]["label"],
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

        endpoint_order = {item["id"]: index for index, item in enumerate(state["elements"])}
        endpoint_ids = sorted(
            state["globals"]["endpoint_ids"],
            key=lambda item_id: endpoint_order[item_id],
        )
        wavelength_m = 1e-9 * state["globals"]["wavelength_nm"]

        return axis.solve_cavity_mode(
            wavelength=wavelength_m,
            left_endpoint=refs_by_id[endpoint_ids[0]],
            right_endpoint=refs_by_id[endpoint_ids[1]],
        )

    def _build_plot(self, mode, scene: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
        left_output_length_m = 1e-3 * state["boundaries"]["left"]["output_length_mm"]
        right_output_length_m = 1e-3 * state["boundaries"]["right"]["output_length_mm"]

        segments = []
        segments.extend(
            self._segments_from_path(
                mode.inside_path,
                display_name="Inside cavity mode",
                branch="inside",
                color="#005f73",
                dash="solid",
            )
        )
        segments.extend(
            self._segments_from_output_branch(
                mode.left_path,
                extension_length_m=left_output_length_m,
                display_name="Left outgoing beam",
                branch="left",
                color="#bb3e03",
                dash="solid",
            )
        )
        segments.extend(
            self._segments_from_output_branch(
                mode.right_path,
                extension_length_m=right_output_length_m,
                display_name="Right outgoing beam",
                branch="right",
                color="#bb3e03",
                dash="solid",
            )
        )

        max_radius_um = 120.0
        for segment in segments:
            if segment["y_um"]:
                max_radius_um = max(max_radius_um, max(segment["y_um"]))

        return {
            "segments": segments,
            "elements": scene["elements"],
            "waist_marker": None,
            "y_max_um": 1.15 * max_radius_um,
        }

    def _empty_plot(self, scene: dict[str, Any]) -> dict[str, Any]:
        return {
            "segments": [],
            "elements": scene["elements"],
            "waist_marker": None,
            "y_max_um": 200.0,
        }

    def _segments_from_path(
        self,
        path,
        display_name: str,
        branch: str,
        color: str,
        dash: str,
        num_points_per_segment: int = 24,
    ) -> list[dict[str, Any]]:
        segments = []
        for segment_index, step in enumerate(path.steps):
            if step.kind != "propagation" or step.physical_length <= 0:
                continue

            samples = self._sample_step(path, step, num_points=num_points_per_segment)
            beam_in = BeamPoint.from_q(
                position=step.position_in,
                q=step.q_in,
                wavelength=path.wavelength,
                refractive_index=step.index_in,
                direction=path.direction,
            )
            segments.append(
                self._build_segment(
                    samples=samples,
                    segment_id=f"{branch}-{segment_index}",
                    branch=branch,
                    display_name=display_name,
                    segment_label=step.sector_label or step.label or display_name,
                    color=color,
                    dash=dash,
                    reference_beam=beam_in,
                )
            )
        return segments

    def _segments_from_output_branch(
        self,
        path,
        extension_length_m: float,
        display_name: str,
        branch: str,
        color: str,
        dash: str,
        num_points_per_segment: int = 24,
    ) -> list[dict[str, Any]]:
        segments = self._segments_from_path(
            path=path,
            display_name=display_name,
            branch=branch,
            color=color,
            dash=dash,
            num_points_per_segment=num_points_per_segment,
        )

        if extension_length_m > 0 and path.cumulative_coefficient > 0 and not path.is_blocked:
            extension_samples = self._sample_extension(
                end_beam=path.end_beam,
                wavelength=path.wavelength,
                direction=path.direction,
                length=extension_length_m,
                branch_name=display_name,
                num_points=num_points_per_segment,
            )
            if extension_samples:
                segments.append(
                    self._build_segment(
                        samples=extension_samples,
                        segment_id=f"{branch}-extension",
                        branch=branch,
                        display_name=display_name,
                        segment_label="Output extension",
                        color=color,
                        dash=dash,
                        reference_beam=path.end_beam,
                    )
                )
        return segments

    def _sample_step(self, path, step, num_points: int = 24) -> list[dict[str, Any]]:
        local_positions = self._sample_gaussian_segment(step.q_in, step.physical_length, num_points=num_points)
        samples = []
        for distance in local_positions:
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
        return self._deduplicate_samples(samples)

    def _sample_extension(
        self,
        end_beam: BeamPoint,
        wavelength: float,
        direction: int,
        length: float,
        branch_name: str,
        num_points: int = 24,
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
            samples.append(self._serialize_beam(beam, branch_name))
        return self._deduplicate_samples(samples)

    @staticmethod
    def _build_segment(
        samples: list[dict[str, Any]],
        segment_id: str,
        branch: str,
        display_name: str,
        segment_label: str,
        color: str,
        dash: str,
        reference_beam: BeamPoint,
    ) -> dict[str, Any]:
        return {
            "id": segment_id,
            "branch": branch,
            "name": display_name,
            "segment_label": segment_label,
            "color": color,
            "dash": dash,
            "x_mm": [sample["position_mm"] for sample in samples],
            "y_um": [sample["spot_size_um"] for sample in samples],
            "hover_text": [sample["hover_text"] for sample in samples],
            "waist_radius_um": 1e6 * reference_beam.waist_radius,
            "waist_position_mm": 1e3 * reference_beam.waist_position,
            "rayleigh_range_mm": 1e3 * reference_beam.rayleigh_range,
            "refractive_index": reference_beam.refractive_index,
            "x_start_mm": min(sample["position_mm"] for sample in samples),
            "x_end_mm": max(sample["position_mm"] for sample in samples),
        }

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
            "waist_radius_um": 1e6 * beam.waist_radius,
            "waist_position_mm": 1e3 * beam.waist_position,
            "rayleigh_range_mm": 1e3 * beam.rayleigh_range,
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
    def _plot_metrics(mode) -> list[dict[str, str]]:
        fsr = float(mode.free_spectral_range)
        if not np.isfinite(fsr):
            fsr_text = "inf"
        elif abs(fsr) >= 1e9:
            fsr_text = f"{fsr / 1e9:.3f} GHz"
        elif abs(fsr) >= 1e6:
            fsr_text = f"{fsr / 1e6:.3f} MHz"
        elif abs(fsr) >= 1e3:
            fsr_text = f"{fsr / 1e3:.3f} kHz"
        else:
            fsr_text = f"{fsr:.3f} Hz"

        return [
            {"label": "Finesse", "value": f"{mode.finesse:.3f}"},
            {"label": "FSR", "value": fsr_text},
        ]


__all__ = ["CavityModeCalculator"]
