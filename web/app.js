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
  computeTimer: null,
  plotTraceMeta: [],
  currentHoverSegmentId: null,
  inlinePropertyEditor: null,
  plotPointerMoveHandler: null,
  plotPointerLeaveHandler: null,
  activeModeOverlayIndices: null,
};

const dom = {
  runtimeStatus: document.getElementById("runtime-status"),
  tabs: document.getElementById("tabs"),
  calculatorTitle: document.getElementById("calculator-title"),
  calculatorDescription: document.getElementById("calculator-description"),
  globalControls: document.getElementById("global-controls"),
  summary: document.getElementById("summary"),
  builderPanel: document.getElementById("builder-panel"),
  builder: document.getElementById("builder"),
  builderHint: document.getElementById("builder-hint"),
  plot: document.getElementById("plot"),
  plotReadout: document.getElementById("plot-readout"),
  messages: document.getElementById("messages"),
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


function formatCompactNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  const rounded = Number(number.toFixed(digits));
  return String(rounded);
}


function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}


function hexToRgba(hexColor, alpha) {
  const hex = hexColor.replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((part) => part + part).join("")
    : hex;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}


function clearInlinePropertyEditor() {
  appState.inlinePropertyEditor = null;
}


function setElementFieldValue(item, key, value) {
  if (key === "reflection") {
    const reflection = clamp(Number(value), 0, 1);
    item.reflection = reflection;
    return;
  }
  if (key === "transmission") {
    const transmission = clamp(Number(value), 0, 1);
    item.reflection = Number((1 - transmission).toFixed(12));
    return;
  }
  item[key] = value;
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
  };
  if (kind === "curved_surface") {
    base.radius_mm = 50.0;
  }
  if (kind === "lens") {
    base.focal_length_mm = 50.0;
  }
  return base;
}


function defaultGap(labelIndex, refractiveIndex = 1.0, distanceMm = 20.0) {
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
  const current = Array.isArray(state.globals.endpoint_ids) ? state.globals.endpoint_ids : [];
  const normalized = [];
  for (const value of current) {
    if (ids.includes(value) && !normalized.includes(value)) {
      normalized.push(value);
    }
  }
  state.globals.endpoint_ids = normalized.slice(-2);
}


function ensureValidSelection() {
  const calculatorState = getActiveState();
  if (!calculatorState) {
    clearInlinePropertyEditor();
    return;
  }

  if (
    appState.inlinePropertyEditor &&
    (
      (
        appState.inlinePropertyEditor.entityType === "element" &&
        (
          appState.inlinePropertyEditor.index >= calculatorState.elements.length ||
          !calculatorState.elements[appState.inlinePropertyEditor.index] ||
          calculatorState.elements[appState.inlinePropertyEditor.index].kind !== appState.inlinePropertyEditor.kind
        )
      ) ||
      (
        appState.inlinePropertyEditor.entityType === "gap" &&
        appState.inlinePropertyEditor.index >= calculatorState.gaps.length
      ) ||
      (
        appState.inlinePropertyEditor.entityType === "environment" &&
        !["left", "right"].includes(appState.inlinePropertyEditor.side)
      )
    )
  ) {
    clearInlinePropertyEditor();
  }
}


function commitState(nextState, { rerender = true, recompute = true } = {}) {
  reconcileEndpoints(nextState);
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
  commitState(nextState);
}


function updateElementField(index, key, value) {
  const nextState = deepCopy(getActiveState());
  setElementFieldValue(nextState.elements[index], key, value);
  commitState(nextState);
}


function updateGapField(index, key, value) {
  const nextState = deepCopy(getActiveState());
  nextState.gaps[index][key] = value;
  commitState(nextState);
}


function updateEnvironmentField(side, key, value) {
  const nextState = deepCopy(getActiveState());
  const globalKey = side === "left" ? "left_environment_n" : "right_environment_n";
  if (key === "refractive_index") {
    nextState.globals[globalKey] = value;
  }
  commitState(nextState);
}


