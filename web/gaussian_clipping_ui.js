// Two-column tab for the Gaussian clipping calculator.
// Left column: title, description, controls, metric cards.
// Right column: a heatmap view of the displaced Gaussian plus a loss-vs-x curve.

import { element, getValueByPath, renderField } from "./ui_common.js";
import { collectStandardMessages, createMessagesPanel } from "./panels.js";


const GRID_SIZE = 181;
const MARGIN = { top: 14, right: 14, bottom: 50, left: 58 };


function whiteToRedRGB(value) {
  const t = Math.max(0, Math.min(1, value));
  const shade = Math.round(255 * (1 - t));
  return [255, shade, shade];
}


function buildIntensityGrid(waist, displacement, extent) {
  const grid = new Float32Array(GRID_SIZE * GRID_SIZE);
  const step = (2 * extent) / (GRID_SIZE - 1);
  const twoOverW2 = 2 / (waist * waist);
  for (let iy = 0; iy < GRID_SIZE; iy += 1) {
    const y = -extent + iy * step;
    for (let ix = 0; ix < GRID_SIZE; ix += 1) {
      const x = -extent + ix * step;
      const dx = x - displacement;
      grid[iy * GRID_SIZE + ix] = Math.exp(-twoOverW2 * (dx * dx + y * y));
    }
  }
  return grid;
}


function niceTicks(min, max, desired = 5) {
  const range = max - min;
  if (range <= 0) return [min];
  const rough = range / desired;
  const exp10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / exp10;
  let step;
  if (frac < 1.5) step = exp10;
  else if (frac < 3) step = 2 * exp10;
  else if (frac < 7) step = 5 * exp10;
  else step = 10 * exp10;
  const ticks = [];
  const start = Math.ceil(min / step) * step;
  for (let t = start; t <= max + step * 1e-6; t += step) {
    ticks.push(Number(t.toFixed(10)));
  }
  return ticks;
}


function paintHeatmap(ctx, grid, plotX, plotY, plotSize) {
  const off = document.createElement("canvas");
  off.width = GRID_SIZE;
  off.height = GRID_SIZE;
  const offCtx = off.getContext("2d");
  const image = offCtx.createImageData(GRID_SIZE, GRID_SIZE);
  for (let iy = 0; iy < GRID_SIZE; iy += 1) {
    for (let ix = 0; ix < GRID_SIZE; ix += 1) {
      const value = grid[iy * GRID_SIZE + ix];
      // Flip vertically: canvas y grows downward; physics y grows upward.
      const imageIdx = ((GRID_SIZE - 1 - iy) * GRID_SIZE + ix) * 4;
      const [r, g, b] = whiteToRedRGB(value);
      image.data[imageIdx] = r;
      image.data[imageIdx + 1] = g;
      image.data[imageIdx + 2] = b;
      image.data[imageIdx + 3] = 255;
    }
  }
  offCtx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, plotX, plotY, plotSize, plotSize);
}


function drawCircle(ctx, apertureRadius, extent, plotX, plotY, plotSize) {
  const cx = plotX + plotSize / 2;
  const cy = plotY + plotSize / 2;
  const r = (apertureRadius / (2 * extent)) * plotSize;
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}


function drawAxes(ctx, extent, plotX, plotY, plotSize) {
  ctx.save();
  ctx.strokeStyle = "rgba(36, 31, 23, 0.55)";
  ctx.lineWidth = 1;
  ctx.strokeRect(plotX + 0.5, plotY + 0.5, plotSize - 1, plotSize - 1);

  ctx.fillStyle = "rgba(36, 31, 23, 0.85)";
  ctx.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";

  const ticks = niceTicks(-extent, extent);
  for (const t of ticks) {
    const px = plotX + ((t + extent) / (2 * extent)) * plotSize;
    const py = plotY + plotSize - ((t + extent) / (2 * extent)) * plotSize;

    ctx.beginPath();
    ctx.moveTo(px, plotY + plotSize);
    ctx.lineTo(px, plotY + plotSize + 5);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(String(t), px, plotY + plotSize + 7);

    ctx.beginPath();
    ctx.moveTo(plotX, py);
    ctx.lineTo(plotX - 5, py);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(t), plotX - 7, py);
  }

  ctx.font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("x [um]", plotX + plotSize / 2, plotY + plotSize + 38);

  ctx.save();
  ctx.translate(plotX - 42, plotY + plotSize / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("y [um]", 0, 0);
  ctx.restore();

  ctx.restore();
}


