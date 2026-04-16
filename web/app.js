import {
  deepCopy,
  element,
  getValueByPath,
  renderField,
  setValueByPath,
} from "./ui_common.js";
import { createCalculatorUiRegistry } from "./calculator_ui_registry.js";

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


function getActiveCalculator() {
  return appState.calculators.find((calculator) => calculator.id === appState.activeCalculatorId) || null;
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


const uiRegistry = createCalculatorUiRegistry({
  getState: getActiveState,
  getSchema: getActiveSchema,
  onCommit: (nextState) => commitState(nextState),
  onUpdateGlobal: updateGlobalField,
  onRerender: renderApp,
});


function getActiveUi() {
  return uiRegistry.resolve({
    calculator: getActiveCalculator(),
    schema: getActiveSchema(),
  });
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
    uiRegistry.clearTransientState();
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
    getActiveUi().syncState?.();
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
    getActiveUi().clearTransientState?.();
    renderApp();
    setStatus("Runtime error", "error");
  }
}


function renderTabs() {
  const nodes = appState.calculators.map((calculator) => {
    if (calculator.tab_url) {
      return element("a", {
        className: "tab",
        text: calculator.title,
        attrs: {
          href: calculator.tab_url,
          target: calculator.open_in_new_tab ? "_blank" : "_self",
          rel: calculator.open_in_new_tab ? "noreferrer" : undefined,
        },
      });
    }

    const button = element("button", {
      className: `tab${calculator.id === appState.activeCalculatorId ? " active" : ""}`,
      text: calculator.title,
      attrs: { type: "button" },
    });
    button.addEventListener("click", async () => {
      if (calculator.id === appState.activeCalculatorId) {
        return;
      }
      uiRegistry.clearTransientState();
      appState.activeCalculatorId = calculator.id;
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
  if (!schema || !calculatorState) {
    dom.globalControls.replaceChildren();
    return;
  }

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
  const calculator = getActiveCalculator();
  const schema = getActiveSchema();
  const result = getActiveResult();
  const ui = getActiveUi();
  const shellConfig = calculator && schema
    ? ui.getShellConfig({ calculator, result, schema })
    : null;
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
    if (result.ok && shellConfig) {
      messages.push(element("div", {
        className: "message info",
        text: shellConfig.successHint,
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


function clearBuilder() {
  dom.builderToolbar.replaceChildren();
  dom.builderToolbar.style.display = "none";
  dom.builder.replaceChildren();
  dom.builderPanel.style.display = "none";
}


function renderApp() {
  const calculator = getActiveCalculator();
  const schema = getActiveSchema();

  renderTabs();
  if (!calculator || !schema) {
    return;
  }

  const result = getActiveResult();
  const ui = getActiveUi();
  const shellConfig = ui.getShellConfig({ calculator, result, schema });

  dom.calculatorTitle.textContent = calculator.title;
  dom.calculatorDescription.textContent = calculator.description;
  dom.heroPanel.style.display = shellConfig.showHero ? "" : "none";
  dom.calculatorHeroCopy.style.display = shellConfig.showHero ? "" : "none";
  dom.plotSectionTitle.textContent = shellConfig.plotSectionTitle;
  dom.builderHint.textContent = shellConfig.builderHint;

  if (shellConfig.showHero) {
    renderGlobalControls();
  } else {
    dom.globalControls.replaceChildren();
  }

  renderSummary();
  ui.renderPlot({
    calculator,
    plotHost: dom.plot,
    readoutHost: dom.plotReadout,
    result,
    schema,
  });

  if (shellConfig.showBuilder) {
    dom.builderPanel.style.display = "";
    ui.renderBuilder({
      builderContainer: dom.builder,
      builderPanel: dom.builderPanel,
      builderToolbar: dom.builderToolbar,
      calculator,
      result,
      schema,
    });
  } else {
    clearBuilder();
  }

  renderPlotMetrics();
  renderMessages();
}


window.addEventListener("DOMContentLoaded", () => {
  void initializeApplication();
});
