// Explicit tab manifest. The order of entries is the tab order displayed in
// the navigation. The entry flagged `default: true` opens on first load.
//
// Each entry:
//   id        — stable tab id. For `source: "python"` tabs, this must match
//               the calculator id exposed by `app.registry` in Pyodide.
//   title     — tab button label (also acts as fallback calculator title).
//   source    — "python" for tabs backed by a Pyodide calculator, or
//               "frontend" for tabs whose metadata and rendering are owned
//               entirely by the browser.
//   default   — optional; exactly one entry may set this to true.
//   createTab — factory that returns a mount-able tab module with shape:
//                   { matches?, frontend?, mount(workspace, services) → { update, unmount } }
//               (see README of this file for details). Python-backed tabs
//               may still declare their own factory so they can own DOM.

import { createExternalLinkTab } from "./external_link_ui.js";
import { createCavityModeTab } from "./cavity_mode_ui.js";
import { createSimpleCalculatorTab } from "./simple_calculator_ui.js";
import { createGaussianClippingTab } from "./gaussian_clipping_ui.js";


export const TAB_REGISTRY = [
  {
    id: "link",
    title: "Link",
    source: "frontend",
    default: true,
    createTab: createExternalLinkTab,
  },
  {
    id: "cavity-mode",
    title: "Cavity Mode",
    source: "python",
    createTab: createCavityModeTab,
  },
  {
    id: "gaussian-beam",
    title: "Gaussian Beam",
    source: "python",
    createTab: createSimpleCalculatorTab,
  },
  {
    id: "gaussian-clipping",
    title: "Gaussian Clipping",
    source: "python",
    createTab: createGaussianClippingTab,
  },
];


export function defaultTabId() {
  const explicit = TAB_REGISTRY.find((entry) => entry.default);
  return explicit ? explicit.id : TAB_REGISTRY[0]?.id || null;
}
