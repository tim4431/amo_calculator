// Generic single-form calculator tab. Suitable for any Python-backed
// calculator whose schema exposes `global_fields` and whose result returns
// a `plot` with a `traces` array plus optional `summary_cards`.
//
// Shell layout: hero (copy + fields + summary) → plot → messages.

import { element } from "./ui_common.js";
import {
  collectStandardMessages,
  createHeroPanel,
  createMessagesPanel,
  createPlotPanel,
} from "./panels.js";


function collectXCoordinates(plot) {
  const values = [];
  for (const trace of plot.traces || []) {
    values.push(...trace.x_mm);
  }
  if (plot.waist_marker) values.push(plot.waist_marker.x_mm);
  return values.length ? values : [0];
}


function collectYCoordinates(plot) {
  const values = [];
  for (const trace of plot.traces || []) {
    values.push(...trace.y_um.map((value) => Number(value)));
  }
  if (plot.waist_marker) values.push(Number(plot.waist_marker.y_um || 0));
  return values.length ? values : [0];
}


function mirroredYMax(plot) {
  if (Number.isFinite(Number(plot.y_max_um)) && Number(plot.y_max_um) > 0) {
    return Number(plot.y_max_um);
  }
  const values = [];
  for (const trace of plot.traces || []) {
    values.push(...trace.y_um.map((value) => Math.abs(Number(value))));
  }
  if (plot.waist_marker) values.push(Math.abs(Number(plot.waist_marker.y_um || 0)));
  return values.length ? 1.15 * Math.max(...values, 1) : 200;
}


function computeYRange(plot, mirrorY) {
  if (mirrorY) {
    const yMax = mirroredYMax(plot);
    return { yMax, range: [-1.18 * yMax, 1.18 * yMax] };
  }
  const values = collectYCoordinates(plot);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const span = Math.max(1.0, yMax - yMin);
  return { yMax, range: [yMin - 0.08 * span, yMax + 0.08 * span] };
}


function buildTraces(plot, mirrorY) {
  const traces = [];
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
    if (mirrorY) {
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
    }
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
  }
  return traces;
}


function renderPlotlyChart(plotHost, plot, schema) {
  if (typeof Plotly?.purge === "function") Plotly.purge(plotHost);
  plotHost.replaceChildren();

  const mirrorY = Boolean(plot.mirror_y);
  const yLayout = computeYRange(plot, mirrorY);
  const xValues = collectXCoordinates(plot);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xSpan = Math.max(1.0, xMax - xMin);
  const traces = buildTraces(plot, mirrorY);

  Plotly.react(
    plotHost,
    traces,
    {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(255,255,255,0.82)",
      margin: { t: 24, r: 24, b: 64, l: 72 },
      xaxis: {
        title: plot.x_axis_title || "x",
        range: [xMin - 0.03 * xSpan, xMax + 0.03 * xSpan],
        zeroline: false,
        gridcolor: "rgba(36, 31, 23, 0.1)",
      },
      yaxis: {
        title: plot.y_axis_title || "y",
        range: yLayout.range,
        zeroline: false,
        gridcolor: "rgba(36, 31, 23, 0.1)",
      },
      hovermode: false,
      hoverdistance: -1,
      legend: { orientation: "h", x: 1, xanchor: "right", y: 1.12 },
      shapes:
        plot.show_zero_line ?? mirrorY
          ? [
              {
                type: "line",
                x0: xMin - 0.03 * xSpan,
                x1: xMax + 0.03 * xSpan,
                y0: 0,
                y1: 0,
                line: { color: "rgba(36, 31, 23, 0.12)", width: 1 },
              },
            ]
          : [],
      uirevision: `plot-${schema?.id || "calculator"}`,
    },
    {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    },
  );
}


function setReadout(readoutHost, title, bodyHtml) {
  readoutHost.replaceChildren(
    element("p", { className: "plot-readout-title", text: title }),
    element("p", { className: "plot-readout-body", html: bodyHtml }),
  );
}


export function createSimpleCalculatorTab({ title } = {}) {
  function mount(workspace, services) {
    const hero = createHeroPanel({ onUpdateGlobal: services.updateGlobal });
    const plot = createPlotPanel({ sectionTitle: title || "Calculator" });
    const messages = createMessagesPanel();

    workspace.append(hero.node, plot.node, messages.node);

    function update(ctx) {
      hero.update({
        calculator: ctx.calculator,
        schema: ctx.schema,
        state: ctx.state,
        result: ctx.result,
        visibility: { showCopy: true, showControls: true, showSummary: true },
      });

      plot.setTitle(ctx.calculator?.title || title || "Calculator");
      const plotData = ctx.result?.plot || { traces: [] };
      renderPlotlyChart(plot.plotHost, plotData, ctx.schema);
      if (ctx.result?.error) {
        setReadout(
          plot.readoutHost,
          `Waiting for a valid ${ctx.calculator?.title || "calculator"}`,
          ctx.result.error,
        );
      } else {
        setReadout(
          plot.readoutHost,
          ctx.calculator?.title || title || "Calculator",
          "Adjust the controls to update the browser-side Python result.",
        );
      }
      plot.setMetrics(ctx.result?.plot_metrics || []);

      messages.setMessages(
        collectStandardMessages(ctx.result, {
          successHint: "Calculator ran successfully.",
        }),
      );
    }

    function unmount() {
      if (typeof Plotly?.purge === "function") Plotly.purge(plot.plotHost);
      workspace.replaceChildren();
    }

    return { update, unmount };
  }

  return { mount };
}
