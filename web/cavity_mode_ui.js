import { element } from "./ui_common.js";


const COMPONENT_ICON_PATHS = {
  curved_surface: "assets/curved_surface.svg",
  plane_surface: "assets/plane_surface.svg",
  lens: "assets/lens.svg",
};


function linspace(start, stop, count) {
  if (count <= 1) {
    return [start];
  }
  const values = [];
  const step = (stop - start) / (count - 1);
  for (let index = 0; index < count; index += 1) {
    values.push(start + step * index);
  }
  return values;
}


export function elementPropertyDescriptors(item) {
  const descriptors = [
    {
      key: "reflection",
      label: "R",
      kind: "fraction",
      digits: 3,
      step: 0.01,
      min: 0.0,
      max: 1.0,
    },
    {
      key: "transmission",
      label: "T",
      kind: "fraction",
      digits: 3,
      step: 0.01,
      min: 0.0,
      max: 1.0,
    },
  ];

  if (item.kind === "curved_surface") {
    descriptors.unshift({
      key: "radius_mm",
      label: "ROC",
      kind: "length",
      digits: 3,
      step: 0.1,
      unit: "mm",
    });
  }

  if (item.kind === "lens") {
    descriptors.unshift({
      key: "focal_length_mm",
      label: "f",
      kind: "length",
      digits: 3,
      step: 0.1,
      unit: "mm",
    });
  }

  return descriptors;
}


export function gapPropertyDescriptors() {
  return [
    {
      key: "refractive_index",
      label: "n",
      kind: "number",
      digits: 4,
      step: 0.001,
      minimum: 1e-6,
      suffix: "",
    },
    {
      key: "distance_mm",
      label: "d",
      kind: "length_mm",
      digits: 3,
      step: 0.1,
      minimum: 0.0,
      suffix: "mm",
    },
  ];
}


export function boundaryPropertyDescriptors() {
  return [
    {
      key: "refractive_index",
      label: "n",
      kind: "number",
      digits: 4,
      step: 0.001,
      minimum: 1e-6,
      suffix: "",
    },
    {
      key: "output_length_mm",
      label: "out",
      kind: "length_mm",
      digits: 3,
      step: 0.1,
      minimum: 0.0,
      suffix: "mm",
    },
  ];
}


export function createComponentIcon(kind, label, className = "component-icon", { flipX = false } = {}) {
  const src = COMPONENT_ICON_PATHS[kind];
  if (!src) {
    return element("span", { className: `${className} placeholder`, text: "" });
  }
  return element("img", {
    className: `${className}${flipX ? " is-flipped" : ""}`,
    attrs: {
      src,
      alt: `${label} icon`,
      draggable: "false",
    },
  });
}


export function buildComponentPalette(schema, onPaletteDragStart) {
  const paletteNodes = (schema.palette || []).map((item) => {
    const chip = element("div", {
      className: "palette-item",
      children: [
        createComponentIcon(item.kind, item.label, "palette-icon"),
        element("span", { text: item.label }),
      ],
      attrs: { draggable: "true" },
    });
    chip.addEventListener("dragstart", (event) => {
      onPaletteDragStart(event, item.kind);
    });
    return chip;
  });

  return element("div", {
    className: "palette",
    children: paletteNodes,
  });
}


export function buildElementPlotTraces(plot, yMax) {
  const traces = [];
  const annotations = [];
  for (const item of plot.elements || []) {
    const topY = 0.93 * yMax;
    const labelY = 1.02 * yMax;
    if (item.kind === "plane_surface") {
      const y = linspace(-topY, topY, 2);
      const x = y.map(() => item.position_mm);
      traces.push({
        x,
        y,
        type: "scatter",
        mode: "lines",
        hoverinfo: "skip",
        line: { color: "#334155", width: 3 },
        showlegend: false,
      });
    } else if (item.kind === "curved_surface") {
      const y = linspace(-topY, topY, 180);
      const normalized = y.map((value) => value / topY);
      const x = normalized.map((value) => item.position_mm + Math.sign(item.radius_mm || 1) * 1.1 * value * value);
      traces.push({
        x,
        y,
        type: "scatter",
        mode: "lines",
        hoverinfo: "skip",
        line: { color: "#334155", width: 3 },
        showlegend: false,
      });
    } else if (item.kind === "lens") {
      const theta = linspace(0, 2 * Math.PI, 180);
      const xRadius = 0.42;
      const yRadius = topY * 0.9;
      traces.push({
        x: theta.map((value) => item.position_mm + xRadius * Math.cos(value)),
        y: theta.map((value) => yRadius * Math.sin(value)),
        type: "scatter",
        mode: "lines",
        hoverinfo: "skip",
        line: { color: "#1d4ed8", width: 3 },
        fill: "toself",
        fillcolor: "rgba(29, 78, 216, 0.18)",
        showlegend: false,
      });
    }
    annotations.push({
      x: item.position_mm,
      y: labelY,
      text: item.label,
      showarrow: false,
      textangle: -90,
      font: { size: 13, color: "#334155" },
    });
  }
  return { traces, annotations };
}
