import { element } from "./ui_common.js";


const EXTERNAL_LINK_OPTIONS = [
  {
    id: "marimo",
    label: "Marimo",
    url: "https://amo_calculator.xwtim.com",
    description: "Hosted marimo workspace for the AMO calculator project.",
  },
  {
    id: "lens-pair-finder",
    label: "Lens Pair Finder",
    url: "https://jonphoton.github.io/LensPairFinder/",
    description: "Interactive lens-pair search tool for optical design work.",
  },
  {
    id: "cavity-mode-viewer",
    label: "Cavity Mode Viewer",
    url: "https://avkgithub1.github.io/CavityModeViewer/",
    description: "Standalone viewer for cavity-mode layouts and results.",
  },
  {
    id: "tuning-range",
    label: "Tuning Range",
    url: "https://avkgithub1.github.io/TuningRange/",
    description: "Hosted tuning-range calculator for quick exploratory checks.",
  },
];

function normalizeLinkOptions(linkOptions = []) {
  return linkOptions
    .filter((option) => option && typeof option.url === "string" && option.url)
    .map((option, index) => ({
      id: option.id || `link-${index + 1}`,
      label: option.label || option.title || option.url,
      url: option.url,
      description: option.description || "",
    }));
}

export function createExternalLinksTabDefinition() {
  const linkOptions = normalizeLinkOptions(EXTERNAL_LINK_OPTIONS);
  const defaultState = {};

  return {
    manifest: {
      id: "link",
      title: "Link",
      description: "Open hosted tools and external resources from one place.",
      layout: "external_link",
      frontend_only: true,
    },
    schema: {
      id: "link",
      title: "Link",
      description: "Open hosted tools and external resources from one place.",
      layout: "external_link",
      default_state: defaultState,
      link_options: linkOptions,
    },
    initial_state: defaultState,
    initial_result: {
      ok: true,
      error: null,
      warnings: linkOptions.length ? [] : ["No external links are configured."],
      normalized_state: defaultState,
      summary_cards: [],
      plot_metrics: [],
      plot: {
        link_options: linkOptions,
      },
      scene: {},
    },
  };
}


export function createExternalLinkUi() {
  return {
    matches({ schema }) {
      return schema?.layout === "external_link";
    },

    getShellConfig({ calculator }) {
      return {
        showHero: false,
        plotSectionTitle: calculator?.title || "Links",
        builderHint: "Click a card to open an external resource in a new tab.",
        successHint: "Click a card to open an external resource in a new tab.",
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
      const linkOptions = normalizeLinkOptions(schema?.link_options || result?.plot?.link_options || []);

      if (typeof Plotly?.purge === "function") {
        Plotly.purge(plotHost);
      }

      readoutHost.replaceChildren();
      readoutHost.style.display = "none";
      plotHost.style.minHeight = "0";

      const cards = linkOptions.map((option) =>
        element("a", {
          className: "external-link-card",
          attrs: {
            href: option.url,
            target: "_blank",
            rel: "noreferrer",
          },
          children: [
            element("p", {
              className: "external-link-card-title",
              text: option.label,
            }),
            element("p", {
              className: "external-link-card-description",
              text: option.description || `Open ${option.url} in a new tab.`,
            }),
            element("p", {
              className: "external-link-card-url",
              text: option.url,
            }),
          ],
        })
      );

      plotHost.replaceChildren(
        element("div", {
          className: "external-link-panel",
          children: [
            element("p", {
              className: "panel-copy external-link-intro",
              text: calculator?.description || "Open hosted tools and external resources from one place.",
            }),
            cards.length
              ? element("div", {
                  className: "external-link-grid",
                  children: cards,
                })
              : element("p", {
                  className: "empty-state",
                  text: "No external links are configured yet.",
                }),
          ],
        }),
      );
    },
  };
}
