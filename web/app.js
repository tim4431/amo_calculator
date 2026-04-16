// Application shell.
//
// The shell owns only the topbar, the tab nav, and the blank `<main>`
// workspace. It knows nothing about what a calculator renders — each tab
// module is handed the workspace element and mounts whatever panels it
// needs (see web/panels.js for reusable panel factories).
//
// Lifecycle per active tab:
//   factory -> tabModule       created once per tab, kept in memory
//   mount(workspace, services) called on tab activation, returns instance
//   instance.update(ctx)       called after each state/result change
//   instance.unmount()         called before switching away from the tab

import { deepCopy, element, setValueByPath } from "./ui_common.js";
import { TAB_REGISTRY, defaultTabId } from "./tabs.js";

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const COMPUTE_DEBOUNCE_MS = 160;


const appState = {
  pyodide: null,
  pyodideReady: null,
  pythonManifest: null,
  loadedPythonFiles: new Set(),
  // Per-tab registry entries keyed by id.
  tabs: new Map(),
  // Per-tab materialized factory output (createTab()).
  tabModules: new Map(),
  // Per-tab schemas, states, results.
  schemas: new Map(),
  states: new Map(),
  results: new Map(),
  activeTabId: null,
  activeInstance: null,
  computeTimer: null,
};

const dom = {
  runtimeStatus: document.getElementById("runtime-status"),
  tabs: document.getElementById("tabs"),
  workspace: document.getElementById("workspace"),
};


function setStatus(message, kind = "") {
  dom.runtimeStatus.textContent = message;
  dom.runtimeStatus.className = `status-pill${kind ? ` ${kind}` : ""}`;
}


function tabEntry(tabId) {
  return appState.tabs.get(tabId) || null;
}


function isPythonTab(tabId) {
  return tabEntry(tabId)?.source === "python";
}


function tabModule(tabId) {
  let module = appState.tabModules.get(tabId);
  if (!module) {
    const entry = tabEntry(tabId);
    if (!entry) return null;
    module = entry.createTab({ id: entry.id, title: entry.title });
    appState.tabModules.set(tabId, module);
  }
  return module;
}


function servicesFor(tabId) {
  return {
    getCalculator: () => buildCalculatorManifest(tabId),
    getSchema: () => appState.schemas.get(tabId) || null,
    getState: () => appState.states.get(tabId) || null,
    getResult: () => appState.results.get(tabId) || null,
    commitState: (nextState, options = {}) => {
      appState.states.set(tabId, nextState);
      if (options.rerender !== false) {
        renderActive();
      }
      if (options.recompute !== false && isPythonTab(tabId)) {
        scheduleCompute();
      }
    },
    updateGlobal: (path, value) => {
      const current = appState.states.get(tabId);
      const next = current ? deepCopy(current) : {};
      setValueByPath(next, path, value);
      appState.states.set(tabId, next);
      renderActive();
      if (isPythonTab(tabId)) scheduleCompute();
    },
    rerender: renderActive,
  };
}


function buildCalculatorManifest(tabId) {
  const entry = tabEntry(tabId);
  if (!entry) return null;
  const schema = appState.schemas.get(tabId);
  return {
    id: tabId,
    title: schema?.title || entry.title,
    description: schema?.description || "",
    layout: schema?.layout || "",
    source: entry.source,
  };
}


function scheduleCompute() {
  clearTimeout(appState.computeTimer);
  appState.computeTimer = window.setTimeout(() => {
    void recomputeActiveTab();
  }, COMPUTE_DEBOUNCE_MS);
}


async function fetchPythonManifest() {
  const response = await fetch("python_manifest.json", { cache: "reload" });
  if (!response.ok) {
    throw new Error(`Failed to fetch python_manifest.json: ${response.status}`);
  }
  return response.json();
}


function ensureDirectory(pyodide, directoryPath) {
  if (!directoryPath) return;
  const parts = directoryPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    try {
      pyodide.FS.mkdir(current);
    } catch (_error) {
      // Directory already exists.
    }
  }
}