function renderPlot(canvas, waist, displacement, apertureRadius) {
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width;
  const cssH = rect.height;
  if (cssW <= 1 || cssH <= 1) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const innerW = cssW - MARGIN.left - MARGIN.right;
  const innerH = cssH - MARGIN.top - MARGIN.bottom;
  if (innerW <= 0 || innerH <= 0) return;
  const plotSize = Math.min(innerW, innerH);
  const plotX = MARGIN.left + (innerW - plotSize) / 2;
  const plotY = MARGIN.top + (innerH - plotSize) / 2;

  const extent = Math.max(Math.abs(displacement) + 3 * waist, 1.5 * apertureRadius);
  const grid = buildIntensityGrid(waist, displacement, extent);

  paintHeatmap(ctx, grid, plotX, plotY, plotSize);
  drawCircle(ctx, apertureRadius, extent, plotX, plotY, plotSize);
  drawAxes(ctx, extent, plotX, plotY, plotSize);
}


function formatMicronValue(value) {
  return Number(value).toFixed(1);
}


function renderLossCurve(plotHost, lossCurve) {
  if (!(lossCurve?.x_um?.length && lossCurve?.loss_percent?.length)) {
    if (typeof Plotly?.purge === "function") Plotly.purge(plotHost);
    plotHost.replaceChildren();
    return;
  }

  if (typeof Plotly?.react !== "function") {
    plotHost.replaceChildren(
      element("p", {
        className: "empty-state",
        text: "Plotly is required to render the loss curve.",
      }),
    );
    return;
  }

  const xValues = lossCurve.x_um.map((value) => Number(value));
  const yValues = lossCurve.loss_percent.map((value) => Number(value));
  const currentPoint = lossCurve.current_point || null;
  const currentVisible = Boolean(currentPoint?.visible);
  const currentX = Number(currentPoint?.x_um) || 0;
  const currentY = Number(currentPoint?.loss_percent) || 0;
  const xMax = Math.max(...xValues, 1);
  const yTop = 1.08 * Math.max(...yValues, currentVisible ? currentY : 0, 0.01);

  const traces = [
    {
      x: xValues,
      y: yValues,
      type: "scatter",
      mode: "lines",
      name: "Power loss",
      line: { color: "#b34700", width: 4 },
      hovertemplate: "x = %{x:.2f} um<br>Power loss = %{y:.4f} %<extra></extra>",
    },
  ];

  if (currentVisible) {
    traces.push({
      x: [currentX],
      y: [currentY],
      type: "scatter",
      mode: "markers",
      name: "Current x",
      marker: {
        color: "#0b7285",
        size: 11,
        line: { color: "rgba(255,255,255,0.96)", width: 1.5 },
      },
      hovertemplate: "Current x = %{x:.2f} um<br>Power loss = %{y:.4f} %<extra></extra>",
    });
  }

  Plotly.react(
    plotHost,
    traces,
    {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(255,255,255,0.82)",
      margin: { t: 18, r: 24, b: 60, l: 72 },
      xaxis: {
        title: lossCurve.x_axis_title || "Displacement x [um]",
        range: [0, xMax],
        zeroline: false,
        gridcolor: "rgba(36, 31, 23, 0.1)",
      },
      yaxis: {
        title: lossCurve.y_axis_title || "Power loss [%]",
        range: [0, yTop],
        zeroline: false,
        gridcolor: "rgba(36, 31, 23, 0.1)",
      },
      hovermode: "closest",
      legend: { orientation: "h", x: 1, xanchor: "right", y: 1.12 },
      shapes: currentVisible
        ? [
            {
              type: "line",
              x0: currentX,
              x1: currentX,
              y0: 0,
              y1: currentY,
              line: { color: "rgba(11, 114, 133, 0.4)", width: 1.5, dash: "dot" },
            },
          ]
        : [],
      uirevision: "clipping-loss-curve",
    },
    {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    },
  );
}


function renderControls(host, schema, state, onUpdate) {
  const fields = schema?.global_fields || [];
  const nodes = fields.map((field) =>
    renderField(
      field,
      getValueByPath(state || {}, field.path),
      (nextValue) => onUpdate(field.path, nextValue),
      state || {},
    ),
  );
  host.replaceChildren(...nodes);
}


