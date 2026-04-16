// External-links tab. Fully frontend-owned — no Pyodide calls. Demonstrates
// the "no graphical window" case: the tab module declares its own schema and
// default state, and its mount() hook builds a content panel with cards.

import { element } from "./ui_common.js";
import { createContentPanel, createMessagesPanel, collectStandardMessages } from "./panels.js";


const DEFAULT_LINK_OPTIONS = [
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


function renderLinkCards(body, intro, linkOptions) {
  const cards = linkOptions.map((option) =>
    element("a", {
      className: "external-link-card",
      attrs: { href: option.url, target: "_blank", rel: "noreferrer" },
      children: [
        element("p", { className: "external-link-card-title", text: option.label }),
        element("p", {
          className: "external-link-card-description",
          text: option.description || `Open ${option.url} in a new tab.`,
        }),
        element("p", { className: "external-link-card-url", text: option.url }),
      ],
    }),
  );

  const panel = element("div", {
    className: "external-link-panel",
    children: [
      element("p", { className: "panel-copy external-link-intro", text: intro }),
      cards.length
        ? element("div", { className: "external-link-grid", children: cards })
        : element("p", {
            className: "empty-state",
            text: "No external links are configured yet.",
          }),
    ],
  });

  body.replaceChildren(panel);
}


export function createExternalLinkTab() {
  const linkOptions = normalizeLinkOptions(DEFAULT_LINK_OPTIONS);
  const frontend = {
    manifest: {
      id: "link",
      title: "Link",
      description: "Open hosted tools and external resources from one place.",
      layout: "external_link",
    },
    schema: {
      id: "link",
      title: "Link",
      description: "Open hosted tools and external resources from one place.",
      layout: "external_link",
      default_state: {},
      link_options: linkOptions,
    },
    defaultState: {},
    initialResult: {
      ok: true,
      error: null,
      warnings: linkOptions.length ? [] : ["No external links are configured."],
      normalized_state: {},
      summary_cards: [],
      plot_metrics: [],
      plot: {},
      scene: {},
    },
  };

  function mount(workspace) {
    const content = createContentPanel({ className: "panel" });
    const messages = createMessagesPanel();

    workspace.append(content.node, messages.node);

    function update(ctx) {
      const options = normalizeLinkOptions(
        ctx.schema?.link_options || frontend.schema.link_options || [],
      );
      const intro =
        ctx.calculator?.description ||
        frontend.manifest.description ||
        "Open hosted tools and external resources from one place.";
      renderLinkCards(content.body, intro, options);
      messages.setMessages(collectStandardMessages(ctx.result));
    }

    function unmount() {
      workspace.replaceChildren();
    }

    return { update, unmount };
  }

  return { frontend, mount };
}
