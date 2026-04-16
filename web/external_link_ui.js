import { element } from "./ui_common.js";


function setReadout(readoutHost, title, body) {
  readoutHost.replaceChildren(
    element("p", { className: "plot-readout-title", text: title }),
    element("p", { className: "plot-readout-body", html: body }),
  );
}


export function createExternalLinkUi() {
  return {
    matches({ schema }) {
      return schema?.layout === "external_link";
    },

    getShellConfig({ calculator }) {
      return {
        showHero: false,
        plotSectionTitle: calculator?.title || "External app",
        builderHint: "This tab opens a separate hosted app.",
        successHint: "Open the external app in a new tab.",
        showBuilder: false,
      };
    },

    clearTransientState() {},

    syncState() {},

    renderBuilder({ builderToolbar, builderContainer }) {
      builderToolbar.replaceChildren();
      builderToolbar.style.display = "none";
      builderContainer.replaceChildren();
    },

    renderPlot({ plotHost, readoutHost, calculator, schema, result }) {
      const externalUrl = calculator?.tab_url || schema?.external_url || result?.plot?.external_url || "";
      const ctaLabel = schema?.call_to_action || result?.plot?.call_to_action || `Open ${calculator?.title || "app"}`;

      if (typeof Plotly?.purge === "function") {
        Plotly.purge(plotHost);
      }

      plotHost.replaceChildren(
        element("div", {
          className: "external-link-panel",
          children: [
            element("p", {
              className: "panel-copy",
              text: calculator?.description || "Open the hosted app in a separate tab.",
            }),
            element("a", {
              className: "external-link-button",
              text: ctaLabel,
              attrs: {
                href: externalUrl,
                target: "_blank",
                rel: "noreferrer",
              },
            }),
          ],
        }),
      );

      setReadout(
        readoutHost,
        calculator?.title || "External app",
        `This calculator lives at <strong>${externalUrl}</strong> and opens in a separate tab.`,
      );
    },
  };
}