function toggleEndpoint(index) {
  const nextState = deepCopy(getActiveState());
  const element = nextState.elements[index];
  const elementId = element ? element.id : null;
  if (!elementId) {
    return;
  }

  const endpoints = Array.isArray(nextState.globals.endpoint_ids)
    ? [...nextState.globals.endpoint_ids]
    : [];
  const existingIndex = endpoints.indexOf(elementId);
  if (existingIndex >= 0) {
    endpoints.splice(existingIndex, 1);
  } else {
    if (endpoints.length >= 2) {
      endpoints.shift();
    }
    endpoints.push(elementId);
  }
  nextState.globals.endpoint_ids = endpoints;
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
    nextState.gaps.splice(0, 0, defaultGap(1, nextState.globals.left_environment_n));
  } else if (zoneIndex === elementCount) {
    nextState.elements.push(item);
    nextState.gaps.push(defaultGap(nextState.gaps.length + 1, nextState.globals.right_environment_n));
  } else {
    const oldGap = nextState.gaps[zoneIndex - 1] || defaultGap(zoneIndex);
    const firstDistance = Math.max(0.1, Number(oldGap.distance_mm) / 2);
    const secondDistance = Math.max(0.1, Number(oldGap.distance_mm) - firstDistance);
    nextState.elements.splice(zoneIndex, 0, item);
    nextState.gaps.splice(zoneIndex - 1, 1, {
      label: oldGap.label,
      refractive_index: oldGap.refractive_index,
      distance_mm: firstDistance,
    }, {
      label: oldGap.label,
      refractive_index: oldGap.refractive_index,
      distance_mm: secondDistance,
    });
  }

  renumberGapLabels(nextState);
  clearInlinePropertyEditor();
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
  clearInlinePropertyEditor();
  commitState(nextState);
}


function swapElements(sourceIndex, targetIndex) {
  const nextState = deepCopy(getActiveState());
  if (
    sourceIndex < 0 ||
    sourceIndex >= nextState.elements.length ||
    targetIndex < 0 ||
    targetIndex >= nextState.elements.length ||
    sourceIndex === targetIndex
  ) {
    return;
  }
  const temp = nextState.elements[sourceIndex];
  nextState.elements[sourceIndex] = nextState.elements[targetIndex];
  nextState.elements[targetIndex] = temp;
  clearInlinePropertyEditor();
  commitState(nextState);
}


function deleteElement(index) {
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
  clearInlinePropertyEditor();
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
    appState.activeCalculatorId = appState.calculators.length ? appState.calculators[0].id : null;
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
      plot: { traces: [], segments: [], elements: [], waist_marker: null, y_max_um: 200 },
      scene: { elements: [], gaps: [], environments: [], total_length_mm: 0 },
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
      clearInlinePropertyEditor();
      appState.currentHoverSegmentId = null;
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
      const nextValue = Number(rawValue);
      rangeInput.value = String(nextValue);
      numberInput.value = String(nextValue);
      onChange(nextValue);
    };
    rangeInput.addEventListener("input", () => syncValue(rangeInput.value));
    numberInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        numberInput.blur();
      }
    });
    numberInput.addEventListener("change", () => syncValue(numberInput.value));
    numberInput.addEventListener("blur", () => syncValue(numberInput.value));
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
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
      }
    });
    input.addEventListener("change", () => onChange(Number(input.value)));
    input.addEventListener("blur", () => onChange(Number(input.value)));
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
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
      }
    });
    input.addEventListener("change", () => onChange(input.value));
    input.addEventListener("blur", () => onChange(input.value));
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
    renderField(
      field,
      getValueByPath(calculatorState, field.path),
      (nextValue) => updateGlobalField(field.path, nextValue),
      calculatorState,
    )
  );
  dom.globalControls.replaceChildren(...nodes);
}