function renderMetrics(host, metrics) {
  const items = metrics || [];
  if (!items.length) {
    host.replaceChildren();
    host.style.display = "none";
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
  host.replaceChildren(...cards);
  host.style.display = "";
}


export function createGaussianClippingTab({ title } = {}) {
  function mount(workspace, services) {
    const titleNode = element("h3", { text: title || "Gaussian Clipping" });
    const descriptionNode = element("p", { className: "panel-copy", text: "" });
    const header = element("div", {
      className: "panel-header",
      children: [element("div", { children: [titleNode, descriptionNode] })],
    });

    const controlsHost = element("div", { className: "clipping-controls" });
    const metricsHost = element("div", { className: "plot-metrics clipping-metrics" });
    const leftColumn = element("div", {
      className: "clipping-left",
      children: [controlsHost, metricsHost],
    });

    const canvas = element("canvas", { className: "clipping-canvas" });
    const heatmapHost = element("div", {
      className: "clipping-plot",
      children: [canvas],
    });
    const heatmapCard = element("section", {
      className: "clipping-visual-card",
      children: [
        element("div", {
          className: "clipping-visual-header",
          children: [
            element("h4", { className: "clipping-visual-title", text: "Beam Profile" }),
            element("p", {
              className: "clipping-visual-copy",
              text: "Current Gaussian intensity with the aperture boundary shown as a dashed circle.",
            }),
          ],
        }),
        heatmapHost,
      ],
    });

    const curveCopyNode = element("p", { className: "clipping-visual-copy", text: "" });
    const curveHost = element("div", { className: "clipping-curve-host" });
    const curveCard = element("section", {
      className: "clipping-visual-card",
      children: [
        element("div", {
          className: "clipping-visual-header",
          children: [
            element("h4", { className: "clipping-visual-title", text: "Loss vs Displacement" }),
            curveCopyNode,
          ],
        }),
        curveHost,
      ],
    });

    const visuals = element("div", {
      className: "clipping-visuals",
      children: [heatmapCard, curveCard],
    });
    const rightColumn = element("div", {
      className: "clipping-right",
      children: [visuals],
    });

    const grid = element("div", {
      className: "clipping-grid",
      children: [leftColumn, rightColumn],
    });
    const panel = element("section", {
      className: "panel clipping-panel",
      children: [header, grid],
    });

    const messages = createMessagesPanel();
    workspace.append(panel, messages.node);

    let lastParams = null;
    const draw = () => {
      if (!lastParams) return;
      renderPlot(canvas, lastParams.waist, lastParams.displacement, lastParams.apertureRadius);
    };
    const resizeObserver = new ResizeObserver(() => {
      draw();
      if (
        typeof Plotly?.Plots?.resize === "function"
        && curveHost.classList.contains("js-plotly-plot")
      ) {
        Plotly.Plots.resize(curveHost);
      }
    });
    resizeObserver.observe(canvas);
    resizeObserver.observe(curveHost);

    function update(ctx) {
      titleNode.textContent = ctx.calculator?.title || title || "Gaussian Clipping";
      descriptionNode.textContent = ctx.calculator?.description || "";
      renderControls(controlsHost, ctx.schema, ctx.state, services.updateGlobal);

      const globals =
        ctx.result?.normalized_state?.globals || ctx.state?.globals || {};
      const diameter = Number(globals.diameter_um) || 0;
      const waist = Number(globals.waist_radius_um) || 0;
      const displacement = Number(globals.displacement_um) || 0;
      if (diameter > 0 && waist > 0) {
        lastParams = { waist, displacement, apertureRadius: 0.5 * diameter };
        draw();
      }

      const lossCurve = ctx.result?.plot?.loss_curve || null;
      renderLossCurve(curveHost, lossCurve);
      if (lossCurve) {
        const rangeText = `For fixed D and w, the curve sweeps x from 0 to ${formatMicronValue(
          lossCurve.max_displacement_um,
        )} um.`;
        if (lossCurve.current_point?.visible) {
          curveCopyNode.textContent =
            `${rangeText} The teal marker shows the current x = ${formatMicronValue(
              lossCurve.current_point.x_um,
            )} um.`;
        } else {
          curveCopyNode.textContent =
            `${rangeText} The current x = ${formatMicronValue(
              lossCurve.current_point?.x_um || 0,
            )} um lies outside the plotted range.`;
        }
      } else {
        curveCopyNode.textContent = "The loss curve will appear after the calculator runs.";
      }

      renderMetrics(metricsHost, ctx.result?.plot_metrics || []);
      messages.setMessages(collectStandardMessages(ctx.result));
    }

    function unmount() {
      resizeObserver.disconnect();
      if (typeof Plotly?.purge === "function") Plotly.purge(curveHost);
      workspace.replaceChildren();
    }

    return { update, unmount };
  }

  return { mount };
}
