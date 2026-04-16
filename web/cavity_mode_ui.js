import {
  clamp,
  deepCopy,
  element,
  formatNumber,
  formatCompactNumber,
  getValueByPath,
  hexToRgba,
  linspace,
  renderField,
} from "./ui_common.js";
import {
  collectStandardMessages,
  createBuilderPanel,
  createMessagesPanel,
  createPlotPanel,
} from "./panels.js";


const COMPONENT_ICON_PATHS = {
  curved_surface: "assets/curved_surface.svg",
  plane_surface: "assets/plane_surface.svg",
  lens: "assets/lens.svg",
};


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


function plotXSpan(plot) {
  const xValues = [];
  for (const item of plot.elements || []) {
    xValues.push(Number(item.position_mm));
  }
  for (const segment of plot.segments || []) {
    xValues.push(...(segment.x_mm || []).map((value) => Number(value)));
  }
  for (const trace of plot.traces || []) {
    xValues.push(...(trace.x_mm || []).map((value) => Number(value)));
  }
  if (plot.waist_marker) {
    xValues.push(Number(plot.waist_marker.x_mm));
  }
  if (!xValues.length) {
    return 80;
  }
  return Math.max(1, Math.max(...xValues) - Math.min(...xValues));
}


function median(values) {
  if (!values.length) {
    return 80;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return 0.5 * (sorted[middle - 1] + sorted[middle]);
}


function referenceCurvedSurfaceRocMm(plot) {
  const values = (plot.elements || [])
    .filter((item) => item.kind === "curved_surface")
    .map((item) => Math.abs(Number(item.radius_mm)))
    .filter((value) => Number.isFinite(value) && value > 1e-9);
  return median(values);
}


function curvedSurfaceDepthMm(radiusMm, referenceRocMm, axisSpanMm) {
  const absoluteRadiusMm = Math.max(1e-9, Math.abs(Number(radiusMm) || referenceRocMm || 80));
  const reference = Math.max(1.0, referenceRocMm || 80);
  const baseDepthMm = clamp(0.016 * axisSpanMm, 0.28, 1.8);
  const curvatureScale = clamp(reference / absoluteRadiusMm, 0.28, 3.2);
  return baseDepthMm * curvatureScale;
}


function elementGeometry(item, topY, axisSpanMm, referenceRocMm) {
  if (item.kind === "plane_surface") {
    const y = linspace(-topY, topY, 2);
    return {
      x: y.map(() => item.position_mm),
      y,
      line: { color: "#334155", width: 3 },
      fill: undefined,
      fillcolor: undefined,
      hoverWidthMm: Math.max(0.35, 0.012 * axisSpanMm),
    };
  }

  if (item.kind === "curved_surface") {
    const y = linspace(-topY, topY, 180);
    const normalized = y.map((value) => value / topY);
    const visualDepthMm = curvedSurfaceDepthMm(item.radius_mm, referenceRocMm, axisSpanMm);
    return {
      x: normalized.map((value) =>
        item.position_mm + Math.sign(item.radius_mm || 1) * visualDepthMm * value * value
      ),
      y,
      line: { color: "#334155", width: 3 },
      fill: undefined,
      fillcolor: undefined,
      hoverWidthMm: Math.max(0.35, visualDepthMm + 0.12),
    };
  }

  if (item.kind === "lens") {
    const theta = linspace(0, 2 * Math.PI, 180);
    const xRadius = 0.42;
    const yRadius = topY * 0.9;
    return {
      x: theta.map((value) => item.position_mm + xRadius * Math.cos(value)),
      y: theta.map((value) => yRadius * Math.sin(value)),
      line: { color: "#1d4ed8", width: 3 },
      fill: "toself",
      fillcolor: "rgba(29, 78, 216, 0.18)",
      hoverWidthMm: xRadius + 0.16,
    };
  }

  return null;
}


export function buildElementPlotTraces(plot, yMax) {
  const traces = [];
  const annotations = [];
  const targets = [];
  const axisSpanMm = plotXSpan(plot);
  const referenceRocMm = referenceCurvedSurfaceRocMm(plot);
  for (const item of plot.elements || []) {
    const topY = 0.93 * yMax;
    const labelY = 1.02 * yMax;
    const geometry = elementGeometry(item, topY, axisSpanMm, referenceRocMm);
    if (geometry) {
      traces.push({
        x: geometry.x,
        y: geometry.y,
        type: "scatter",
        mode: "lines",
        hoverinfo: "skip",
        line: geometry.line,
        fill: geometry.fill,
        fillcolor: geometry.fillcolor,
        showlegend: false,
      });
      targets.push({
        elementId: item.id,
        minX: Math.min(...geometry.x) - geometry.hoverWidthMm,
        maxX: Math.max(...geometry.x) + geometry.hoverWidthMm,
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
  return { traces, annotations, targets };
}


// ─── Optical-axis controller ────────────────────────────────────────────────
//
// Encapsulates all state mutations, inline-editor state, and DOM rendering
// specific to the optical_axis layout. app.js holds no optical-axis logic;
// it only creates the controller once and calls its public methods.
//
// deps:
//   getState()          → current calculator state
//   getSchema()         → current schema
//   onCommit(nextState) → commit state change to app
//   onUpdateGlobal(path, value) → update a global field via app
//   onRerender()        → trigger a full renderApp() pass

export function createOpticalAxisController({
  getState,
  getSchema,
  onCommit,
  onUpdateGlobal,
  onRerender,
}) {
  // ── Local inline-editor state ─────────────────────────────────────────────

  let inlinePropertyEditor = null;

  function inlineEditorMatches(editorState) {
    return Boolean(
      inlinePropertyEditor &&
      Object.entries(editorState).every(([key, value]) => inlinePropertyEditor[key] === value),
    );
  }

  function openInlinePropertyEditor(editorState) {
    inlinePropertyEditor = editorState;
    onRerender();
  }

  function closeInlinePropertyEditor({ rerender = false } = {}) {
    inlinePropertyEditor = null;
    if (rerender) {
      onRerender();
    }
  }

  // ── State-mutation helpers ────────────────────────────────────────────────

  function setElementFieldValue(item, key, value) {
    if (key === "reflection") {
      item.reflection = clamp(Number(value), 0, 1);
      return;
    }
    if (key === "transmission") {
      item.reflection = Number((1 - clamp(Number(value), 0, 1)).toFixed(12));
      return;
    }
    item[key] = value;
  }

  function nextUniqueId(kind, elements) {
    const prefix = { curved_surface: "mirror", plane_surface: "surface", lens: "lens" }[kind] || "element";
    const used = new Set(elements.map((item) => item.id));
    let count = elements.filter((item) => item.kind === kind).length + 1;
    let candidate = `${prefix}-${count}`;
    while (used.has(candidate)) {
      count += 1;
      candidate = `${prefix}-${count}`;
    }
    return candidate;
  }

  function defaultElement(kind, state) {
    const labels = { curved_surface: "Curved Surface", plane_surface: "Plane Surface", lens: "Lens" };
    const count = state.elements.filter((item) => item.kind === kind).length + 1;
    const base = {
      id: nextUniqueId(kind, state.elements),
      kind,
      label: `${labels[kind] || "Element"} ${count}`,
      reflection: kind === "curved_surface" ? 0.95 : (kind === "plane_surface" ? 1.0 : 0.0),
    };
    if (kind === "curved_surface") base.radius_mm = 50.0;
    if (kind === "lens") base.focal_length_mm = 50.0;
    return base;
  }

  function defaultGap(labelIndex, refractiveIndex = 1.0, distanceMm = 20.0) {
    return { label: `Gap ${labelIndex}`, refractive_index: refractiveIndex, distance_mm: distanceMm };
  }

  function defaultBoundary(side, refractiveIndex = 1.0, outputLengthMm = 40.0) {
    return {
      label: side === "left" ? "Left boundary" : "Right boundary",
      refractive_index: refractiveIndex,
      output_length_mm: outputLengthMm,
    };
  }

  function renumberGapLabels(state) {
    state.gaps.forEach((gap, index) => { gap.label = `Gap ${index + 1}`; });
  }

  function reconcileEndpoints(state) {
    const ids = (state.elements || []).map((item) => item.id);
    const current = Array.isArray(state.globals.endpoint_ids) ? state.globals.endpoint_ids : [];
    const normalized = [];
    for (const value of current) {
      if (ids.includes(value) && !normalized.includes(value)) normalized.push(value);
    }
    state.globals.endpoint_ids = normalized.slice(-2);
  }

  // ── State mutations (called from DOM event handlers) ──────────────────────

  function updateElementField(index, key, value) {
    const nextState = deepCopy(getState());
    setElementFieldValue(nextState.elements[index], key, value);
    onCommit(nextState);
  }

  function updateGapField(index, key, value) {
    const nextState = deepCopy(getState());
    nextState.gaps[index][key] = value;
    onCommit(nextState);
  }

  function updateBoundaryField(side, key, value) {
    const nextState = deepCopy(getState());
    if (!nextState.boundaries) {
      nextState.boundaries = { left: defaultBoundary("left"), right: defaultBoundary("right") };
    }
    nextState.boundaries[side][key] = value;
    onCommit(nextState);
  }

  function toggleEndpoint(index) {
    const nextState = deepCopy(getState());
    const el = nextState.elements[index];
    if (!el) return;
    const endpoints = Array.isArray(nextState.globals.endpoint_ids)
      ? [...nextState.globals.endpoint_ids] : [];
    const existingIndex = endpoints.indexOf(el.id);
    if (existingIndex >= 0) {
      endpoints.splice(existingIndex, 1);
    } else {
      if (endpoints.length >= 2) endpoints.shift();
      endpoints.push(el.id);
    }
    nextState.globals.endpoint_ids = endpoints;
    onCommit(nextState);
  }

  function insertElementAt(zoneIndex, kind) {
    const nextState = deepCopy(getState());
    const item = defaultElement(kind, nextState);
    const elementCount = nextState.elements.length;

    if (elementCount === 0) {
      nextState.elements.push(item);
    } else if (zoneIndex === 0) {
      nextState.elements.splice(0, 0, item);
      nextState.gaps.splice(0, 0, defaultGap(1, nextState.boundaries?.left?.refractive_index ?? 1.0));
    } else if (zoneIndex === elementCount) {
      nextState.elements.push(item);
      nextState.gaps.push(defaultGap(nextState.gaps.length + 1, nextState.boundaries?.right?.refractive_index ?? 1.0));
    } else {
      const oldGap = nextState.gaps[zoneIndex - 1] || defaultGap(zoneIndex);
      const firstDistance = Math.max(0.1, Number(oldGap.distance_mm) / 2);
      const secondDistance = Math.max(0.1, Number(oldGap.distance_mm) - firstDistance);
      nextState.elements.splice(zoneIndex, 0, item);
      nextState.gaps.splice(zoneIndex - 1, 1,
        { label: oldGap.label, refractive_index: oldGap.refractive_index, distance_mm: firstDistance },
        { label: oldGap.label, refractive_index: oldGap.refractive_index, distance_mm: secondDistance },
      );
    }
    renumberGapLabels(nextState);
    inlinePropertyEditor = null;
    onCommit(nextState);
  }

  function moveElement(sourceIndex, zoneIndex) {
    const nextState = deepCopy(getState());
    if (sourceIndex < 0 || sourceIndex >= nextState.elements.length ||
        zoneIndex < 0 || zoneIndex > nextState.elements.length) return;
    const [item] = nextState.elements.splice(sourceIndex, 1);
    let targetIndex = zoneIndex;
    if (sourceIndex < zoneIndex) targetIndex -= 1;
    nextState.elements.splice(targetIndex, 0, item);
    inlinePropertyEditor = null;
    onCommit(nextState);
  }

  function swapElements(sourceIndex, targetIndex) {
    const nextState = deepCopy(getState());
    if (sourceIndex < 0 || sourceIndex >= nextState.elements.length ||
        targetIndex < 0 || targetIndex >= nextState.elements.length ||
        sourceIndex === targetIndex) return;
    const temp = nextState.elements[sourceIndex];
    nextState.elements[sourceIndex] = nextState.elements[targetIndex];
    nextState.elements[targetIndex] = temp;
    inlinePropertyEditor = null;
    onCommit(nextState);
  }

  function deleteElement(index) {
    const nextState = deepCopy(getState());
    if (index < 0 || index >= nextState.elements.length) return;

    if (nextState.elements.length === 1) {
      nextState.elements = [];
      nextState.gaps = [];
    } else if (index === 0) {
      nextState.elements.splice(0, 1);
      nextState.gaps.splice(0, 1);
    } else if (index === nextState.elements.length - 1) {
      nextState.elements.splice(index, 1);
      nextState.gaps.splice(index - 1, 1);
    } else {
      const leftGap = nextState.gaps[index - 1];
      const rightGap = nextState.gaps[index];
      nextState.elements.splice(index, 1);
      nextState.gaps.splice(index - 1, 2, {
        label: leftGap.label,
        refractive_index: 0.5 * (Number(leftGap.refractive_index) + Number(rightGap.refractive_index)),
        distance_mm: Number(leftGap.distance_mm) + Number(rightGap.distance_mm),
      });
    }
    renumberGapLabels(nextState);
    reconcileEndpoints(nextState);
    inlinePropertyEditor = null;
    onCommit(nextState);
  }

  // ── Inline-editor DOM ─────────────────────────────────────────────────────

  function formatInlinePropertyValue(value, descriptor) {
    const formatted = formatCompactNumber(value, descriptor.digits || 3);
    return descriptor.suffix ? `${formatted} ${descriptor.suffix}` : formatted;
  }

  function commitInlineEdit(rawValue, descriptor, onCommitValue) {
    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue)) {
      closeInlinePropertyEditor({ rerender: true });
      return;
    }
    let nextValue = parsedValue;
    if (descriptor.minimum !== undefined) nextValue = Math.max(descriptor.minimum, nextValue);
    if (descriptor.maximum !== undefined) nextValue = Math.min(descriptor.maximum, nextValue);
    closeInlinePropertyEditor();
    onCommitValue(nextValue);
  }

  function createInlinePropertyDisplay({ editorState, descriptor, value, onOpen, className = "element-prop-button" }) {
    const btn = element("button", {
      className,
      attrs: { type: "button", draggable: "false" },
      children: [
        element("span", { className: "element-prop-label", text: `${descriptor.label} =` }),
        element("span", { className: "element-prop-value", text: formatInlinePropertyValue(value, descriptor) }),
      ],
    });
    btn.addEventListener("click", (event) => { event.stopPropagation(); onOpen(editorState); });
    btn.addEventListener("pointerdown", (event) => event.stopPropagation());
    btn.addEventListener("dragstart", (event) => event.preventDefault());
    return btn;
  }

  function createInlinePropertyEditorDom({ descriptor, value, onCommitValue, className = "element-prop-editor" }) {
    const editor = element("div", { className, attrs: { tabindex: "-1" } });
    const label = element("span", { className: "element-prop-label", text: `${descriptor.label} =` });
    const input = element("input", {
      className: "element-prop-input",
      attrs: { type: "number", step: descriptor.step || 0.01, value: formatCompactNumber(value, 6),
               min: descriptor.minimum, max: descriptor.maximum },
    });

    const commit = () => commitInlineEdit(input.value, descriptor, onCommitValue);
    const cancel = () => closeInlinePropertyEditor({ rerender: true });

    editor.append(label, input);
    if (descriptor.suffix) editor.append(element("span", { className: "element-prop-suffix", text: descriptor.suffix }));
    editor.addEventListener("click", (event) => event.stopPropagation());
    editor.addEventListener("pointerdown", (event) => event.stopPropagation());
    editor.addEventListener("dragstart", (event) => event.preventDefault());
    editor.addEventListener("focusout", (event) => {
      if (event.relatedTarget && editor.contains(event.relatedTarget)) return;
      commit();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
    });
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("dragstart", (event) => event.preventDefault());
    window.requestAnimationFrame(() => { input.focus(); input.select(); });
    return editor;
  }

  function createInlinePropertyNode({ editorState, descriptor, value, onCommitValue, buttonClassName, editorClassName }) {
    if (inlineEditorMatches(editorState)) {
      return createInlinePropertyEditorDom({
        descriptor, value, onCommitValue,
        className: editorClassName || "element-prop-editor",
      });
    }
    return createInlinePropertyDisplay({
      editorState, descriptor, value,
      onOpen: openInlinePropertyEditor,
      className: buttonClassName || "element-prop-button",
    });
  }

  // ── Drop-zone helpers ─────────────────────────────────────────────────────

  function attachZoneDropHandlers(node, zoneIndex) {
    node.addEventListener("dragover", (event) => { event.preventDefault(); node.classList.add("active"); });
    node.addEventListener("dragleave", () => node.classList.remove("active"));
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("active");
      const payload = event.dataTransfer.getData("text/plain");
      if (!payload) return;
      const data = JSON.parse(payload);
      if (data.source === "palette") insertElementAt(zoneIndex, data.kind);
      if (data.source === "element") moveElement(data.index, zoneIndex);
    });
  }

  function attachElementSwapHandlers(node, index) {
    node.addEventListener("dragover", (event) => { event.preventDefault(); node.classList.add("active"); });
    node.addEventListener("dragleave", () => node.classList.remove("active"));
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("active");
      const payload = event.dataTransfer.getData("text/plain");
      if (!payload) return;
      const data = JSON.parse(payload);
      if (data.source === "element") swapElements(data.index, index);
      if (data.source === "palette") insertElementAt(index, data.kind);
    });
  }

  // ── Card rendering ────────────────────────────────────────────────────────

  function createBoundaryCard(side, calculatorState) {
    const boundary = calculatorState.boundaries?.[side] || defaultBoundary(side);
    const [indexDescriptor, outputDescriptor] = boundaryPropertyDescriptors();
    const node = element("div", {
      className: "boundary-card gap-card",
      children: [
        createInlinePropertyNode({
          editorState: { entityType: "boundary", side, key: "refractive_index" },
          descriptor: indexDescriptor,
          value: boundary.refractive_index,
          onCommitValue: (v) => updateBoundaryField(side, "refractive_index", v),
          buttonClassName: "gap-pill gap-prop-button",
          editorClassName: "gap-pill gap-prop-editor",
        }),
        element("div", { className: "gap-core", children: [element("div", { className: "edge-label", text: boundary.label })] }),
        createInlinePropertyNode({
          editorState: { entityType: "boundary", side, key: "output_length_mm" },
          descriptor: outputDescriptor,
          value: boundary.output_length_mm,
          onCommitValue: (v) => updateBoundaryField(side, "output_length_mm", v),
          buttonClassName: "gap-pill gap-prop-button",
          editorClassName: "gap-pill gap-prop-editor",
        }),
      ],
    });
    attachZoneDropHandlers(node, side === "left" ? 0 : calculatorState.elements.length);
    return node;
  }

  function createGapCard(gap, index) {
    const [indexDescriptor, distanceDescriptor] = gapPropertyDescriptors();
    const node = element("div", {
      className: "gap-card",
      children: [
        createInlinePropertyNode({
          editorState: { entityType: "gap", index, key: "refractive_index" },
          descriptor: indexDescriptor,
          value: gap.refractive_index,
          onCommitValue: (v) => updateGapField(index, "refractive_index", v),
          buttonClassName: "gap-pill gap-prop-button",
          editorClassName: "gap-pill gap-prop-editor",
        }),
        element("div", { className: "gap-core", children: [element("div", { className: "edge-label", text: gap.label })] }),
        createInlinePropertyNode({
          editorState: { entityType: "gap", index, key: "distance_mm" },
          descriptor: distanceDescriptor,
          value: gap.distance_mm,
          onCommitValue: (v) => updateGapField(index, "distance_mm", v),
          buttonClassName: "gap-pill gap-prop-button",
          editorClassName: "gap-pill gap-prop-editor",
        }),
      ],
    });
    attachZoneDropHandlers(node, index + 1);
    return node;
  }

  function createElementCard(item, index, calculatorState) {
    const endpoints = calculatorState.globals.endpoint_ids || [];
    const transmission = Number((1 - Number(item.reflection || 0)).toFixed(12));

    const titleInput = element("input", {
      className: "element-title-input",
      attrs: { type: "text", value: item.label, draggable: "false" },
    });
    titleInput.addEventListener("click", (event) => event.stopPropagation());
    titleInput.addEventListener("pointerdown", (event) => event.stopPropagation());
    titleInput.addEventListener("dragstart", (event) => event.preventDefault());
    titleInput.addEventListener("keydown", (event) => { if (event.key === "Enter") titleInput.blur(); });
    titleInput.addEventListener("change", () => {
      updateElementField(index, "label", titleInput.value.trim() || item.label);
    });
    titleInput.addEventListener("blur", () => {
      const nextLabel = titleInput.value.trim() || item.label;
      if (nextLabel !== item.label) {
        updateElementField(index, "label", nextLabel);
      } else {
        titleInput.value = item.label;
      }
    });

    const deleteButton = element("button", {
      className: "icon-button",
      html: "&times;",
      attrs: { type: "button", title: "Delete element", "aria-label": "Delete element" },
    });
    deleteButton.addEventListener("click", (event) => { event.stopPropagation(); deleteElement(index); });
    deleteButton.addEventListener("dragstart", (event) => event.preventDefault());

    const endpointButton = element("button", {
      className: `endpoint-button${endpoints.includes(item.id) ? " active" : ""}`,
      text: endpoints.includes(item.id) ? "Endpoint" : "Set endpoint",
      attrs: { type: "button" },
    });
    endpointButton.addEventListener("click", (event) => { event.stopPropagation(); toggleEndpoint(index); });
    endpointButton.addEventListener("dragstart", (event) => event.preventDefault());

    const node = element("div", {
      className: "element-card",
      attrs: { draggable: "true" },
      children: [
        element("div", { className: "element-header", children: [titleInput, deleteButton] }),
        element("div", {
          className: "element-kind-row",
          children: [
            createComponentIcon(item.kind, item.label, "element-kind-icon", {
              flipX: item.kind === "curved_surface" && Number(item.radius_mm || 0) < 0,
            }),
            element("div", { className: "element-kind", text: item.kind.replaceAll("_", " ") }),
          ],
        }),
        element("div", {
          className: "element-props",
          children: elementPropertyDescriptors(item).map((descriptor) =>
            createInlinePropertyNode({
              editorState: { entityType: "element", index, key: descriptor.key, kind: item.kind },
              descriptor: {
                ...descriptor,
                kind: descriptor.kind === "length" ? "length_mm" : descriptor.kind,
                minimum: descriptor.min,
                maximum: descriptor.max,
                suffix: descriptor.kind === "length" ? "mm" : "",
              },
              value: descriptor.key === "transmission" ? transmission : item[descriptor.key],
              onCommitValue: (v) => updateElementField(index, descriptor.key, v),
            }),
          ),
        }),
        element("div", { className: "element-footer", children: [endpointButton] }),
      ],
    });

    node.addEventListener("dragstart", (event) => {
      node.classList.add("dragging");
      event.dataTransfer.setData("text/plain", JSON.stringify({ source: "element", index }));
    });
    node.addEventListener("dragend", () => node.classList.remove("dragging"));
    attachElementSwapHandlers(node, index);
    return node;
  }

  // ── Public rendering entry-points ─────────────────────────────────────────

  function renderAxisBuilder(builderPanel, builderContainer) {
    const calculatorState = getState();
    builderPanel.style.display = "";

    const axisShell = element("div", { className: "axis-shell" });
    const track = element("div", { className: "axis-track" });

    if (!calculatorState.elements.length) {
      const emptyDrop = element("div", {
        className: "empty-drop-target",
        children: [element("div", { html: "<strong>Drag a component here</strong><br>Start by dropping a surface or lens onto the optical axis." })],
      });
      attachZoneDropHandlers(emptyDrop, 0);
      track.append(emptyDrop);
    } else {
      track.append(createBoundaryCard("left", calculatorState));
      calculatorState.elements.forEach((item, index) => {
        track.append(createElementCard(item, index, calculatorState));
        if (index < calculatorState.gaps.length) {
          track.append(createGapCard(calculatorState.gaps[index], index));
        }
      });
      track.append(createBoundaryCard("right", calculatorState));
    }

    axisShell.append(track);
    builderContainer.replaceChildren(element("div", { className: "builder-layout", children: [axisShell] }));
  }

  function renderBuilderToolbar(toolbarContainer) {
    const schema = getSchema();
    const calculatorState = getState();

    const fieldNodes = (schema.global_fields || []).map((field) =>
      renderField(field, getValueByPath(calculatorState, field.path),
        (nextValue) => onUpdateGlobal(field.path, nextValue), calculatorState),
    );

    const palette = buildComponentPalette(schema, (event, kind) => {
      event.dataTransfer.setData("text/plain", JSON.stringify({ source: "palette", kind }));
    });

    toolbarContainer.replaceChildren(
      element("div", { className: "builder-toolbar-fields", children: fieldNodes }),
      palette,
    );
    toolbarContainer.style.display = "";
  }

  // ── Public: selection validation after external state changes ─────────────

  function ensureValidSelection() {
    const calculatorState = getState();
    if (!calculatorState || !Array.isArray(calculatorState.elements)) {
      inlinePropertyEditor = null;
      return;
    }
    if (
      inlinePropertyEditor &&
      (
        (inlinePropertyEditor.entityType === "element" &&
          (inlinePropertyEditor.index >= calculatorState.elements.length ||
           !calculatorState.elements[inlinePropertyEditor.index] ||
           calculatorState.elements[inlinePropertyEditor.index].kind !== inlinePropertyEditor.kind)) ||
        (inlinePropertyEditor.entityType === "gap" &&
          inlinePropertyEditor.index >= calculatorState.gaps.length) ||
        (inlinePropertyEditor.entityType === "boundary" &&
          !["left", "right"].includes(inlinePropertyEditor.side))
      )
    ) {
      inlinePropertyEditor = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    clearEditor() { inlinePropertyEditor = null; },
    ensureValidSelection,
    renderAxisBuilder,
    renderBuilderToolbar,
  };
}