function renderSummary() {
  const result = getActiveResult();
  if (!result || !(result.summary_cards || []).length) {
    dom.summary.replaceChildren(
      element("p", {
        className: "empty-state",
        text: "Run a calculator to populate summary values.",
      }),
    );
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


function elementPropertyDescriptors(item) {
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


function gapPropertyDescriptors() {
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


function environmentPropertyDescriptors() {
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
  ];
}


function inlineEditorMatches(editorState) {
  return Boolean(
    appState.inlinePropertyEditor &&
    Object.entries(editorState).every(([key, value]) => appState.inlinePropertyEditor[key] === value)
  );
}


function openInlinePropertyEditor(editorState) {
  appState.inlinePropertyEditor = editorState;
  renderApp();
}


function closeInlinePropertyEditor({ rerender = false } = {}) {
  clearInlinePropertyEditor();
  if (rerender) {
    renderApp();
  }
}


function commitInlinePropertyEditor(rawValue, descriptor, onCommit) {
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    closeInlinePropertyEditor({ rerender: true });
    return;
  }

  let nextValue = parsedValue;
  if (descriptor.minimum !== undefined) {
    nextValue = Math.max(descriptor.minimum, nextValue);
  }
  if (descriptor.maximum !== undefined) {
    nextValue = Math.min(descriptor.maximum, nextValue);
  }
  closeInlinePropertyEditor();
  onCommit(nextValue);
}


function attachZoneDropHandlers(node, zoneIndex) {
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


function attachElementSwapHandlers(node, index) {
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
    if (data.source === "element") {
      swapElements(data.index, index);
    }
    if (data.source === "palette") {
      insertElementAt(index, data.kind);
    }
  });
}


function createEnvironmentCard(side, calculatorState) {
  const refractiveIndex = side === "left"
    ? calculatorState.globals.left_environment_n
    : calculatorState.globals.right_environment_n;
  const node = element("div", {
    className: "environment-card gap-card",
    children: [
      createInlinePropertyNode({
        editorState: {
          entityType: "environment",
          side,
          key: "refractive_index",
        },
        descriptor: environmentPropertyDescriptors()[0],
        value: refractiveIndex,
        onCommit: (nextValue) => updateEnvironmentField(side, "refractive_index", nextValue),
        buttonClassName: "gap-pill gap-prop-button",
        editorClassName: "gap-pill gap-prop-editor",
      }),
      element("div", {
        className: "gap-core",
        children: [element("div", { className: "edge-label", text: side === "left" ? "Left boundary" : "Right boundary" })],
      }),
      element("div", { className: "gap-pill", text: side === "left" ? "Insert at start" : "Insert at end" }),
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
        editorState: {
          entityType: "gap",
          index,
          key: "refractive_index",
        },
        descriptor: indexDescriptor,
        value: gap.refractive_index,
        onCommit: (nextValue) => updateGapField(index, "refractive_index", nextValue),
        buttonClassName: "gap-pill gap-prop-button",
        editorClassName: "gap-pill gap-prop-editor",
      }),
      element("div", {
        className: "gap-core",
        children: [element("div", { className: "edge-label", text: gap.label })],
      }),
      createInlinePropertyNode({
        editorState: {
          entityType: "gap",
          index,
          key: "distance_mm",
        },
        descriptor: distanceDescriptor,
        value: gap.distance_mm,
        onCommit: (nextValue) => updateGapField(index, "distance_mm", nextValue),
        buttonClassName: "gap-pill gap-prop-button",
        editorClassName: "gap-pill gap-prop-editor",
      }),
    ],
  });
  attachZoneDropHandlers(node, index + 1);
  return node;
}


function formatInlinePropertyValue(value, descriptor) {
  const formatted = formatCompactNumber(value, descriptor.digits || 3);
  return descriptor.suffix ? `${formatted} ${descriptor.suffix}` : formatted;
}


function createInlinePropertyDisplay({ editorState, descriptor, value, onOpen, className = "element-prop-button" }) {
  const propertyButton = element("button", {
    className,
    attrs: { type: "button", draggable: "false" },
    children: [
      element("span", { className: "element-prop-label", text: `${descriptor.label} =` }),
      element("span", {
        className: "element-prop-value",
        text: formatInlinePropertyValue(value, descriptor),
      }),
    ],
  });
  propertyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpen(editorState);
  });
  propertyButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  propertyButton.addEventListener("dragstart", (event) => event.preventDefault());
  return propertyButton;
}


