const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

const PYTHON_FILES = [
  "core/__init__.py",
  "core/gaussian_beam.py",
  "core/cavity_mode.py",
  "webapp/__init__.py",
  "webapp/base.py",
  "webapp/registry.py",
  "webapp/calculators/__init__.py",
  "webapp/calculators/cavity_mode.py",
  "webapp/calculators/gaussian_beam.py",
];

const appState = {
  pyodide: null,
  calculators: [],
  schemas: new Map(),
  states: new Map(),
  results: new Map(),
  activeCalculatorId: null,
  selectedEntity: null,
  computeTimer: null,
};

const dom = {
  runtimeStatus: document.getElementById("runtime-status"),
  tabs: document.getElementById("tabs"),
  calculatorTitle: document.getElementById("calculator-title"),
  calculatorDescription: document.getElementById("calculator-description"),
  globalControls: document.getElementById("global-controls"),
  inspectorPanel: document.getElementById("inspector-panel"),
  inspector: document.getElementById("inspector"),
  summary: document.getElementById("summary"),
  builderPanel: document.getElementById("builder-panel"),
  builder: document.getElementById("builder"),
  builderHint: document.getElementById("builder-hint"),
  messages: document.getElementById("messages"),
  plot: document.getElementById("plot"),
};


function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}


function element(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.html !== undefined) {
    node.innerHTML = options.html;
  }
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value !== undefined && value !== null) {
        node.setAttribute(key, String(value));
      }
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      node.dataset[key] = value;
    }
  }
  if (options.children) {
    node.append(...options.children);
  }
  return node;
}


function getActiveSchema() {
  return appState.schemas.get(appState.activeCalculatorId) || null;
}


function getActiveState() {
  return appState.states.get(appState.activeCalculatorId) || null;
}


function getActiveResult() {
  return appState.results.get(appState.activeCalculatorId) || null;
}


function setStatus(message, kind = "") {
  dom.runtimeStatus.textContent = message;
  dom.runtimeStatus.className = `status-pill${kind ? ` ${kind}` : ""}`;
}


function getValueByPath(target, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), target);
}


function setValueByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}


function optionsForField(field, calculatorState) {
  if (field.options_source === "elements") {
    return (calculatorState.elements || []).map((item) => ({
      value: item.id,
      label: item.label,
    }));
  }
  return field.options || [];
}


function formatNumber(value, digits = 3) {
  return Number(value).toFixed(digits);
}


function nextUniqueId(kind, elements) {
  const prefix = {
    curved_surface: "mirror",
    plane_surface: "surface",
    lens: "lens",
  }[kind] || "element";
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
  const labels = {
    curved_surface: "Curved Surface",
    plane_surface: "Plane Surface",
    lens: "Lens",
  };
  const count = state.elements.filter((item) => item.kind === kind).length + 1;
  const base = {
    id: nextUniqueId(kind, state.elements),
    kind,
    label: `${labels[kind] || "Element"} ${count}`,
    reflection: kind === "curved_surface" ? 0.95 : 0.0,
    transmission: kind === "curved_surface" ? 0.05 : 1.0,
  };
  if (kind === "curved_surface") {
    base.radius_mm = 50.0;
  }
  if (kind === "lens") {
    base.focal_length_mm = 50.0;
  }
  return base;
}


function defaultGap(state, labelIndex, refractiveIndex = 1.0, distanceMm = 20.0) {
  return {
    label: `Gap ${labelIndex}`,
    refractive_index: refractiveIndex,
    distance_mm: distanceMm,
  };
}


function renumberGapLabels(state) {
  state.gaps.forEach((gap, index) => {
    gap.label = `Gap ${index + 1}`;
  });
}


