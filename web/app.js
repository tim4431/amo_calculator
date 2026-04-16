import {
  clamp,
  deepCopy,
  element,
  formatNumber,
  getValueByPath,
  hexToRgba,
  linspace,
  renderField,
  setValueByPath,
} from "./ui_common.js";
import {
  buildElementPlotTraces,
  createOpticalAxisController,
} from "./cavity_mode_ui.js";

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";


async function fetchPythonManifest() {
  const response = await fetch("python_manifest.json");
  if (!response.ok) {
    throw new Error(`Failed to fetch python_manifest.json: ${response.status}`);
  }
  const manifest = await response.json();
  return manifest.python_files;
}

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
  plotPointerMoveHandler: null,
  plotPointerLeaveHandler: null,
  activeModeOverlayIndices: null,
};

const dom = {
  runtimeStatus: document.getElementById("runtime-status"),
  tabs: document.getElementById("tabs"),
  heroPanel: document.getElementById("hero-panel"),
  calculatorHeroCopy: document.getElementById("calculator-hero-copy"),
  calculatorTitle: document.getElementById("calculator-title"),
  calculatorDescription: document.getElementById("calculator-description"),
  globalControls: document.getElementById("global-controls"),
  summary: document.getElementById("summary"),
  builderPanel: document.getElementById("builder-panel"),
  builderToolbar: document.getElementById("builder-toolbar"),
  builder: document.getElementById("builder"),
  builderHint: document.getElementById("builder-hint"),
  plot: document.getElementById("plot"),
  plotSectionTitle: document.getElementById("plot-section-title"),
  plotReadout: document.getElementById("plot-readout"),
  plotMetrics: document.getElementById("plot-metrics"),
  messages: document.getElementById("messages"),
};


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


function commitState(nextState, { rerender = true, recompute = true } = {}) {
  appState.states.set(appState.activeCalculatorId, nextState);
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


const axisController = createOpticalAxisController({
  getState: getActiveState,
  getSchema: getActiveSchema,
  onCommit: (nextState) => commitState(nextState),
  onUpdateGlobal: updateGlobalField,
  onRerender: renderApp,
});


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
  setStatus("Loading numpy and scipy...", "busy");
  await pyodide.loadPackage(["numpy", "scipy"]);

  const pythonFiles = await fetchPythonManifest();
  for (const relativePath of pythonFiles) {
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
from app.registry import list_calculators_json
list_calculators_json()
`));
}


function pyodideCallGetSchema(calculatorId) {
  appState.pyodide.globals.set("_bridge_calculator_id", calculatorId);
  const output = appState.pyodide.runPython(`
from app.registry import get_calculator_schema_json
get_calculator_schema_json(_bridge_calculator_id)
`);
  appState.pyodide.globals.delete("_bridge_calculator_id");
  return JSON.parse(output);
}


function pyodideCallRunCalculator(calculatorId, calculatorState) {
  appState.pyodide.globals.set("_bridge_calculator_id", calculatorId);
  appState.pyodide.globals.set("_bridge_state_json", JSON.stringify(calculatorState));
  const output = appState.pyodide.runPython(`
from app.registry import run_calculator_json
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
    axisController.ensureValidSelection();
    renderApp();
    setStatus("Python runtime ready");
  } catch (error) {
    console.error(error);
    appState.results.set(calculatorId, {
      ok: false,
      error: error.message,
      warnings: [],
      summary_cards: [],
      plot_metrics: [],
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
      axisController.clearEditor();
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


function renderPlotMetrics() {
  const result = getActiveResult();
  const metrics = (result && result.plot_metrics) || [];
  if (!metrics.length) {
    dom.plotMetrics.replaceChildren();
    dom.plotMetrics.style.display = "none";
    return;
  }

  const cards = metrics.map((card) =>
    element("div", {
      className: "summary-card plot-metric-card",
      children: [
        element("p", { className: "summary-label", text: card.label }),
        element("p", { className: "summary-value", text: card.value }),
      ],
    })
  );
  dom.plotMetrics.replaceChildren(...cards);
  dom.plotMetrics.style.display = "";
}






function renderMessages() {
  const schema = getActiveSchema();
  const calculator = appState.calculators.find((item) => item.id === appState.activeCalculatorId);
  const layoutConfig = schema && calculator ? getLayoutConfig(schema.layout, calculator.title) : null;
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
    if (result.ok && layoutConfig) {
      messages.push(element("div", {
        className: "message info",
        text: layoutConfig.successHint,
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
  const xBounds = plotXBounds(plot);
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
    shapes: buildBaseShapes(plot, yMax),
    uirevision: `plot-${(schema && schema.id) || "calculator"}`,
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


function getLayoutConfig(layout, calculatorTitle) {
  if (layout === "optical_axis") {
    return {
      showHero: false,
      plotSectionTitle: "Cavity mode",
      builderHint: "Drag components onto the axis, drop onto other elements to swap them, edit parameters directly in place, and move across the plot to inspect the active interval.",
      successHint: "Edit element, gap, and boundary parameters directly in place. Move anywhere across the plot to inspect the active interval and its local Gaussian-beam data.",
      hasAxisBuilder: true,
    };
  }
  return {
    showHero: true,
    plotSectionTitle: calculatorTitle,
    builderHint: "Adjust the control values to run the selected calculator in the browser-side Python runtime.",
    successHint: "Calculator ran successfully.",
    hasAxisBuilder: false,
  };
}


function renderApp() {
  const schema = getActiveSchema();
  const calculator = appState.calculators.find((item) => item.id === appState.activeCalculatorId);
  renderTabs();

  if (!schema || !calculator) {
    return;
  }

  const layoutConfig = getLayoutConfig(schema.layout, calculator.title);
  dom.calculatorTitle.textContent = calculator.title;
  dom.calculatorDescription.textContent = calculator.description;
  dom.heroPanel.style.display = layoutConfig.showHero ? "" : "none";
  dom.calculatorHeroCopy.style.display = layoutConfig.showHero ? "" : "none";
  dom.plotSectionTitle.textContent = layoutConfig.plotSectionTitle;
  dom.builderHint.textContent = layoutConfig.builderHint;

  renderGlobalControls();
  renderSummary();
  renderPlot();
  if (layoutConfig.hasAxisBuilder) {
    dom.builderPanel.style.display = "";
    axisController.renderBuilderToolbar(dom.builderToolbar);
    axisController.renderAxisBuilder(dom.builderPanel, dom.builder);
  } else {
    dom.builderToolbar.replaceChildren();
    dom.builderToolbar.style.display = "none";
    dom.builderPanel.style.display = "none";
  }
  renderPlotMetrics();
  renderMessages();
}


window.addEventListener("DOMContentLoaded", () => {
  void initializeApplication();
});