function createInlinePropertyEditor({ editorState, descriptor, value, onCommit, className = "element-prop-editor" }) {
  const editor = element("div", {
    className,
    attrs: { tabindex: "-1" },
  });
  const label = element("span", { className: "element-prop-label", text: `${descriptor.label} =` });
  const input = element("input", {
    className: "element-prop-input",
    attrs: {
      type: "number",
      step: descriptor.step || 0.01,
      value: formatCompactNumber(value, 6),
      min: descriptor.minimum,
      max: descriptor.maximum,
    },
  });

  const commit = () => {
    commitInlinePropertyEditor(input.value, descriptor, onCommit);
  };

  const cancel = () => {
    closeInlinePropertyEditor({ rerender: true });
  };

  editor.append(label, input);
  if (descriptor.suffix) {
    editor.append(element("span", { className: "element-prop-suffix", text: descriptor.suffix }));
  }
  editor.addEventListener("click", (event) => event.stopPropagation());
  editor.addEventListener("pointerdown", (event) => event.stopPropagation());
  editor.addEventListener("dragstart", (event) => event.preventDefault());
  editor.addEventListener("focusout", (event) => {
    if (event.relatedTarget && editor.contains(event.relatedTarget)) {
      return;
    }
    commit();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("dragstart", (event) => event.preventDefault());

  window.requestAnimationFrame(() => {
    input.focus();
    input.select();
  });

  return editor;
}


function createInlinePropertyNode({ editorState, descriptor, value, onCommit, buttonClassName, editorClassName }) {
  if (inlineEditorMatches(editorState)) {
    return createInlinePropertyEditor({
      editorState,
      descriptor,
      value,
      onCommit,
      className: editorClassName || "element-prop-editor",
    });
  }
  return createInlinePropertyDisplay({
    editorState,
    descriptor,
    value,
    onOpen: openInlinePropertyEditor,
    className: buttonClassName || "element-prop-button",
  });
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
  titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      titleInput.blur();
    }
  });
  titleInput.addEventListener("change", () => {
    const nextLabel = titleInput.value.trim() || item.label;
    updateElementField(index, "label", nextLabel);
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
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteElement(index);
  });
  deleteButton.addEventListener("dragstart", (event) => event.preventDefault());

  const endpointButton = element("button", {
    className: `endpoint-button${endpoints.includes(item.id) ? " active" : ""}`,
    text: endpoints.includes(item.id) ? "Endpoint" : "Set endpoint",
    attrs: { type: "button" },
  });
  endpointButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleEndpoint(index);
  });
  endpointButton.addEventListener("dragstart", (event) => event.preventDefault());

  const node = element("div", {
    className: "element-card",
    attrs: { draggable: "true" },
    children: [
      element("div", {
        className: "element-header",
        children: [titleInput, deleteButton],
      }),
      element("div", { className: "element-kind", text: item.kind.replaceAll("_", " ") }),
      element("div", {
        className: "element-props",
        children: elementPropertyDescriptors(item).map((descriptor) =>
          createInlinePropertyNode({
            editorState: {
              entityType: "element",
              index,
              key: descriptor.key,
              kind: item.kind,
            },
            descriptor: {
              ...descriptor,
              kind: descriptor.kind === "length" ? "length_mm" : descriptor.kind,
              minimum: descriptor.min,
              maximum: descriptor.max,
              suffix: descriptor.kind === "length" ? "mm" : "",
            },
            value: descriptor.key === "transmission" ? transmission : item[descriptor.key],
            onCommit: (nextValue) => updateElementField(index, descriptor.key, nextValue),
          })
        ),
      }),
      element("div", {
        className: "element-footer",
        children: [endpointButton],
      }),
    ],
  });

  node.addEventListener("dragstart", (event) => {
    node.classList.add("dragging");
    event.dataTransfer.setData("text/plain", JSON.stringify({
      source: "element",
      index,
    }));
  });
  node.addEventListener("dragend", () => {
    node.classList.remove("dragging");
  });

  attachElementSwapHandlers(node, index);
  return node;
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

  const axisShell = element("div", { className: "axis-shell" });
  const track = element("div", { className: "axis-track" });

  if (!calculatorState.elements.length) {
    const emptyDrop = element("div", {
      className: "empty-drop-target",
      children: [
        element("div", {
          html: "<strong>Drag a component here</strong><br>Start by dropping a surface or lens onto the optical axis.",
        }),
      ],
    });
    attachZoneDropHandlers(emptyDrop, 0);
    track.append(emptyDrop);
  } else {
    track.append(createEnvironmentCard("left", calculatorState));
    calculatorState.elements.forEach((item, index) => {
      track.append(createElementCard(item, index, calculatorState));
      if (index < calculatorState.gaps.length) {
        track.append(createGapCard(calculatorState.gaps[index], index));
      }
    });
    track.append(createEnvironmentCard("right", calculatorState));
  }

  axisShell.append(track);
  dom.builder.replaceChildren(
    element("div", {
      className: "builder-layout",
      children: [palette, axisShell],
    })
  );
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
        text: "Edit element, gap, and boundary parameters directly in place. Move anywhere across the plot to inspect the active interval and its local Gaussian-beam data.",
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


