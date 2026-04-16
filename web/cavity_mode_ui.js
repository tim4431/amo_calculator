import {
  clamp,
  deepCopy,
  element,
  formatCompactNumber,
  getValueByPath,
  linspace,
  renderField,
} from "./ui_common.js";


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
      reflection: kind === "curved_surface" ? 0.95 : 0.0,
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
