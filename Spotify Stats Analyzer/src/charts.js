import { formatPlaytime } from "./analysis.js";

const UNIFIED_CHART_PADDING_LEFT = 104;
const UNIFIED_CHART_PADDING_RIGHT = 24;
const UNIFIED_CHART_PADDING_TOP = 22;
const UNIFIED_CHART_PADDING_BOTTOM = 72;
const UNIFIED_CHART_PADDING_BOTTOM_TILTED = 100;
const UNIFIED_CHART_PLOT_HEIGHT = 276;
const COMPACT_CHART_MIN_WIDTH = 520;

export function renderTemporalCharts(chartData = {}) {
  document.querySelectorAll("[data-chart-key]").forEach((shell) => {
    const chartKey = shell.dataset.chartKey || "";
    const entries = chartData[chartKey] || [];
    renderListeningActivityChart(shell, entries, chartKey);
  });
}

function renderListeningActivityChart(container, entries, chartKey) {
  if (!entries.length || entries.every((entry) => entry.playtime_ms === 0)) {
    container.innerHTML = '<p class="chart-empty">No chart data available for this range.</p>';
    return;
  }

  const gridColor = getThemeColor("--chart-grid", "rgba(173, 231, 198, 0.12)");
  const axisColor = getThemeColor("--chart-axis", "#8ba197");
  const labelColor = getThemeColor("--chart-label", "#d9e9e0");
  const labelOutlineColor = getThemeColor("--surface-deep", "rgba(3, 11, 8, 0.94)");
  const barColor = getThemeColor("--bar", "#39d87a");
  const xAxisFontSize = chartKey === "hourly" ? 9 : 11;
  const yAxisFontSize = 12;
  const visibleLabelStep = getXAxisLabelStep(chartKey, entries.length);
  const longestVisibleXAxisLabel = entries.reduce((maxLength, entry, index) => {
    if (!shouldRenderXAxisLabel(index, chartKey, visibleLabelStep)) {
      return maxLength;
    }

    return Math.max(maxLength, String(entry.label || "").length);
  }, 0);
  const shouldTiltLabels = chartKey !== "hourly" && longestVisibleXAxisLabel > 4 && entries.length > 10;
  const slotWidth = getSlotWidth(chartKey, entries.length, longestVisibleXAxisLabel, shouldTiltLabels);
  const maxPlaytime = Math.max(...entries.map((entry) => entry.playtime_ms), 1);
  const tickCount = 4;
  const tickLabels = Array.from({ length: tickCount + 1 }, (_, tick) => {
    return formatPlaytime((maxPlaytime * tick) / tickCount);
  });
  const padding = {
    top: UNIFIED_CHART_PADDING_TOP,
    right: UNIFIED_CHART_PADDING_RIGHT,
    bottom: shouldTiltLabels ? UNIFIED_CHART_PADDING_BOTTOM_TILTED : UNIFIED_CHART_PADDING_BOTTOM,
    left: UNIFIED_CHART_PADDING_LEFT,
  };
  const plotHeight = UNIFIED_CHART_PLOT_HEIGHT;
  const minimumChartWidth = getMinimumChartWidth();
  const width = Math.max(minimumChartWidth, padding.left + padding.right + entries.length * slotWidth);
  const height = padding.top + plotHeight + padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const groupWidth = plotWidth / entries.length;
  const barWidth = chartKey === "hourly"
    ? Math.max(6, Math.min(12, groupWidth * 0.45))
    : Math.max(10, Math.min(22, groupWidth * 0.5));

  const markup = [
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Playtime bar chart">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>`,
  ];

  for (let tick = 0; tick <= tickCount; tick += 1) {
    const ratio = tick / tickCount;
    const y = padding.top + plotHeight - ratio * plotHeight;

    markup.push(
      `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${escapeHtml(gridColor)}" stroke-width="1"></line>`,
      `<text x="${padding.left - 10}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="${yAxisFontSize}" font-weight="600" fill="${escapeHtml(axisColor)}">${escapeHtml(tickLabels[tick])}</text>`,
    );
  }

  markup.push(
    `<line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="${escapeHtml(axisColor)}" stroke-width="1"></line>`,
    `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="${escapeHtml(axisColor)}" stroke-width="1"></line>`,
  );

  entries.forEach((entry, index) => {
    const groupCenter = padding.left + groupWidth * index + groupWidth / 2;
    const barHeight = (entry.playtime_ms / maxPlaytime) * plotHeight;
    const x = groupCenter - barWidth / 2;
    const y = padding.top + plotHeight - barHeight;
    const labelY = padding.top + plotHeight + (shouldTiltLabels ? 24 : 18);
    const tooltip = [
      `${entry.label}: ${formatPlaytime(entry.playtime_ms)} playtime`,
      `${entry.play_count.toLocaleString()} plays`,
    ].join(" | ");
    const labelAttributes = shouldTiltLabels
      ? `text-anchor="end" transform="rotate(-32 ${groupCenter} ${labelY})"`
      : 'text-anchor="middle"';

    markup.push(
      "<g>",
      `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(barHeight, 0)}" rx="5" fill="${escapeHtml(barColor)}">`,
      `<title>${escapeHtml(tooltip)}</title>`,
      "</rect>",
      renderXAxisLabel({
        chartKey,
        entry,
        index,
        groupCenter,
        labelY,
        labelAttributes,
        xAxisFontSize,
        labelColor,
        labelOutlineColor,
        visibleLabelStep,
      }),
      "</g>",
    );
  });

  markup.push("</svg>");
  container.innerHTML = markup.join("");
}

function renderXAxisLabel({
  chartKey,
  entry,
  index,
  groupCenter,
  labelY,
  labelAttributes,
  xAxisFontSize,
  labelColor,
  labelOutlineColor,
  visibleLabelStep,
}) {
  if (!shouldRenderXAxisLabel(index, chartKey, visibleLabelStep)) {
    return "";
  }

  return `<text x="${groupCenter}" y="${labelY}" ${labelAttributes} dominant-baseline="hanging" font-size="${xAxisFontSize}" font-weight="600" fill="${escapeHtml(labelColor)}" paint-order="stroke" stroke="${escapeHtml(labelOutlineColor)}" stroke-width="3" stroke-linejoin="round">${escapeHtml(entry.label)}</text>`;
}

function getXAxisLabelStep(chartKey, entryCount) {
  if (chartKey === "hourly") {
    return 3;
  }

  if (entryCount > 18) {
    return 2;
  }

  return 1;
}

function shouldRenderXAxisLabel(index, chartKey, visibleLabelStep) {
  if (chartKey === "hourly") {
    return index % visibleLabelStep === 0;
  }

  return index % visibleLabelStep === 0;
}

function getSlotWidth(chartKey, entryCount, longestVisibleXAxisLabel, shouldTiltLabels) {
  if (chartKey === "hourly") {
    return 16;
  }

  if (chartKey === "monthly") {
    return 34;
  }

  if (chartKey === "weekday") {
    return 44;
  }

  if (shouldTiltLabels) {
    return Math.max(48, Math.min(64, longestVisibleXAxisLabel * 7 + 14));
  }

  if (entryCount > 16) {
    return Math.max(44, Math.min(56, longestVisibleXAxisLabel * 8 + 10));
  }

  return Math.max(56, Math.min(72, longestVisibleXAxisLabel * 9 + 16));
}

function getMinimumChartWidth() {
  return COMPACT_CHART_MIN_WIDTH;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getThemeColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