function setPlotReadout(readoutHost, content) {
  readoutHost.replaceChildren(
    element("p", { className: "plot-readout-title", text: content.title }),
    element("p", { className: "plot-readout-body", html: content.body }),
  );
}


function collectXCoordinates(plot) {
  const values = [];
  for (const segment of plot.segments || []) {
    values.push(...segment.x_mm);
  }
  for (const trace of plot.traces || []) {
    values.push(...trace.x_mm);
  }
  for (const item of plot.elements || []) {
    values.push(item.position_mm);
  }
  if (plot.waist_marker) {
    values.push(plot.waist_marker.x_mm);
  }
  return values.length ? values : [0];
}


function defaultPlotReadout(plot, result) {
  if (plot.segments && plot.segments.length) {
    return {
      title: "Move across the plot",
      body: "A vertical cursor will follow your mouse anywhere inside the plotting area. Hover near an optical element to highlight it, or move through an interval to inspect its local mode, dashed continuation, and waist location.",
    };
  }
  if (result && result.error) {
    return {
      title: "Waiting for a valid optical axis",
      body: result.error,
    };
  }
  return {
    title: "Hover the plot",
    body: "Move over the plotted beam envelope to inspect the current cross-section.",
  };
}


function interpolateSegmentSpot(segment, xValue) {
  const x = segment.x_mm;
  const y = segment.y_um;
  if (!x.length) {
    return 0;
  }

  for (let index = 1; index < x.length; index += 1) {
    const left = x[index - 1];
    const right = x[index];
    if ((left <= xValue && xValue <= right) || (right <= xValue && xValue <= left)) {
      if (left === right) {
        return y[index];
      }
      const fraction = (xValue - left) / (right - left);
      return y[index - 1] + fraction * (y[index] - y[index - 1]);
    }
  }

  let bestIndex = 0;
  let bestDistance = Math.abs(x[0] - xValue);
  for (let index = 1; index < x.length; index += 1) {
    const distance = Math.abs(x[index] - xValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return y[bestIndex];
}


function gaussianEnvelopeFromSegment(segment, xValues) {
  const waistRadius = Number(segment.waist_radius_um);
  const waistPosition = Number(segment.waist_position_mm);
  const rayleighRange = Math.max(1e-9, Math.abs(Number(segment.rayleigh_range_mm)));
  return xValues.map((xValue) => waistRadius * Math.sqrt(1 + ((xValue - waistPosition) / rayleighRange) ** 2));
}


function plotXBounds(plot) {
  const coordinates = collectXCoordinates(plot);
  const xMin = Math.min(...coordinates);
  const xMax = Math.max(...coordinates);
  const span = Math.max(1.0, xMax - xMin);
  return {
    xMin: xMin - 0.03 * span,
    xMax: xMax + 0.03 * span,
  };
}


function sampleLocalModeOverlay(plot, segment) {
  const { xMin, xMax } = plotXBounds(plot);
  const xStart = Math.min(segment.x_start_mm, segment.x_end_mm);
  const xEnd = Math.max(segment.x_start_mm, segment.x_end_mm);

  const leftX = xMin < xStart ? linspace(xMin, xStart, 80) : [];
  const insideX = linspace(xStart, xEnd, 120);
  const rightX = xEnd < xMax ? linspace(xEnd, xMax, 80) : [];

  return {
    leftX,
    leftY: gaussianEnvelopeFromSegment(segment, leftX),
    insideX,
    insideY: gaussianEnvelopeFromSegment(segment, insideX),
    rightX,
    rightY: gaussianEnvelopeFromSegment(segment, rightX),
    waistInBounds: segment.waist_position_mm >= xMin && segment.waist_position_mm <= xMax,
  };
}


function buildHoverReadout(segment, xValue) {
  const spotSizeUm = interpolateSegmentSpot(segment, xValue);
  return {
    title: `${segment.name} · ${segment.segment_label}`,
    body:
      `x = <strong>${formatNumber(xValue, 3)} mm</strong><br>` +
      `spot size = <strong>${formatNumber(spotSizeUm, 3)} um</strong><br>` +
      `local waist w0 = <strong>${formatNumber(segment.waist_radius_um, 3)} um</strong><br>` +
      `local waist x0 = <strong>${formatNumber(segment.waist_position_mm, 3)} mm</strong><br>` +
      `Rayleigh range = <strong>${formatNumber(segment.rayleigh_range_mm, 3)} mm</strong><br>` +
      `n = <strong>${formatNumber(segment.refractive_index, 4)}</strong>`,
  };
}


function buildCursorOnlyReadout(xValue) {
  return {
    title: "No beam segment at this x",
    body:
      `x = <strong>${formatNumber(xValue, 3)} mm</strong><br>` +
      "Move the cursor onto an interval that contains a propagated beam segment to inspect its local mode data.",
  };
}


function findHoveredElement(plot, xValue) {
  const targets = plot.element_targets || [];
  if (!targets.length) {
    return null;
  }
  const activeTargets = targets.filter((target) => xValue >= target.minX && xValue <= target.maxX);
  if (!activeTargets.length) {
    return null;
  }
  const bestTarget = activeTargets.reduce((best, candidate) => {
    const bestDistance = Math.abs(xValue - 0.5 * (best.minX + best.maxX));
    const candidateDistance = Math.abs(xValue - 0.5 * (candidate.minX + candidate.maxX));
    return candidateDistance < bestDistance ? candidate : best;
  });
  return (plot.elements || []).find((item) => item.id === bestTarget.elementId) || null;
}


function buildElementReadout(item) {
  const lines = [
    `x = <strong>${formatNumber(item.position_mm, 3)} mm</strong>`,
    `R = <strong>${formatNumber(item.reflection, 3)}</strong>`,
    `T = <strong>${formatNumber(item.transmission, 3)}</strong>`,
  ];
  if (item.kind === "curved_surface") {
    lines.splice(1, 0, `ROC = <strong>${formatNumber(item.radius_mm, 3)} mm</strong>`);
  } else if (item.kind === "lens") {
    lines.splice(1, 0, `f = <strong>${formatNumber(item.focal_length_mm, 3)} mm</strong>`);
  }
  if (item.is_endpoint) {
    lines.push("<strong>Selected as cavity endpoint</strong>");
  }
  return {
    title: `${item.label} · ${item.kind_title}`,
    body: lines.join("<br>"),
  };
}


function buildBaseShapes(plot) {
  return [
    {
      type: "line",
      x0: Math.min(...collectXCoordinates(plot), -10),
      x1: Math.max(...collectXCoordinates(plot), 10),
      y0: 0,
      y1: 0,
      line: { color: "rgba(36, 31, 23, 0.12)", width: 1 },
    },
  ];
}


function segmentContainsX(segment, xValue) {
  const minimum = Math.min(segment.x_start_mm, segment.x_end_mm) - 1e-9;
  const maximum = Math.max(segment.x_start_mm, segment.x_end_mm) + 1e-9;
  return xValue >= minimum && xValue <= maximum;
}


function findSegmentAtX(plot, xValue, preferredSegmentId = null) {
  const segments = plot.segments || [];
  if (!segments.length) {
    return null;
  }

  if (preferredSegmentId) {
    const preferred = segments.find((segment) => segment.id === preferredSegmentId);
    if (preferred && segmentContainsX(preferred, xValue)) {
      return preferred;
    }
  }

  const containing = segments.filter((segment) => segmentContainsX(segment, xValue));
  if (!containing.length) {
    return null;
  }
  if (containing.length === 1) {
    return containing[0];
  }

  return containing.reduce((best, candidate) => {
    const bestCenter = 0.5 * (best.x_start_mm + best.x_end_mm);
    const candidateCenter = 0.5 * (candidate.x_start_mm + candidate.x_end_mm);
    return Math.abs(candidateCenter - xValue) < Math.abs(bestCenter - xValue) ? candidate : best;
  });
}


function createOpticalAxisUi({
  getState,
  getSchema,
  onCommit,
  onUpdateGlobal,
  onRerender,
}) {
  const axisController = createOpticalAxisController({
    getState,
    getSchema,
    onCommit,
    onUpdateGlobal,
    onRerender,
  });

  let plotTraceMeta = [];
  let currentHoverSegmentId = null;
  let currentHoverElementId = null;
  let plotPointerMoveHandler = null;
  let plotPointerLeaveHandler = null;
  let activeModeOverlayIndices = null;
  let activePlotHost = null;

  function detachPlotListeners() {
    if (!activePlotHost) {
      return;
    }
    if (typeof activePlotHost.removeAllListeners === "function") {
      activePlotHost.removeAllListeners("plotly_hover");
      activePlotHost.removeAllListeners("plotly_unhover");
    }
    if (plotPointerMoveHandler) {
      activePlotHost.removeEventListener("mousemove", plotPointerMoveHandler);
      plotPointerMoveHandler = null;
    }
    if (plotPointerLeaveHandler) {
      activePlotHost.removeEventListener("mouseleave", plotPointerLeaveHandler);
      plotPointerLeaveHandler = null;
    }
  }

  function updateActiveModeOverlay(plotHost, plot, segment) {
    if (!(activeModeOverlayIndices && plotHost)) {
      return;
    }

    if (!segment) {
      const empty = [[], [], [], [], [], [], [], []];
      Plotly.restyle(plotHost, { x: empty, y: empty, text: [[], [], [], [], [], [], [], []] }, activeModeOverlayIndices);
      return;
    }

    const overlay = sampleLocalModeOverlay(plot, segment);
    const fillX = [...overlay.insideX, ...[...overlay.insideX].reverse()];
    const fillY = [...overlay.insideY, ...[...overlay.insideY].reverse().map((value) => -value)];
    const waistLabel = `x0 = ${formatNumber(segment.waist_position_mm, 3)} mm<br>w = ${formatNumber(segment.waist_radius_um, 3)} um`;
    const waistX = overlay.waistInBounds ? [segment.waist_position_mm] : [];
    const waistY = overlay.waistInBounds ? [0] : [];
    const waistText = overlay.waistInBounds ? [waistLabel] : [];

    Plotly.restyle(plotHost, {
      x: [
        fillX,
        overlay.insideX,
        overlay.insideX,
        overlay.leftX,
        overlay.leftX,
        overlay.rightX,
        overlay.rightX,
        waistX,
      ],
      y: [
        fillY,
        overlay.insideY,
        overlay.insideY.map((value) => -value),
        overlay.leftY,
        overlay.leftY.map((value) => -value),
        overlay.rightY,
        overlay.rightY.map((value) => -value),
        waistY,
      ],
      text: [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        waistText,
      ],
      "line.color": [
        hexToRgba(segment.color, 0),
        segment.color,
        segment.color,
        segment.color,
        segment.color,
        segment.color,
        segment.color,
        "#111111",
      ],
      fillcolor: [
        hexToRgba(segment.color, 0.22),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
      "marker.color": [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "#111111",
      ],
    }, activeModeOverlayIndices);
  }

  function restyleBeamTraces(plotHost, segmentId = null) {
    if (!plotTraceMeta.length) {
      return;
    }
    const opacities = plotTraceMeta.map((meta) => {
      if (meta.kind === "beam-fill") {
        if (!segmentId) {
          return meta.baseOpacity || 0.18;
        }
        return 0.05;
      }
      if (meta.kind !== "beam-line") {
        return 1;
      }
      if (!segmentId) {
        return 1;
      }
      return 0.14;
    });
    const dashes = plotTraceMeta.map((meta) => meta.baseDash || "solid");
    const widths = plotTraceMeta.map((meta) => {
      if (meta.kind !== "beam-line") {
        return meta.baseWidth || 3;
      }
      if (!segmentId) {
        return 4;
      }
      return 3.0;
    });
    Plotly.restyle(plotHost, {
      opacity: opacities,
      "line.dash": dashes,
      "line.width": widths,
    });
  }

  function restyleElementTraces(plotHost, elementId = null) {
    if (!plotTraceMeta.length) {
      return;
    }
    const elementIndices = [];
    const lineColors = [];
    const lineWidths = [];
    const fillColors = [];
    plotTraceMeta.forEach((meta, index) => {
      if (meta.kind !== "element") {
        return;
      }
      elementIndices.push(index);
      lineColors.push(meta.elementId === elementId ? "#b34700" : meta.baseLineColor);
      lineWidths.push(meta.elementId === elementId ? meta.baseWidth + 1.6 : meta.baseWidth);
      fillColors.push(
        meta.elementId === elementId && meta.baseFillColor
          ? "rgba(180, 71, 0, 0.24)"
          : (meta.baseFillColor || null),
      );
    });
    if (!elementIndices.length) {
      return;
    }
    Plotly.restyle(plotHost, {
      "line.color": lineColors,
      "line.width": lineWidths,
      fillcolor: fillColors,
    }, elementIndices);
  }

  function getPlotPointerState(plotHost, event) {
    if (!(plotHost && plotHost._fullLayout && plotHost._fullLayout.xaxis && plotHost._fullLayout.yaxis)) {
      return null;
    }

    const rect = plotHost.getBoundingClientRect();
    const xPixel = event.clientX - rect.left;
    const xaxis = plotHost._fullLayout.xaxis;
    const xOffset = xaxis._offset || 0;
    const xLength = xaxis._length || 0;
    const clampedPixel = clamp(xPixel, xOffset, xOffset + xLength);

    return {
      xValue: xaxis.p2l(clampedPixel - xOffset),
    };
  }

  function applyPlotCursor(plotHost, readoutHost, plot, xValue) {
    const hoveredElement = findHoveredElement(plot, xValue);
    currentHoverElementId = hoveredElement ? hoveredElement.id : null;
    restyleElementTraces(plotHost, currentHoverElementId);

    const segment = hoveredElement ? null : findSegmentAtX(plot, xValue, currentHoverSegmentId);
    const activeSegmentId = segment ? segment.id : null;
    currentHoverSegmentId = activeSegmentId;
    restyleBeamTraces(plotHost, activeSegmentId);
    updateActiveModeOverlay(plotHost, plot, segment);
    setPlotReadout(
      readoutHost,
      hoveredElement
        ? buildElementReadout(hoveredElement)
        : (segment ? buildHoverReadout(segment, xValue) : buildCursorOnlyReadout(xValue)),
    );
    Plotly.relayout(plotHost, {
      shapes: [
        ...buildBaseShapes(plot),
        {
          type: "line",
          x0: xValue,
          x1: xValue,
          y0: -1.18 * plot.y_max_um,
          y1: 1.18 * plot.y_max_um,
          line: { color: "rgba(11, 114, 133, 0.65)", width: 2, dash: "dot" },
        },
      ],
    });
  }

  function clearPlotHover(plotHost, readoutHost, plot, result) {
    currentHoverSegmentId = null;
    currentHoverElementId = null;
    restyleBeamTraces(plotHost, null);
    restyleElementTraces(plotHost, null);
    updateActiveModeOverlay(plotHost, plot, null);
    setPlotReadout(readoutHost, defaultPlotReadout(plot, result));
    Plotly.relayout(plotHost, {
      shapes: buildBaseShapes(plot),
    });
  }

  return {
    matches({ schema }) {
      return schema?.layout === "optical_axis";
    },

    getShellConfig({ calculator }) {
      return {
        showHero: false,
        plotSectionTitle: calculator?.title || "Optical axis",
        builderHint: "Drag components onto the axis, drop onto other elements to swap them, edit parameters directly in place, and move across the plot to inspect the active interval.",
        successHint: "Edit element, gap, and boundary parameters directly in place. Move anywhere across the plot to inspect the active interval and its local beam data.",
        showBuilder: true,
      };
    },

    clearTransientState() {
      axisController.clearEditor();
      currentHoverSegmentId = null;
      currentHoverElementId = null;
      plotTraceMeta = [];
      activeModeOverlayIndices = null;
      detachPlotListeners();
    },

    syncState() {
      axisController.ensureValidSelection();
    },

    renderBuilder({ builderPanel, builderToolbar, builderContainer }) {
      builderPanel.style.display = "";
      axisController.renderBuilderToolbar(builderToolbar);
      axisController.renderAxisBuilder(builderPanel, builderContainer);
    },

    renderPlot({ plotHost, readoutHost, result, schema }) {
      readoutHost.style.display = "";
      plotHost.style.minHeight = "";
      if (typeof Plotly?.purge === "function") {
        Plotly.purge(plotHost);
      }
      plotHost.replaceChildren();
      const plot = (result && result.plot) || {
        traces: [],
        segments: [],
        elements: [],
        waist_marker: null,
        y_max_um: 200,
      };
      const yMax = plot.y_max_um || 200;
      const xBounds = plotXBounds(plot);
      const traces = [];
      const traceMeta = [];

      activePlotHost = plotHost;
      detachPlotListeners();
      currentHoverSegmentId = null;
      currentHoverElementId = null;

      if (plot.segments && plot.segments.length) {
        const legendSeen = new Set();
        for (const segment of plot.segments) {
          const showLegend = !legendSeen.has(segment.branch);
          legendSeen.add(segment.branch);
          traces.push({
            x: [...segment.x_mm, ...[...segment.x_mm].reverse()],
            y: [...segment.y_um, ...[...segment.y_um].reverse().map((value) => -value)],
            type: "scatter",
            mode: "lines",
            hoverinfo: "skip",
            fill: "toself",
            fillcolor: hexToRgba(segment.color, 0.18),
            line: { color: hexToRgba(segment.color, 0.0), width: 0 },
            showlegend: false,
            opacity: 0.18,
          });
          traceMeta.push({
            kind: "beam-fill",
            segmentId: segment.id,
            baseOpacity: 0.18,
            baseDash: "solid",
            baseWidth: 0,
          });
          traces.push({
            x: segment.x_mm,
            y: segment.y_um,
            type: "scatter",
            mode: "lines",
            name: segment.name,
            text: segment.hover_text,
            hovertemplate: "%{text}<extra></extra>",
            customdata: segment.x_mm.map(() => segment.id),
            hoverinfo: "skip",
            line: { color: segment.color, width: 4, dash: "solid" },
            showlegend: showLegend,
            legendgroup: segment.branch,
            opacity: 1,
          });
          traceMeta.push({ kind: "beam-line", segmentId: segment.id, baseDash: "solid", baseWidth: 4 });
          traces.push({
            x: segment.x_mm,
            y: segment.y_um.map((value) => -value),
            type: "scatter",
            mode: "lines",
            text: segment.hover_text,
            hovertemplate: "%{text}<extra></extra>",
            customdata: segment.x_mm.map(() => segment.id),
            hoverinfo: "skip",
            line: { color: segment.color, width: 4, dash: "solid" },
            showlegend: false,
            legendgroup: segment.branch,
            opacity: 1,
          });
          traceMeta.push({ kind: "beam-line", segmentId: segment.id, baseDash: "solid", baseWidth: 4 });
        }
      } else {
        for (const trace of plot.traces || []) {
          traces.push({
            x: trace.x_mm,
            y: trace.y_um,
            type: "scatter",
            mode: "lines",
            name: trace.name,
            text: trace.hover_text,
            hovertemplate: "%{text}<extra></extra>",
            hoverinfo: "skip",
            line: { color: trace.color, width: 4, dash: trace.dash || "solid" },
            opacity: 1,
          });
          traceMeta.push({ kind: "beam-line", segmentId: null, baseDash: trace.dash || "solid", baseWidth: 4 });
          traces.push({
            x: trace.x_mm,
            y: trace.y_um.map((value) => -value),
            type: "scatter",
            mode: "lines",
            showlegend: false,
            text: trace.hover_text,
            hovertemplate: "%{text}<extra></extra>",
            hoverinfo: "skip",
            line: { color: trace.color, width: 4, dash: trace.dash || "solid" },
            opacity: 1,
          });
          traceMeta.push({ kind: "beam-line", segmentId: null, baseDash: trace.dash || "solid", baseWidth: 4 });
        }
      }

      const overlayIndices = [];
      const overlayTraces = [
        {
          x: [],
          y: [],
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip",
          fill: "toself",
          fillcolor: "rgba(0, 95, 115, 0.18)",
          line: { color: "rgba(0,0,0,0)", width: 0 },
          showlegend: false,
        },
        {
          x: [],
          y: [],
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip",
          line: { color: "#005f73", width: 4.8, dash: "solid" },
          showlegend: false,
        },
        {
          x: [],
          y: [],
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip",
          line: { color: "#005f73", width: 4.8, dash: "solid" },
          showlegend: false,
        },
        {
          x: [],
          y: [],
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip",
          line: { color: "#005f73", width: 3.6, dash: "dash" },
          showlegend: false,
        },
        {
          x: [],
          y: [],
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip",
          line: { color: "#005f73", width: 3.6, dash: "dash" },
          showlegend: false,
        },
        {
          x: [],
          y: [],
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip",
          line: { color: "#005f73", width: 3.6, dash: "dash" },
          showlegend: false,
        },
        {
          x: [],
          y: [],
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip",
          line: { color: "#005f73", width: 3.6, dash: "dash" },
          showlegend: false,
        },
        {
          x: [],
          y: [],
          type: "scatter",
          mode: "markers+text",
          text: [],
          textposition: "top center",
          hoverinfo: "skip",
          marker: { color: "#111111", size: 9 },
          textfont: { size: 12, color: "#111111" },
          showlegend: false,
        },
      ];
      for (const trace of overlayTraces) {
        overlayIndices.push(traces.length);
        traces.push(trace);
        traceMeta.push({
          kind: "overlay",
          segmentId: null,
          baseDash: trace.line ? trace.line.dash || "solid" : "solid",
          baseWidth: trace.line ? trace.line.width || 0 : 0,
        });
      }

      const elementPlot = buildElementPlotTraces(plot, yMax);
      plot.element_targets = elementPlot.targets || [];
      elementPlot.traces.forEach((trace, index) => {
        traces.push(trace);
        traceMeta.push({
          kind: "element",
          elementId: (plot.elements || [])[index]?.id || null,
          segmentId: null,
          baseDash: "solid",
          baseWidth: trace.line?.width || 3,
          baseLineColor: trace.line?.color || "#334155",
          baseFillColor: trace.fillcolor || null,
        });
      });

      if (plot.waist_marker) {
        traces.push({
          x: [plot.waist_marker.x_mm],
          y: [plot.waist_marker.y_um],
          type: "scatter",
          mode: "markers+text",
          text: [plot.waist_marker.label],
          textposition: "top center",
          marker: { color: "#000000", size: 11 },
          hovertemplate: "Waist<br>x = %{x:.3f} mm<extra></extra>",
          name: "Waist",
        });
        traceMeta.push({ kind: "decoration", segmentId: null, baseDash: "solid", baseWidth: 0 });
      }

      plotTraceMeta = traceMeta;
      activeModeOverlayIndices = overlayIndices;
      Plotly.react(plotHost, traces, {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(255,255,255,0.82)",
        margin: { t: 24, r: 24, b: 64, l: 72 },
        xaxis: {
          title: "Axis Position [mm]",
          range: [xBounds.xMin, xBounds.xMax],
          zeroline: false,
          gridcolor: "rgba(36, 31, 23, 0.1)",
        },
        yaxis: {
          title: "Beam Radius [um]",
          range: [-1.18 * yMax, 1.18 * yMax],
          zeroline: false,
          gridcolor: "rgba(36, 31, 23, 0.1)",
        },
        hovermode: false,
        hoverdistance: -1,
        legend: {
          orientation: "h",
          x: 1,
          xanchor: "right",
          y: 1.12,
        },
        annotations: elementPlot.annotations,
        shapes: buildBaseShapes(plot),
        uirevision: `plot-${(schema && schema.id) || "calculator"}`,
      }, {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
      });

      plotPointerMoveHandler = (event) => {
        const pointerState = getPlotPointerState(plotHost, event);
        if (!pointerState) {
          return;
        }
        applyPlotCursor(plotHost, readoutHost, plot, pointerState.xValue);
      };
      plotPointerLeaveHandler = () => {
        if (!(plot.segments && plot.segments.length) && !(plot.elements && plot.elements.length)) {
          return;
        }
        clearPlotHover(plotHost, readoutHost, plot, result);
      };

      plotHost.addEventListener("mousemove", plotPointerMoveHandler);
      plotHost.addEventListener("mouseleave", plotPointerLeaveHandler);

      setPlotReadout(readoutHost, defaultPlotReadout(plot, result));
    },
  };
}


const CAVITY_SUCCESS_HINT =
  "Edit element, gap, and boundary parameters directly in place. Move anywhere across the plot to inspect the active interval and its local beam data.";
const CAVITY_BUILDER_HINT =
  "Drag components onto the axis, drop onto other elements to swap them, edit parameters directly in place, and move across the plot to inspect the active interval.";


export function createCavityModeTab({ title } = {}) {
  function mount(workspace, services) {
    const builder = createBuilderPanel({ heading: "Builder" });
    builder.setHint(CAVITY_BUILDER_HINT);
    const plot = createPlotPanel({ sectionTitle: title || "Cavity mode" });
    const messages = createMessagesPanel();

    workspace.append(builder.node, plot.node, messages.node);

    const ui = createOpticalAxisUi({
      getState: services.getState,
      getSchema: services.getSchema,
      onCommit: services.commitState,
      onUpdateGlobal: services.updateGlobal,
      onRerender: services.rerender,
    });

    function update(ctx) {
      ui.syncState?.();
      plot.setTitle(ctx.calculator?.title || title || "Cavity mode");

      ui.renderBuilder({
        builderPanel: builder.node,
        builderToolbar: builder.toolbarHost,
        builderContainer: builder.builderHost,
      });

      ui.renderPlot({
        plotHost: plot.plotHost,
        readoutHost: plot.readoutHost,
        result: ctx.result,
        schema: ctx.schema,
      });

      plot.setMetrics(ctx.result?.plot_metrics || []);
      messages.setMessages(
        collectStandardMessages(ctx.result, { successHint: CAVITY_SUCCESS_HINT }),
      );
    }

    function unmount() {
      ui.clearTransientState?.();
      if (typeof Plotly?.purge === "function") Plotly.purge(plot.plotHost);
      workspace.replaceChildren();
    }

    return { update, unmount };
  }

  return { mount };
}