function buildElementPlotTraces(plot, yMax) {
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
      body: "A vertical cursor will follow your mouse anywhere inside the plotting area. The active interval will show its local Gaussian mode as a solid segment, with dashed continuation outside that interval and a waist marker when visible.",
    };
  }
  if (result && result.error) {
    return {
      title: "Waiting for a valid cavity",
      body: result.error,
    };
  }
  return {
    title: "Hover the plot",
    body: "Move over the plotted beam envelope to inspect the current cross-section.",
  };
}


function setPlotReadout(content) {
  dom.plotReadout.replaceChildren(
    element("p", { className: "plot-readout-title", text: content.title }),
    element("p", { className: "plot-readout-body", html: content.body }),
  );
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


function updateActiveModeOverlay(plot, segment) {
  if (!(appState.activeModeOverlayIndices && dom.plot)) {
    return;
  }

  if (!segment) {
    const empty = [[], [], [], [], [], [], [], []];
    Plotly.restyle(dom.plot, { x: empty, y: empty, text: [[], [], [], [], [], [], [], []] }, appState.activeModeOverlayIndices);
    return;
  }

  const overlay = sampleLocalModeOverlay(plot, segment);
  const fillX = [...overlay.insideX, ...[...overlay.insideX].reverse()];
  const fillY = [...overlay.insideY, ...[...overlay.insideY].reverse().map((value) => -value)];
  const waistLabel = `x0 = ${formatNumber(segment.waist_position_mm, 3)} mm<br>w = ${formatNumber(segment.waist_radius_um, 3)} um`;
  const waistX = overlay.waistInBounds ? [segment.waist_position_mm] : [];
  const waistY = overlay.waistInBounds ? [0] : [];
  const waistText = overlay.waistInBounds ? [waistLabel] : [];

  Plotly.restyle(dom.plot, {
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
  }, appState.activeModeOverlayIndices);
}


function buildCursorOnlyReadout(xValue) {
  return {
    title: "No beam segment at this x",
    body:
      `x = <strong>${formatNumber(xValue, 3)} mm</strong><br>` +
      "Move the cursor onto an interval that contains a propagated beam segment to inspect its local mode data.",
  };
}


function buildBaseShapes(plot, yMax) {
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


function restyleBeamTraces(segmentId = null) {
  if (!appState.plotTraceMeta.length) {
    return;
  }
  const opacities = appState.plotTraceMeta.map((meta) => {
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
  const dashes = appState.plotTraceMeta.map((meta) => {
    if (meta.kind !== "beam-line") {
      return meta.baseDash || "solid";
    }
    return meta.baseDash || "solid";
  });
  const widths = appState.plotTraceMeta.map((meta) => {
    if (meta.kind !== "beam-line") {
      return meta.baseWidth || 3;
    }
    if (!segmentId) {
      return 4;
    }
    return 3.0;
  });
  Plotly.restyle(dom.plot, {
    opacity: opacities,
    "line.dash": dashes,
    "line.width": widths,
  });
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


function getPlotPointerState(event) {
  if (!(dom.plot && dom.plot._fullLayout && dom.plot._fullLayout.xaxis && dom.plot._fullLayout.yaxis)) {
    return null;
  }

  const rect = dom.plot.getBoundingClientRect();
  const xPixel = event.clientX - rect.left;
  const xaxis = dom.plot._fullLayout.xaxis;
  const xOffset = xaxis._offset || 0;
  const xLength = xaxis._length || 0;
  const clampedPixel = clamp(xPixel, xOffset, xOffset + xLength);

  return {
    xValue: xaxis.p2l(clampedPixel - xOffset),
  };
}


function applyPlotCursor(plot, result, xValue) {
  if (!(plot.segments && plot.segments.length)) {
    return;
  }

  const segment = findSegmentAtX(plot, xValue, appState.currentHoverSegmentId);
  const activeSegmentId = segment ? segment.id : null;
  appState.currentHoverSegmentId = activeSegmentId;
  restyleBeamTraces(activeSegmentId);
  updateActiveModeOverlay(plot, segment);
  setPlotReadout(segment ? buildHoverReadout(segment, xValue) : buildCursorOnlyReadout(xValue));
  Plotly.relayout(dom.plot, {
    shapes: [
      ...buildBaseShapes(plot, plot.y_max_um),
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


function clearPlotHover(plot, result) {
  appState.currentHoverSegmentId = null;
  restyleBeamTraces(null);
  updateActiveModeOverlay(plot, null);
  setPlotReadout(defaultPlotReadout(plot, result));
  Plotly.relayout(dom.plot, {
    shapes: buildBaseShapes(plot, plot.y_max_um),
  });
}


function renderPlot() {
  const schema = getActiveSchema();
  const result = getActiveResult();
  const plot = (result && result.plot) || { traces: [], segments: [], elements: [], waist_marker: null, y_max_um: 200 };
  const yMax = plot.y_max_um || 200;
  const traces = [];
  const traceMeta = [];

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

  const activeModeOverlayIndices = [];
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
    activeModeOverlayIndices.push(traces.length);
    traces.push(trace);
    traceMeta.push({ kind: "overlay", segmentId: null, baseDash: trace.line ? trace.line.dash || "solid" : "solid", baseWidth: trace.line ? trace.line.width || 0 : 0 });
  }

  const elementPlot = buildElementPlotTraces(plot, yMax);
  for (const trace of elementPlot.traces) {
    traces.push(trace);
    traceMeta.push({ kind: "decoration", segmentId: null, baseDash: "solid", baseWidth: 3 });
  }

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

  const layout = {
    title: {
      text: (schema && schema.title) || "Calculator",
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
    hovermode: false,
    hoverdistance: -1,
    legend: {
      orientation: "h",
      x: 1,
      xanchor: "right",
      y: 1.12,
    },
    annotations: elementPlot.annotations,
    shapes: buildBaseShapes(plot, yMax),
  };

  appState.plotTraceMeta = traceMeta;
  appState.activeModeOverlayIndices = activeModeOverlayIndices;
  Plotly.react(dom.plot, traces, layout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  });

  if (typeof dom.plot.removeAllListeners === "function") {
    dom.plot.removeAllListeners("plotly_hover");
    dom.plot.removeAllListeners("plotly_unhover");
  }

  if (appState.plotPointerMoveHandler) {
    dom.plot.removeEventListener("mousemove", appState.plotPointerMoveHandler);
  }
  if (appState.plotPointerLeaveHandler) {
    dom.plot.removeEventListener("mouseleave", appState.plotPointerLeaveHandler);
  }

  appState.plotPointerMoveHandler = (event) => {
    const pointerState = getPlotPointerState(event);
    if (!pointerState) {
      return;
    }
    applyPlotCursor(plot, result, pointerState.xValue);
  };
  appState.plotPointerLeaveHandler = () => {
    if (!(plot.segments && plot.segments.length)) {
      return;
    }
    clearPlotHover(plot, result);
  };

  dom.plot.addEventListener("mousemove", appState.plotPointerMoveHandler);
  dom.plot.addEventListener("mouseleave", appState.plotPointerLeaveHandler);

  setPlotReadout(defaultPlotReadout(plot, result));
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
      ? "Drag components onto the axis, drop onto other elements to swap them, rename components at the title, edit all optics and gap parameters directly in place, and move across the plot to inspect the active interval."
      : "Adjust the control values to run the selected calculator in the browser-side Python runtime.";

  renderGlobalControls();
  renderSummary();
  renderAxisBuilder();
  renderPlot();
  renderMessages();
}


window.addEventListener("DOMContentLoaded", () => {
  void initializeApplication();
});
