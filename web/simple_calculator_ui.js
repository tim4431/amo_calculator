import { element } from "./ui_common.js";


function setPlotReadout(readoutHost, content) {
  readoutHost.replaceChildren(
    element("p", { className: "plot-readout-title", text: content.title }),
    element("p", { className: "plot-readout-body", html: content.body }),
  );
}


function collectXCoordinates(plot) {
  const values = [];
  for (const trace of plot.traces || []) {
    values.push(...trace.x_mm);
  }
  if (plot.waist_marker) {
    values.push(plot.waist_marker.x_mm);
  }
  return values.length ? values : [0];
}


function collectYCoordinates(plot) {
  const values = [];
  for (const trace of plot.traces || []) {
    values.push(...trace.y_um.map((value) => Number(value)));
  }
  if (plot.waist_marker) {
    values.push(Number(plot.waist_marker.y_um || 0));
  }
  return values.length ? values : [0];
}


function computeMirroredYMax(plot) {
  if (Number.isFinite(Number(plot.y_max_um)) && Number(plot.y_max_um) > 0) {
    return Number(plot.y_max_um);
  }

  const values = [];
  for (const trace of plot.traces || []) {
    values.push(...trace.y_um.map((value) => Math.abs(Number(value))));
  }
  if (plot.waist_marker) {
    values.push(Math.abs(Number(plot.waist_marker.y_um || 0)));
  }
  return values.length ? 1.15 * Math.max(...values, 1) : 200;
}


function computeYRange(plot, mirrorY) {
  if (mirrorY) {
    const yMax = computeMirroredYMax(plot);
    return {
      yMax,
      range: [-1.18 * yMax, 1.18 * yMax],
    };
  }

  const values = collectYCoordinates(plot);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const span = Math.max(1.0, yMax - yMin);
  return {
    yMax,
    range: [yMin - 0.08 * span, yMax + 0.08 * span],
  };
}


function buildPlotReadout(result, calculator) {
  if (result && result.error) {
    return {
      title: `Waiting for a valid ${calculator?.title || "calculator"}`,
      body: result.error,
    };
  }
  return {
    title: calculator?.title || "Calculator",
    body: "Adjust the controls to update the browser-side Python result.",
  };
}


export function createSimpleCalculatorUi() {
  return {
    matches({ schema }) {
      return schema?.layout === "simple_form";
    },

    getShellConfig({ calculator }) {
      return {
        showHero: true,
        plotSectionTitle: calculator?.title || "Calculator",
        builderHint: "Adjust the control values to run the selected calculator in the browser-side Python runtime.",
        successHint: "Calculator ran successfully.",
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

    renderPlot({ plotHost, readoutHost, result, calculator, schema }) {
      const plot = (result && result.plot) || {
        traces: [],
        waist_marker: null,
        y_max_um: 200,
      };
      const mirrorY = Boolean(plot.mirror_y);
      const yLayout = computeYRange(plot, mirrorY);
      const xValues = collectXCoordinates(plot);
      const xMin = Math.min(...xValues);
      const xMax = Math.max(...xValues);
      const xSpan = Math.max(1.0, xMax - xMin);
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

      Plotly.react(plotHost, traces, {
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
        legend: {
          orientation: "h",
          x: 1,
          xanchor: "right",
          y: 1.12,
        },
        shapes: [
          ...((plot.show_zero_line ?? mirrorY) ? [
            {
              type: "line",
              x0: xMin - 0.03 * xSpan,
              x1: xMax + 0.03 * xSpan,
              y0: 0,
              y1: 0,
              line: { color: "rgba(36, 31, 23, 0.12)", width: 1 },
            },
          ] : []),
        ],
        uirevision: `plot-${(schema && schema.id) || "calculator"}`,
      }, {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
      });

      setPlotReadout(readoutHost, buildPlotReadout(result, calculator));
    },
  };
}