async function loadPythonFiles(pyodide, pythonFiles) {
  for (const relativePath of pythonFiles) {
    if (appState.loadedPythonFiles.has(relativePath)) continue;
    setStatus(`Loading ${relativePath}...`, "busy");
    const response = await fetch(relativePath, { cache: "reload" });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${relativePath}: ${response.status}`);
    }
    const source = await response.text();
    const fsPath = `/${relativePath}`;
    ensureDirectory(pyodide, fsPath.split("/").slice(0, -1).join("/"));
    pyodide.FS.writeFile(fsPath, source, { encoding: "utf8" });
    appState.loadedPythonFiles.add(relativePath);
  }
}


async function loadPyodideRuntime() {
  setStatus("Loading Pyodide...", "busy");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  setStatus("Loading numpy and scipy...", "busy");
  await pyodide.loadPackage(["numpy", "scipy"]);

  appState.pythonManifest = await fetchPythonManifest();
  const commonPythonFiles =
    appState.pythonManifest.common_python_files ||
    appState.pythonManifest.python_files ||
    [];
  await loadPythonFiles(pyodide, commonPythonFiles);

  pyodide.runPython(`
import sys
sys.path.insert(0, "/")
`);
  appState.pyodide = pyodide;
  setStatus("Python runtime ready");
}


function pythonFilesForCalculator(calculatorId) {
  return appState.pythonManifest?.calculator_python_files?.[calculatorId] || [];
}


function pyodideGetSchema(calculatorId) {
  appState.pyodide.globals.set("_bridge_calculator_id", calculatorId);
  const output = appState.pyodide.runPython(`
from app.registry import get_calculator_schema_json
get_calculator_schema_json(_bridge_calculator_id)
`);
  appState.pyodide.globals.delete("_bridge_calculator_id");
  return JSON.parse(output);
}


function pyodideRunCalculator(calculatorId, calculatorState) {
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


async function ensurePythonTabReady(tabId) {
  if (!isPythonTab(tabId)) return;
  if (appState.schemas.has(tabId)) return;

  if (!appState.pyodide) {
    await appState.pyodideReady;
  }
  await loadPythonFiles(appState.pyodide, pythonFilesForCalculator(tabId));
  const schema = pyodideGetSchema(tabId);
  appState.schemas.set(tabId, schema);
  if (!appState.states.has(tabId)) {
    appState.states.set(tabId, deepCopy(schema.default_state || {}));
  }
}


function ensureFrontendTabReady(tabId) {
  if (appState.schemas.has(tabId)) return;
  const module = tabModule(tabId);
  const frontend = module?.frontend;
  if (!frontend) return;
  appState.schemas.set(tabId, deepCopy(frontend.schema || {}));
  appState.states.set(tabId, deepCopy(frontend.defaultState || {}));
  if (frontend.initialResult) {
    appState.results.set(tabId, deepCopy(frontend.initialResult));
  }
}


async function recomputeActiveTab() {
  const tabId = appState.activeTabId;
  if (!tabId || !isPythonTab(tabId)) {
    setStatus("Python runtime ready");
    return;
  }
  if (!appState.pyodide) {
    await appState.pyodideReady;
  }
  await ensurePythonTabReady(tabId);
  setStatus("Running calculator...", "busy");
  try {
    const result = pyodideRunCalculator(tabId, appState.states.get(tabId) || {});
    appState.results.set(tabId, result);
    if (result.normalized_state) {
      appState.states.set(tabId, result.normalized_state);
    }
    renderActive();
    setStatus("Python runtime ready");
  } catch (error) {
    console.error(error);
    appState.results.set(tabId, {
      ok: false,
      error: error.message,
      warnings: [],
      summary_cards: [],
      plot_metrics: [],
      plot: {},
      scene: {},
    });
    renderActive();
    setStatus("Runtime error", "error");
  }
}


function renderTabs() {
  const nodes = [];
  for (const [id, entry] of appState.tabs) {
    const schema = appState.schemas.get(id);
    const label = schema?.title || entry.title;
    const button = element("button", {
      className: `tab${id === appState.activeTabId ? " active" : ""}`,
      text: label,
      attrs: { type: "button" },
    });
    button.addEventListener("click", () => {
      void switchToTab(id);
    });
    nodes.push(button);
  }
  dom.tabs.replaceChildren(...nodes);
}


function currentContext() {
  const tabId = appState.activeTabId;
  if (!tabId) return null;
  return {
    calculator: buildCalculatorManifest(tabId),
    schema: appState.schemas.get(tabId) || null,
    state: appState.states.get(tabId) || null,
    result: appState.results.get(tabId) || null,
  };
}


function renderActive() {
  renderTabs();
  if (!appState.activeInstance) return;
  const ctx = currentContext();
  if (!ctx) return;
  appState.activeInstance.update(ctx);
}


function teardownActiveInstance() {
  if (appState.activeInstance) {
    try {
      appState.activeInstance.unmount?.();
    } catch (error) {
      console.error("Error tearing down tab:", error);
    }
    appState.activeInstance = null;
  }
  dom.workspace.replaceChildren();
}


async function switchToTab(tabId) {
  if (!tabId || tabId === appState.activeTabId) return;

  teardownActiveInstance();
  appState.activeTabId = tabId;
  renderTabs();

  const entry = tabEntry(tabId);
  if (!entry) return;

  if (entry.source === "frontend") {
    ensureFrontendTabReady(tabId);
  } else {
    try {
      await ensurePythonTabReady(tabId);
    } catch (error) {
      console.error(error);
      setStatus("Runtime failed", "error");
      mountErrorPlaceholder(`Failed to load ${entry.title}: ${error.message}`);
      return;
    }
  }

  mountActiveTab();

  if (entry.source === "python" && !appState.results.has(tabId)) {
    await recomputeActiveTab();
  } else {
    setStatus("Python runtime ready");
  }
}


function mountActiveTab() {
  const tabId = appState.activeTabId;
  const module = tabModule(tabId);
  if (!module) return;
  const services = servicesFor(tabId);
  const instance = module.mount(dom.workspace, services);
  appState.activeInstance = instance;
  const ctx = currentContext();
  if (ctx) instance.update(ctx);
}


function mountErrorPlaceholder(message) {
  dom.workspace.replaceChildren(
    element("section", {
      className: "panel",
      children: [element("div", { className: "message error", text: message })],
    }),
  );
}


function registerTabs() {
  for (const entry of TAB_REGISTRY) {
    appState.tabs.set(entry.id, entry);
    // Materialize the factory up front so frontend-only tabs can contribute
    // their manifest/schema before Pyodide finishes loading.
    tabModule(entry.id);
    if (entry.source === "frontend") {
      ensureFrontendTabReady(entry.id);
    }
  }
}


async function initializeApplication() {
  try {
    registerTabs();

    appState.pyodideReady = loadPyodideRuntime().catch((error) => {
      console.error(error);
      setStatus("Runtime failed", "error");
      throw error;
    });

    const startId = defaultTabId();
    if (startId && tabEntry(startId)?.source === "frontend") {
      // Render the frontend-only default tab immediately — no need to wait
      // for Pyodide.
      await switchToTab(startId);
    }

    await appState.pyodideReady;

    // Once Pyodide is ready, render or recompute as needed.
    if (!appState.activeTabId && startId) {
      await switchToTab(startId);
    } else if (appState.activeTabId && isPythonTab(appState.activeTabId)) {
      await recomputeActiveTab();
    }
  } catch (error) {
    console.error(error);
    setStatus("Runtime failed", "error");
    mountErrorPlaceholder(
      `Failed to initialize the browser-side Python runtime: ${error.message}`,
    );
  }
}


window.addEventListener("DOMContentLoaded", () => {
  void initializeApplication();
});
