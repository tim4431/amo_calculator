// Shared panel factories. Each factory builds a persistent DOM section and
// returns { node, update(...) } so calculator UIs can mount once and refresh
// contents on state changes without rebuilding the outer frame.
//
// No calculator-specific logic lives here — every panel takes whatever it
// needs as a function or data argument.

import { element, getValueByPath, renderField } from "./ui_common.js";


export function createHeroPanel({ onUpdateGlobal }) {
  const titleNode = element("h2", { text: "" });
  const descriptionNode = element("p", { className: "panel-copy", text: "" });
  const heroCopy = element("div", {
    className: "hero-copy",
    children: [titleNode, descriptionNode],
  });
  const globalControls = element("div", { className: "toolbar-controls" });
  const summary = element("div", { className: "summary-grid" });

  const node = element("section", {
    className: "panel hero-panel",
    children: [heroCopy, globalControls, summary],
  });

  function update({ calculator, schema, state, result, visibility }) {
    const showCopy = visibility?.showCopy ?? true;
    const showControls = visibility?.showControls ?? true;
    const showSummary = visibility?.showSummary ?? true;

    heroCopy.style.display = showCopy ? "" : "none";
    titleNode.textContent = calculator?.title || "Calculator";
    descriptionNode.textContent = calculator?.description || "";

    globalControls.style.display = showControls ? "" : "none";
    if (showControls) {
      const fields = schema?.global_fields || [];
      const nodes = fields.map((field) =>
        renderField(
          field,
          getValueByPath(state || {}, field.path),
          (nextValue) => onUpdateGlobal(field.path, nextValue),
          state || {},
        ),
      );
      globalControls.replaceChildren(...nodes);
    } else {
      globalControls.replaceChildren();
    }

    summary.style.display = showSummary ? "" : "none";
    if (showSummary) {
      const cards = (result?.summary_cards || []).map((card) =>
        element("div", {
          className: "summary-card",
          children: [
            element("p", { className: "summary-label", text: card.label }),
            element("p", { className: "summary-value", text: card.value }),
          ],
        }),
      );
      if (!cards.length) {
        summary.replaceChildren(
          element("p", {
            className: "empty-state",
            text: "Run a calculator to populate summary values.",
          }),
        );
      } else {
        summary.replaceChildren(...cards);
      }
    } else {
      summary.replaceChildren();
    }
  }

  return { node, update };
}


export function createPlotPanel({ sectionTitle = "Plot" } = {}) {
  const titleNode = element("h3", { text: sectionTitle });
  const header = element("div", {
    className: "panel-header",
    children: [element("div", { children: [titleNode] })],
  });
  const readoutHost = element("div", { className: "plot-readout" });
  const plotHost = element("div", { className: "plot-host" });
  const stage = element("div", {
    className: "plot-stage",
    children: [readoutHost, plotHost],
  });
  const metrics = element("div", { className: "plot-metrics" });
  metrics.style.display = "none";

  const node = element("section", {
    className: "panel plot-panel",
    children: [header, stage, metrics],
  });

  function setTitle(nextTitle) {
    titleNode.textContent = nextTitle;
  }

  function setMetrics(items) {
    if (!items || !items.length) {
      metrics.replaceChildren();
      metrics.style.display = "none";
      return;
    }
    const cards = items.map((card) =>
      element("div", {
        className: "summary-card plot-metric-card",
        children: [
          element("p", { className: "summary-label", text: card.label }),
          element("p", { className: "summary-value", text: card.value }),
        ],
      }),
    );
    metrics.replaceChildren(...cards);
    metrics.style.display = "";
  }

  return { node, plotHost, readoutHost, setTitle, setMetrics };
}


export function createBuilderPanel({ heading = "Builder" } = {}) {
  const headingNode = element("h3", { text: heading });
  const hintNode = element("p", { className: "panel-copy", text: "" });
  const header = element("div", {
    className: "panel-header",
    children: [
      element("div", { children: [headingNode, hintNode] }),
    ],
  });
  const toolbar = element("div", { className: "builder-toolbar" });
  const body = element("div");

  const node = element("section", {
    className: "panel",
    children: [header, toolbar, body],
  });

  function setHint(text) {
    hintNode.textContent = text || "";
  }

  return { node, toolbarHost: toolbar, builderHost: body, setHint };
}


export function createMessagesPanel({ heading = "Messages" } = {}) {
  const headingNode = element("h3", { text: heading });
  const list = element("div", { className: "messages" });
  const node = element("section", {
    className: "panel",
    children: [headingNode, list],
  });

  function setMessages(messages) {
    const nodes = (messages || []).map((message) =>
      element("div", {
        className: `message ${message.kind || "info"}`,
        text: message.text,
      }),
    );
    if (!nodes.length) {
      nodes.push(element("div", { className: "message info", text: "No messages." }));
    }
    list.replaceChildren(...nodes);
  }

  return { node, setMessages };
}


export function createContentPanel({ className = "panel" } = {}) {
  const body = element("div");
  const node = element("section", {
    className,
    children: [body],
  });
  return { node, body };
}


export function collectStandardMessages(result, { successHint } = {}) {
  const messages = [];
  if (!result) {
    messages.push({
      kind: "info",
      text: "The calculator will run after the Python runtime finishes loading.",
    });
    return messages;
  }
  if (result.error) {
    messages.push({ kind: "error", text: result.error });
  }
  for (const warning of result.warnings || []) {
    messages.push({ kind: "warning", text: warning });
  }
  if (result.ok && successHint) {
    messages.push({ kind: "info", text: successHint });
  }
  return messages;
}
