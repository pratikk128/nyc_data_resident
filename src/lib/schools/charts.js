/*
 * "Performance over time" charts for a school page (plain SVG, no library,
 * like the drinking water charts). Browser only.
 *
 * mountYearChart(frame, opts)  The school's value each school year (line and
 *   dots) and the NYC average (dashed). Years without a value break the line
 *   and are shaded with "No data"; a seriesBreak draws a dashed rule where
 *   the measure changed. Hover, tap or arrow keys show a year in the frame's
 *   .chart-tooltip; arrow keys also read it out through .chart-live.
 *   frame: the chart's <figure>, containing .chart, .chart-tooltip, .chart-live
 *   and (optional) .sq-axis-note for "Axis starts at 60%".
 *   opts: {
 *     metric:   the METRICS entry (format, label)
 *     years:    [2015, ...] every school year in the report's span
 *     values:   { [year]: number | null }   the school
 *     city:     { [year]: number | null }   NYC average (may be empty)
 *     gaps:     [{ year, reason }]
 *     seriesBreak: { year, note } | undefined
 *     summary:  aria-label text
 *     tooltip:  (year) => HTML
 *   }
 */
import { formatTick } from "./values.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// Path through the points, broken where a value is missing.
function linePath(points) {
  let d = "", pen = false;
  for (const p of points) {
    if (p == null) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

/*
 * The y axis for a metric's values: { lo, hi, ticks, truncated }.
 * Percents zoom to the data in 10-point steps (and say so when the axis
 * doesn't start at 0); changes are centered on 0; counts start at 0.
 */
export function yDomain(metric, values) {
  const vs = values.filter((v) => v != null);
  if (!vs.length) return { lo: 0, hi: 1, ticks: [0, 0.5, 1], truncated: false };
  const min = Math.min(...vs), max = Math.max(...vs);
  if (metric.format === "points") {
    const m = Math.max(0.02, Math.ceil((Math.max(Math.abs(min), Math.abs(max)) + 0.005) * 50) / 50);
    return { lo: -m, hi: m, ticks: [-m, 0, m], truncated: false };
  }
  if (metric.format === "count") {
    const step = 10 ** Math.floor(Math.log10(Math.max(max, 10)));
    const hi = Math.ceil((max * 1.1) / step) * step;
    return { lo: 0, hi, ticks: [0, hi / 2, hi], truncated: false };
  }
  let lo = Math.max(0, Math.floor((min - 0.05) * 10) / 10);
  const hi = Math.min(1, Math.ceil((max + 0.05) * 10) / 10);
  if (hi - lo < 0.3) lo = Math.max(0, hi - 0.3);
  lo = Math.round(lo * 10) / 10;
  const step = hi - lo > 0.6 ? 0.2 : 0.1;
  const ticks = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return { lo, hi, ticks, truncated: lo > 0 };
}

export function mountYearChart(frame, opts) {
  const chart = frame.querySelector(".chart");
  const tooltip = frame.querySelector(".chart-tooltip");
  const live = frame.querySelector(".chart-live");
  const axisNote = frame.querySelector(".sq-axis-note");
  let active = null;
  let geom = null;

  function render() {
    const { metric, years, values, city = {}, gaps = [], seriesBreak } = opts;
    const width = Math.max(260, chart.clientWidth);
    const narrow = width < 480;
    const height = narrow ? 200 : 230;
    const m = { top: 18, right: 14, bottom: 28, left: narrow ? 42 : 48 };
    const plotW = width - m.left - m.right;
    const plotH = height - m.top - m.bottom;
    const domain = yDomain(metric, [...years.map((y) => values[y]), ...years.map((y) => city[y])]);
    const step = years.length > 1 ? plotW / (years.length - 1) : plotW;
    const x = (i) => m.left + (years.length === 1 ? plotW / 2 : i * step);
    const y = (v) => m.top + plotH - ((Math.min(Math.max(v, domain.lo), domain.hi) - domain.lo) / (domain.hi - domain.lo)) * plotH;

    if (axisNote) {
      axisNote.hidden = !domain.truncated;
      axisNote.textContent = domain.truncated ? `The axis starts at ${formatTick(metric, domain.lo)}, not 0.` : "";
    }

    const svg = el("svg", {
      width, height, viewBox: `0 0 ${width} ${height}`, class: "chart-svg sq-chart-svg",
      role: "img", tabindex: "0", "aria-label": opts.summary
    });

    // No-data years: a hatched band the width of one year.
    const gapLayer = el("g", { "aria-hidden": "true" }, svg);
    for (const g of gaps) {
      const i = years.indexOf(g.year);
      if (i < 0) continue;
      const w = Math.min(step, plotW);
      el("rect", { x: x(i) - w / 2, y: m.top, width: w, height: plotH, class: "sq-gap" }, gapLayer);
      if (w >= 36) {
        const t = el("text", { x: x(i), y: m.top + 12, "text-anchor": "middle", class: "sq-gap-label" }, gapLayer);
        t.textContent = "No data";
      }
    }

    const grid = el("g", { class: "chart-grid", "aria-hidden": "true" }, svg);
    for (const v of domain.ticks) {
      el("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v), class: v === 0 && metric.format === "points" ? "sq-zero" : "" }, grid);
      const label = el("text", { x: m.left - 6, y: y(v), dy: "0.32em", "text-anchor": "end" }, grid);
      label.textContent = formatTick(metric, v);
    }
    // One label per school year ("24–25" when tight, never "’24", which reads as either year), every other one when tighter.
    const every = step < 40 ? 2 : 1;
    years.forEach((yr, i) => {
      if ((years.length - 1 - i) % every) return;
      const t = el("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "x-label" }, grid);
      t.textContent = step < 56 ? `${String(yr).slice(-2)}–${String(yr + 1).slice(-2)}` : `${yr}–${String(yr + 1).slice(-2)}`;
    });

    if (seriesBreak && years.includes(seriesBreak.year) && years.indexOf(seriesBreak.year) > 0) {
      const bx = x(years.indexOf(seriesBreak.year)) - step / 2;
      el("line", { x1: bx, x2: bx, y1: m.top - 6, y2: m.top + plotH, class: "sq-break" }, svg);
      const t = el("text", { x: bx + 4, y: m.top - 6, class: "sq-break-label", "aria-hidden": "true" }, svg);
      t.textContent = "New measure";
    }

    const g = el("g", { "aria-hidden": "true" }, svg);
    const cityPts = years.map((yr, i) => (city[yr] == null ? null : [x(i), y(city[yr])]));
    el("path", { d: linePath(cityPts), class: "sq-city-line" }, g);
    const pts = years.map((yr, i) => (values[yr] == null ? null : [x(i), y(values[yr])]));
    el("path", { d: linePath(pts), class: "sq-line" }, g);
    pts.forEach((p) => { if (p) el("circle", { cx: p[0], cy: p[1], r: 3.5, class: "sq-dot" }, g); });

    const focus = el("g", { class: "sq-focus", "aria-hidden": "true", visibility: "hidden" }, svg);
    el("line", { y1: m.top, y2: m.top + plotH, class: "sq-focus-line" }, focus);
    el("circle", { r: 5.5, class: "sq-focus-dot" }, focus);

    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const i = years.length === 1 ? 0 : Math.round((e.clientX - r.left - m.left) / step);
      show(Math.max(0, Math.min(years.length - 1, i)));
    });
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    svg.addEventListener("keydown", (e) => {
      const last = years.length - 1;
      const delta = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (delta) show(Math.max(0, Math.min(last, (active ?? last + (delta < 0 ? 1 : -1)) + delta)), true);
      else if (e.key === "Home") show(0, true);
      else if (e.key === "End") show(last, true);
      else if (e.key === "Escape") hide();
      else return;
      e.preventDefault();
    });
    svg.addEventListener("blur", hide);

    geom = { x, y, focus, width };
    chart.querySelector("svg")?.remove();
    chart.prepend(svg);
    if (active != null) show(active);
  }

  function show(i, announce = false) {
    active = i;
    const yr = opts.years[i];
    const v = opts.values[yr];
    const { x, y, focus, width } = geom;
    focus.setAttribute("visibility", "visible");
    focus.querySelector("line").setAttribute("x1", x(i));
    focus.querySelector("line").setAttribute("x2", x(i));
    const dot = focus.querySelector("circle");
    dot.setAttribute("visibility", v == null ? "hidden" : "visible");
    if (v != null) { dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(v)); }
    tooltip.innerHTML = opts.tooltip(yr);
    tooltip.hidden = false;
    if (announce && live) {
      live.textContent = [...tooltip.querySelectorAll(".tt-title, .tt-note, tr")]
        .map((n) => (n.matches("tr") ? [...n.children].map((c) => c.textContent).join(": ") : n.textContent))
        .join(". ");
    }
    const left = x(i) > width / 2 ? x(i) - tooltip.offsetWidth - 12 : x(i) + 12;
    tooltip.style.left = `${Math.max(0, Math.min(left, width - tooltip.offsetWidth))}px`;
    tooltip.style.top = "8px";
  }

  function hide() {
    active = null;
    geom?.focus.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  }

  render();
  let width = chart.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(chart.clientWidth - width) < 2) return;
    width = chart.clientWidth;
    render();
  }).observe(chart);
}