function reconcileEndpoints(state) {
  const ids = (state.elements || []).map((item) => item.id);
  if (!ids.length) {
    state.globals.cavity_left_id = null;
    state.globals.cavity_right_id = null;
    return;
  }
  if (!ids.includes(state.globals.cavity_left_id)) {
    state.globals.cavity_left_id = ids[0];
  }
  if (!ids.includes(state.globals.cavity_right_id)) {
    state.globals.cavity_right_id = ids[ids.length - 1];
  }
  const leftIndex = ids.indexOf(state.globals.cavity_left_id);
  const rightIndex = ids.indexOf(state.globals.cavity_right_id);
  if (leftIndex === rightIndex && ids.length > 1) {
    state.globals.cavity_right_id = ids[Math.min(ids.length - 1, leftIndex + 1)];
  }
  if (ids.indexOf(state.globals.cavity_left_id) > ids.indexOf(state.globals.cavity_right_id)) {
    const previousLeft = state.globals.cavity_left_id;
    state.globals.cavity_left_id = state.globals.cavity_right_id;
    state.globals.cavity_right_id = previousLeft;
  }
}


function ensureValidSelection() {
  const schema = getActiveSchema();
  const calculatorState = getActiveState();
  if (!schema || !calculatorState || schema.layout !== "optical_axis") {
    appState.selectedEntity = null;
    return;
  }
  if (!appState.selectedEntity) {
    return;
  }
  const { type, index } = appState.selectedEntity;
  if (type === "element" && index >= calculatorState.elements.length) {
    appState.selectedEntity = null;
  }
  if (type === "gap" && index >= calculatorState.gaps.length) {
    appState.selectedEntity = null;
  }
}


function commitState(nextState, { rerender = true, recompute = true } = {}) {
  appState.states.set(appState.activeCalculatorId, nextState);
  ensureValidSelection();
  if (rerender) {
    renderApp();
  }
  if (recompute) {
    scheduleCompute();
  }
}


function updateGlobalField(path, value) {
  const nextState = deepCopy(getActiveState());
  setValueByPath(nextState, path, value);
  reconcileEndpoints(nextState);
  commitState(nextState);
}


function updateSelectedElementField(index, key, value) {
  const nextState = deepCopy(getActiveState());
  nextState.elements[index][key] = value;
  reconcileEndpoints(nextState);
  commitState(nextState);
}


function updateSelectedGapField(index, key, value) {
  const nextState = deepCopy(getActiveState());
  nextState.gaps[index][key] = value;
  commitState(nextState);
}


function insertElementAt(zoneIndex, kind) {
  const nextState = deepCopy(getActiveState());
  const item = defaultElement(kind, nextState);
  const elementCount = nextState.elements.length;

  if (elementCount === 0) {
    nextState.elements.push(item);
  } else if (zoneIndex === 0) {
    nextState.elements.splice(0, 0, item);
    nextState.gaps.splice(0, 0, defaultGap(nextState, 1, nextState.globals.left_environment_n));
  } else if (zoneIndex === elementCount) {
    nextState.elements.push(item);
    nextState.gaps.push(defaultGap(nextState, nextState.gaps.length + 1, nextState.globals.right_environment_n));
  } else {
    const oldGap = nextState.gaps[zoneIndex - 1] || defaultGap(nextState, zoneIndex);
    const firstDistance = Math.max(0.1, oldGap.distance_mm / 2);
    const secondDistance = Math.max(0.1, oldGap.distance_mm - firstDistance);
    const leftGap = {
      label: oldGap.label,
      refractive_index: oldGap.refractive_index,
      distance_mm: firstDistance,
    };
    const rightGap = {
      label: oldGap.label,
      refractive_index: oldGap.refractive_index,
      distance_mm: secondDistance,
    };
    nextState.elements.splice(zoneIndex, 0, item);
    nextState.gaps.splice(zoneIndex - 1, 1, leftGap, rightGap);
  }

  renumberGapLabels(nextState);
  reconcileEndpoints(nextState);
  appState.selectedEntity = { type: "element", index: zoneIndex };
  commitState(nextState);
}


function moveElement(sourceIndex, zoneIndex) {
  const nextState = deepCopy(getActiveState());
  if (
    sourceIndex < 0 ||
    sourceIndex >= nextState.elements.length ||
    zoneIndex < 0 ||
    zoneIndex > nextState.elements.length
  ) {
    return;
  }

  const [item] = nextState.elements.splice(sourceIndex, 1);
  let targetIndex = zoneIndex;
  if (sourceIndex < zoneIndex) {
    targetIndex -= 1;
  }
  nextState.elements.splice(targetIndex, 0, item);
  reconcileEndpoints(nextState);
  appState.selectedEntity = { type: "element", index: targetIndex };
  commitState(nextState);
}


function deleteSelectedElement(index) {
  const nextState = deepCopy(getActiveState());
  if (index < 0 || index >= nextState.elements.length) {
    return;
  }

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
  appState.selectedEntity = null;
  commitState(nextState);
}


function scheduleCompute() {
  clearTimeout(appState.computeTimer);
  appState.computeTimer = window.setTimeout(() => {
    void recomputeActiveCalculator();
  }, 160);
}


function showMessages(messages) {
  dom.messages.replaceChildren(...messages);
}


async function loadPyodideRuntime() {
  setStatus("Loading Pyodide...", "busy");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  setStatus("Loading numpy...", "busy");
  await pyodide.loadPackage(["numpy"]);

  for (const relativePath of PYTHON_FILES) {
    setStatus(`Loading ${relativePath}...`, "busy");
    const response = await fetch(relativePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${relativePath}: ${response.status}`);
    }
    const source = await response.text();
    const fsPath = `/${relativePath}`;
    ensureDirectory(pyodide, fsPath.split("/").slice(0, -1).join("/"));
    pyodide.FS.writeFile(fsPath, source, { encoding: "utf8" });
  }

  pyodide.runPython(`
import sys
sys.path.insert(0, "/")
`);
  appState.pyodide = pyodide;
  setStatus("Python runtime ready");
}


function ensureDirectory(pyodide, directoryPath) {
  if (!directoryPath) {
    return;
  }
  const parts = directoryPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    try {
      pyodide.FS.mkdir(current);
    } catch (_error) {
      // Directory already exists in the virtual filesystem.
    }
  }
}


function pyodideCallListCalculators() {
  return JSON.parse(appState.pyodide.runPython(`
from webapp.registry import list_calculators_json
list_calculators_json()
`));
}


function pyodideCallGetSchema(calculatorId) {
  appState.pyodide.globals.set("_bridge_calculator_id", calculatorId);
  const output = appState.pyodide.runPython(`
from webapp.registry import get_calculator_schema_json
get_calculator_schema_json(_bridge_calculator_id)
`);
  appState.pyodide.globals.delete("_bridge_calculator_id");
  return JSON.parse(output);
}


function pyodideCallRunCalculator(calculatorId, calculatorState) {
  appState.pyodide.globals.set("_bridge_calculator_id", calculatorId);
  appState.pyodide.globals.set("_bridge_state_json", JSON.stringify(calculatorState));
  const output = appState.pyodide.runPython(`
from webapp.registry import run_calculator_json
run_calculator_json(_bridge_calculator_id, _bridge_state_json)
`);
  appState.pyodide.globals.delete("_bridge_calculator_id");
  appState.pyodide.globals.delete("_bridge_state_json");
  return JSON.parse(output);
}


async function initializeApplication() {
  try {
    await loadPyodideRuntime();
    appState.calculators = pyodideCallListCalculators();
    for (const calculator of appState.calculators) {
      const schema = pyodideCallGetSchema(calculator.id);
      appState.schemas.set(calculator.id, schema);
      appState.states.set(calculator.id, deepCopy(schema.default_state));
    }
    appState.activeCalculatorId = appState.calculators[0]?.id || null;
    renderApp();
    await recomputeActiveCalculator();
  } catch (error) {
    console.error(error);
    setStatus("Runtime failed", "error");
    showMessages([
      element("div", {
        className: "message error",
        text: `Failed to initialize the browser-side Python runtime: ${error.message}`,
      }),
    ]);
  }
}


async function recomputeActiveCalculator() {
  const calculatorId = appState.activeCalculatorId;
  if (!calculatorId || !appState.pyodide) {
    return;
  }
  setStatus("Running calculator...", "busy");
  try {
    const result = pyodideCallRunCalculator(calculatorId, getActiveState());
    appState.results.set(calculatorId, result);
    if (result.normalized_state) {
      appState.states.set(calculatorId, result.normalized_state);
    }
    ensureValidSelection();
    renderApp();
    setStatus("Python runtime ready");
  } catch (error) {
    console.error(error);
    appState.results.set(calculatorId, {
      ok: false,
      error: error.message,
      warnings: [],
      summary_cards: [],
      plot: { traces: [], elements: [], waist_marker: null, y_max_um: 200 },
      scene: { elements: [], gaps: [], total_length_mm: 0 },
    });
    renderApp();
    setStatus("Runtime error", "error");
  }
}


function renderTabs() {
  const nodes = appState.calculators.map((calculator) => {
    const button = element("button", {
      className: `tab${calculator.id === appState.activeCalculatorId ? " active" : ""}`,
      text: calculator.title,
      attrs: { type: "button" },
    });
    button.addEventListener("click", async () => {
      if (calculator.id === appState.activeCalculatorId) {
        return;
      }
      appState.activeCalculatorId = calculator.id;
      appState.selectedEntity = null;
      renderApp();
      if (!appState.results.has(calculator.id)) {
        await recomputeActiveCalculator();
      } else {
        setStatus("Python runtime ready");
      }
    });
    return button;
  });
  dom.tabs.replaceChildren(...nodes);
}


function renderField(field, value, onChange, calculatorState) {
  const wrapper = element("div", { className: "field" });
  const label = element("label", {
    className: "field-label",
    children: [
      element("span", { text: field.label }),
      element("span", { className: "field-unit", text: field.unit || "" }),
    ],
  });
  wrapper.append(label);

  if (field.type === "range_number") {
    const row = element("div", { className: "range-number" });
    const rangeInput = element("input", {
      attrs: {
        type: "range",
        min: field.min,
        max: field.max,
        step: field.step || 0.01,
        value,
      },
    });
    const numberInput = element("input", {
      attrs: {
        type: "number",
        min: field.min,
        max: field.max,
        step: field.step || 0.01,
        value,
      },
    });
    const syncValue = (rawValue) => {
      const nextValue = field.step >= 1 ? Number(rawValue) : Number(rawValue);
      rangeInput.value = String(nextValue);
      numberInput.value = String(nextValue);
      onChange(nextValue);
    };
    rangeInput.addEventListener("input", () => syncValue(rangeInput.value));
    numberInput.addEventListener("input", () => syncValue(numberInput.value));
    row.append(rangeInput, numberInput);
    wrapper.append(row);
    return wrapper;
  }

  if (field.type === "number") {
    const input = element("input", {
      attrs: {
        type: "number",
        step: field.step || 0.01,
        value,
      },
    });
    input.addEventListener("input", () => onChange(Number(input.value)));
    wrapper.append(input);
    return wrapper;
  }

  if (field.type === "text") {
    const input = element("input", {
      attrs: {
        type: "text",
        value: value || "",
      },
    });
    input.addEventListener("input", () => onChange(input.value));
    wrapper.append(input);
    return wrapper;
  }

  if (field.type === "select") {
    const select = element("select");
    const options = optionsForField(field, calculatorState);
    for (const option of options) {
      const optionNode = element("option", {
        text: option.label,
        attrs: { value: option.value },
      });
      if (option.value === value) {
        optionNode.selected = true;
      }
      select.append(optionNode);
    }
    select.addEventListener("change", () => onChange(select.value));
    wrapper.append(select);
    return wrapper;
  }

  return wrapper;
}


function renderGlobalControls() {
  const schema = getActiveSchema();
  const calculatorState = getActiveState();
  const nodes = (schema.global_fields || []).map((field) =>
    renderField(field, getValueByPath(calculatorState, field.path), (nextValue) => {
      updateGlobalField(field.path, nextValue);
    }, calculatorState)
  );
  dom.globalControls.replaceChildren(...nodes);
}


function renderSummary() {
  const result = getActiveResult();
  if (!result || !(result.summary_cards || []).length) {
    dom.summary.replaceChildren(element("p", {
      className: "empty-state",
      text: "Run a calculator to populate summary values.",
    }));
    return;
  }
  const cards = result.summary_cards.map((card) =>
    element("div", {
      className: "summary-card",
      children: [
        element("p", { className: "summary-label", text: card.label }),
        element("p", { className: "summary-value", text: card.value }),
      ],
    })
  );
  dom.summary.replaceChildren(...cards);
}


function renderInspector() {
  const schema = getActiveSchema();
  const calculatorState = getActiveState();
  if (!schema || schema.layout !== "optical_axis") {
    dom.inspectorPanel.style.display = "none";
    return;
  }

  dom.inspectorPanel.style.display = "";
  if (!appState.selectedEntity) {
    dom.inspector.replaceChildren(element("p", {
      className: "empty-state",
      text: "Select an element or a gap on the axis to edit its properties.",
    }));
    return;
  }

  if (appState.selectedEntity.type === "element") {
    const index = appState.selectedEntity.index;
    const item = calculatorState.elements[index];
    const fields = schema.element_forms[item.kind] || [];
    const header = element("div", {
      children: [
        element("p", { className: "summary-label", text: item.kind.replaceAll("_", " ") }),
        element("h3", { text: item.label }),
      ],
    });
    const deleteButton = element("button", {
      className: "delete-button",
      text: "Delete Element",
      attrs: { type: "button" },
    });
    deleteButton.addEventListener("click", () => deleteSelectedElement(index));
    const fieldNodes = fields.map((field) =>
      renderField(field, item[field.key], (nextValue) => {
        updateSelectedElementField(index, field.key, nextValue);
      }, calculatorState)
    );
    dom.inspector.replaceChildren(header, ...fieldNodes, deleteButton);
    return;
  }

  if (appState.selectedEntity.type === "gap") {
    const index = appState.selectedEntity.index;
    const item = calculatorState.gaps[index];
    const gapNodes = schema.gap_fields.map((field) =>
      renderField(field, item[field.key], (nextValue) => {
        updateSelectedGapField(index, field.key, nextValue);
      }, calculatorState)
    );
    dom.inspector.replaceChildren(
      element("div", {
        children: [
          element("p", { className: "summary-label", text: "gap" }),
          element("h3", { text: item.label }),
        ],
      }),
      ...gapNodes,
    );
  }
}


function attachDropHandlers(node, zoneIndex) {
  node.addEventListener("dragover", (event) => {
    event.preventDefault();
    node.classList.add("active");
  });
  node.addEventListener("dragleave", () => {
    node.classList.remove("active");
  });
  node.addEventListener("drop", (event) => {
    event.preventDefault();
    node.classList.remove("active");
    const payload = event.dataTransfer.getData("text/plain");
    if (!payload) {
      return;
    }
    const data = JSON.parse(payload);
    if (data.source === "palette") {
      insertElementAt(zoneIndex, data.kind);
    }
    if (data.source === "element") {
      moveElement(data.index, zoneIndex);
    }
  });
}


function createDropZone(zoneIndex, isEdge, calculatorState, labelText) {
  const zone = element("div", {
    className: "drop-zone",
    children: [
      element("div", { className: "edge-label", text: labelText || (isEdge ? "Drop here" : "Insert") }),
    ],
  });
  attachDropHandlers(zone, zoneIndex);
  return zone;
}


function renderAxisBuilder() {
  const schema = getActiveSchema();
  const calculatorState = getActiveState();
  if (!schema || schema.layout !== "optical_axis") {
    dom.builderPanel.style.display = "none";
    return;
  }
  dom.builderPanel.style.display = "";

  const paletteNodes = (schema.palette || []).map((item) => {
    const chip = element("div", {
      className: "palette-item",
      text: item.label,
      attrs: { draggable: "true" },
    });
    chip.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", JSON.stringify({
        source: "palette",
        kind: item.kind,
      }));
    });
    return chip;
  });

  const palette = element("div", {
    className: "palette",
    children: paletteNodes,
  });

  const track = element("div", { className: "axis-track" });
  const elements = calculatorState.elements || [];
  const gaps = calculatorState.gaps || [];

  if (!elements.length) {
    track.append(createDropZone(0, true, calculatorState, "Drag a component here"));
  } else {
    track.append(createDropZone(0, true, calculatorState, `Left n = ${formatNumber(calculatorState.globals.left_environment_n, 3)}`));
    elements.forEach((item, index) => {
      const card = element("div", {
        className: `element-card${appState.selectedEntity?.type === "element" && appState.selectedEntity.index === index ? " selected" : ""}`,
        attrs: { draggable: "true" },
        children: [
          element("div", { className: "element-label", text: item.label }),
          element("div", { className: "element-kind", text: item.kind.replaceAll("_", " ") }),
          element("div", {
            className: "badge-row",
            children: [
              ...(item.id === calculatorState.globals.cavity_left_id
                ? [element("span", { className: "badge endpoint", text: "Left endpoint" })]
                : []),
              ...(item.id === calculatorState.globals.cavity_right_id
                ? [element("span", { className: "badge endpoint", text: "Right endpoint" })]
                : []),
            ],
          }),
          element("div", {
            className: "element-props",
            children: summarizeElement(item).map((line) => element("div", { text: line })),
          }),
        ],
      });

      card.addEventListener("click", () => {
        appState.selectedEntity = { type: "element", index };
        renderApp();
      });

      card.addEventListener("dragstart", (event) => {
        card.classList.add("dragging");
        event.dataTransfer.setData("text/plain", JSON.stringify({
          source: "element",
          index,
        }));
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });

      track.append(card);

      if (index < elements.length - 1) {
        const gap = gaps[index];
        const gapCard = element("div", {
          className: `gap-card${appState.selectedEntity?.type === "gap" && appState.selectedEntity.index === index ? " selected" : ""}`,
          children: [
            element("div", { className: "gap-pill", text: `n = ${formatNumber(gap.refractive_index, 3)}` }),
            element("div", {
              className: "gap-core",
              children: [element("div", { className: "edge-label", text: gap.label })],
            }),
            element("div", { className: "gap-pill", text: `${formatNumber(gap.distance_mm, 2)} mm` }),
          ],
        });
        gapCard.addEventListener("click", () => {
          appState.selectedEntity = { type: "gap", index };
          renderApp();
        });
        attachDropHandlers(gapCard, index + 1);
        track.append(gapCard);
      } else {
        track.append(createDropZone(
          elements.length,
          true,
          calculatorState,
          `Right n = ${formatNumber(calculatorState.globals.right_environment_n, 3)}`,
        ));
      }
    });
  }

  dom.builder.replaceChildren(
    element("div", {
      className: "builder-layout",
      children: [
        palette,
        element("div", {
          className: "axis-shell",
          children: [track],
        }),
      ],
    })
  );
}


function summarizeElement(item) {
  const lines = [
    `R = ${formatNumber(item.reflection, 3)}`,
    `T = ${formatNumber(item.transmission, 3)}`,
  ];
  if (item.kind === "curved_surface") {
    lines.unshift(`ROC = ${formatNumber(item.radius_mm, 2)} mm`);
  }
  if (item.kind === "lens") {
    lines.unshift(`f = ${formatNumber(item.focal_length_mm, 2)} mm`);
  }
  return lines;
}


function renderMessages() {
  const result = getActiveResult();
  const messages = [];

  if (!result) {
    messages.push(element("div", {
      className: "message info",
      text: "The calculator will run after the Python runtime finishes loading.",
    }));
  } else {
    if (result.error) {
      messages.push(element("div", {
        className: "message error",
        text: result.error,
      }));
    }
    for (const warning of result.warnings || []) {
      messages.push(element("div", {
        className: "message warning",
        text: warning,
      }));
    }
    if (result.ok) {
      messages.push(element("div", {
        className: "message info",
        text: "Hover the mode envelope to read local spot size, waist radius, and waist position.",
      }));
    }
  }

  if (!messages.length) {
    messages.push(element("div", {
      className: "message info",
      text: "No messages.",
    }));
  }
  showMessages(messages);
}


function buildElementPlotTraces(plot, yMax) {
  const traces = [];
  const annotations = [];
  for (const item of plot.elements || []) {
    const topY = 0.93 * yMax;
    const labelY = 1.03 * yMax;
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
      traces.push({
        x: [item.position_mm - 0.9, item.position_mm, item.position_mm + 0.9, item.position_mm],
        y: [0.0, topY * 0.88, 0.0, -topY * 0.88],
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


function renderPlot() {
  const result = getActiveResult();
  const traces = [];
  const plot = result?.plot || { traces: [], elements: [], waist_marker: null, y_max_um: 200 };
  const yMax = plot.y_max_um || 200;

  for (const trace of plot.traces || []) {
    traces.push({
      x: trace.x_mm,
      y: trace.y_um,
      type: "scatter",
      mode: "lines",
      name: trace.name,
      text: trace.hover_text,
      hovertemplate: "%{text}<extra></extra>",
      line: { color: trace.color, width: 4, dash: trace.dash || "solid" },
    });
    traces.push({
      x: trace.x_mm,
      y: trace.y_um.map((value) => -value),
      type: "scatter",
      mode: "lines",
      showlegend: false,
      text: trace.hover_text,
      hovertemplate: "%{text}<extra></extra>",
      line: { color: trace.color, width: 4, dash: trace.dash || "solid" },
    });
  }

  const elementPlot = buildElementPlotTraces(plot, yMax);
  traces.push(...elementPlot.traces);

  if (plot.waist_marker) {
    traces.push({
      x: [plot.waist_marker.x_mm],
      y: [plot.waist_marker.y_um],
      type: "scatter",
      mode: "markers+text",
      text: [plot.waist_marker.label],
      textposition: "top center",
      marker: {
        color: "#000000",
        size: 11,
      },
      hovertemplate: "Waist<br>x = %{x:.3f} mm<extra></extra>",
      name: "Waist",
    });
  }

  const layout = {
    title: {
      text: getActiveSchema()?.title || "Calculator",
      font: { family: "Space Grotesk, sans-serif", size: 24, color: "#241f17" },
    },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,255,255,0.82)",
    margin: { t: 64, r: 24, b: 64, l: 72 },
    xaxis: {
      title: "Axis Position [mm]",
      zeroline: false,
      gridcolor: "rgba(36, 31, 23, 0.1)",
    },
    yaxis: {
      title: "Beam Radius [um]",
      range: [-1.18 * yMax, 1.18 * yMax],
      zeroline: false,
      gridcolor: "rgba(36, 31, 23, 0.1)",
    },
    hovermode: "closest",
    legend: {
      orientation: "h",
      x: 1,
      xanchor: "right",
      y: 1.12,
    },
    annotations: elementPlot.annotations,
    shapes: [
      {
        type: "line",
        x0: Math.min(...collectXCoordinates(plot), -10),
        x1: Math.max(...collectXCoordinates(plot), 10),
        y0: 0,
        y1: 0,
        line: { color: "rgba(36, 31, 23, 0.12)", width: 1 },
      },
    ],
  };

  Plotly.react(dom.plot, traces, layout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  });
}


function collectXCoordinates(plot) {
  const values = [];
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


function renderApp() {
  const schema = getActiveSchema();
  const calculator = appState.calculators.find((item) => item.id === appState.activeCalculatorId);

  renderTabs();

  if (!schema || !calculator) {
    return;
  }

  dom.calculatorTitle.textContent = calculator.title;
  dom.calculatorDescription.textContent = calculator.description;
  dom.builderHint.textContent =
    schema.layout === "optical_axis"
      ? "Drag components onto the axis, drag existing components onto any slot to reorder them, and click the gaps to edit spacing and medium."
      : "Adjust the control values to run the selected calculator in the browser-side Python runtime.";

  renderGlobalControls();
  renderInspector();
  renderSummary();
  renderAxisBuilder();
  renderMessages();
  renderPlot();
}


window.addEventListener("DOMContentLoaded", () => {
  void initializeApplication();
});
