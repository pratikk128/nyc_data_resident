/*
 * Charts for the drinking water dashboard (plain SVG, no library, like the
 * payroll charts). Browser only.
 *
 * mountMonthlyLine(frame, opts)  A line over every month of the history, with
 *   gaps where a month has no data, an optional shaded band and reference line,
 *   and optional point markers (E. coli). Hover, tap or arrow keys show a
 *   month's details in the frame's .chart-tooltip.
 *   frame: the chart's <figure>, containing .chart and .chart-tooltip.
 *   opts: {
 *     months:   ["2015-01", ...] every month from first to last, gaps included
 *     values:   { "2015-01": number | null }
 *     yMax:     top of the axis; ticks: values for gridlines; fmt: tick label
 *     band:     { from, to, label } shaded "normal range" (clipped to the axis)
 *     ref:      { value, label } dashed reference line (drawn if within yMax)
 *     markers:  { "2017-05": "label" } months to mark with a point on the line
 *     summary:  aria-label text
 *     tooltip:  (month) => HTML for that month
 *   }
 *
 * drawSparkline(container, values, cityValues, { fmt, label })  12 small points.
 */
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

export function mountMonthlyLine(frame, opts) {
  const chart = frame.querySelector(".chart");
  const tooltip = frame.querySelector(".chart-tooltip");
  let active = null;
  let geom = null;

  function render() {
    const { months, values, yMax, ticks, fmt, band, ref, markers = {} } = opts;
    const width = Math.max(280, chart.clientWidth);
    const narrow = width < 520;
    const height = narrow ? 220 : 280;
    const m = { top: 16, right: 12, bottom: 28, left: narrow ? 40 : 48 };
    const plotW = width - m.left - m.right;
    const plotH = height - m.top - m.bottom;
    const x = (i) => m.left + (months.length === 1 ? plotW / 2 : (i / (months.length - 1)) * plotW);
    const y = (v) => m.top + plotH - (Math.min(v, yMax) / yMax) * plotH;

    const svg = el("svg", {
      width, height, viewBox: `0 0 ${width} ${height}`, class: "chart-svg water-line-svg",
      role: "img", tabindex: "0", "aria-label": opts.summary
    });

    if (band) {
      const top = y(Math.min(band.to, yMax)), bottom = y(Math.max(band.from, 0));
      el("rect", { x: m.left, y: top, width: plotW, height: Math.max(0, bottom - top), class: "water-band", "aria-hidden": "true" }, svg);
      const t = el("text", { x: m.left + plotW - 6, y: top + 14, "text-anchor": "end", class: "water-band-label", "aria-hidden": "true" }, svg);
      t.textContent = band.label;
    }

    const grid = el("g", { class: "chart-grid", "aria-hidden": "true" }, svg);
    for (const v of ticks) {
      el("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }, grid);
      const label = el("text", { x: m.left - 6, y: y(v), dy: "0.32em", "text-anchor": "end" }, grid);
      label.textContent = fmt(v);
    }
    // A label each January (every 2nd or 3rd year when narrow).
    const every = plotW / (months.length / 12) < 40 ? 3 : plotW / (months.length / 12) < 64 ? 2 : 1;
    months.forEach((k, i) => {
      const yr = Number(k.slice(0, 4));
      if (!k.endsWith("-01") || (yr - Number(months[0].slice(0, 4))) % every) return;
      const t = el("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "x-label" }, grid);
      t.textContent = every > 1 || narrow ? `’${String(yr).slice(-2)}` : String(yr);
    });

    if (ref && ref.value <= yMax) {
      el("line", { x1: m.left, x2: width - m.right, y1: y(ref.value), y2: y(ref.value), class: "water-ref", "aria-hidden": "true" }, svg);
      const t = el("text", { x: m.left + 6, y: y(ref.value) - 6, class: "water-ref-label", "aria-hidden": "true" }, svg);
      t.textContent = ref.label;
    }

    const g = el("g", { "aria-hidden": "true" }, svg);
    const pts = months.map((k, i) => (values[k] == null ? null : [x(i), y(values[k])]));
    el("path", { d: linePath(pts), class: "water-line" }, g);
    // Lone months between gaps would be invisible as a line; give them a dot.
    pts.forEach((p, i) => {
      if (p && !pts[i - 1] && !pts[i + 1]) el("circle", { cx: p[0], cy: p[1], r: 2.5, class: "water-dot" }, g);
    });
    for (const [k] of Object.entries(markers)) {
      const i = months.indexOf(k);
      if (i < 0 || values[k] == null) continue;
      el("circle", { cx: x(i), cy: y(values[k]), r: 6, class: "water-marker" }, g);
    }

    const focus = el("g", { class: "water-focus", "aria-hidden": "true", visibility: "hidden" }, svg);
    el("line", { y1: m.top, y2: m.top + plotH, class: "water-focus-line" }, focus);
    el("circle", { r: 4.5, class: "water-focus-dot" }, focus);

    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left - m.left) / plotW) * (months.length - 1));
      show(Math.max(0, Math.min(months.length - 1, i)));
    });
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    svg.addEventListener("keydown", (e) => {
      const last = months.length - 1;
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (step) show(Math.max(0, Math.min(last, (active ?? last + (step < 0 ? 1 : -1)) + step)));
      else if (e.key === "Home") show(0);
      else if (e.key === "End") show(last);
      else if (e.key === "Escape") hide();
      else return;
      e.preventDefault();
    });
    svg.addEventListener("blur", hide);

    geom = { x, y, focus, width, m, plotH };
    chart.querySelector("svg")?.remove();
    chart.prepend(svg);
    if (active != null) show(active);
  }

  function show(i) {
    active = i;
    const k = opts.months[i];
    const v = opts.values[k];
    const { x, y, focus, width } = geom;
    focus.setAttribute("visibility", "visible");
    focus.querySelector("line").setAttribute("x1", x(i));
    focus.querySelector("line").setAttribute("x2", x(i));
    const dot = focus.querySelector("circle");
    dot.setAttribute("visibility", v == null ? "hidden" : "visible");
    if (v != null) { dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(v)); }
    tooltip.innerHTML = opts.tooltip(k);
    tooltip.hidden = false;
    const left = x(i) > width / 2 ? x(i) - tooltip.offsetWidth - 12 : x(i) + 12;
    tooltip.style.left = `${Math.max(0, left)}px`;
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

/*
 * values / cityValues: 12 numbers (or null) oldest first. The station's line
 * in ink, the citywide median dashed; the last value labeled.
 */
export function drawSparkline(container, values, cityValues, { fmt, label }) {
  const width = Math.max(140, Math.min(260, container.clientWidth || 200));
  const height = 48;
  const m = { top: 6, right: 40, bottom: 6, left: 4 };
  const all = [...values, ...cityValues].filter((v) => v != null);
  const max = Math.max(...all, 0.01) * 1.1;
  const x = (i) => m.left + (i / (values.length - 1)) * (width - m.left - m.right);
  const y = (v) => m.top + (height - m.top - m.bottom) * (1 - v / max);

  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "water-spark", role: "img", "aria-label": label });
  el("path", { d: linePath(cityValues.map((v, i) => (v == null ? null : [x(i), y(v)]))), class: "water-spark-city" }, svg);
  const pts = values.map((v, i) => (v == null ? null : [x(i), y(v)]));
  el("path", { d: linePath(pts), class: "water-spark-line" }, svg);
  pts.forEach((p, i) => { if (p && !pts[i - 1] && !pts[i + 1]) el("circle", { cx: p[0], cy: p[1], r: 2, class: "water-spark-dot" }, svg); });
  const lastI = values.findLastIndex((v) => v != null);
  if (lastI >= 0) {
    el("circle", { cx: x(lastI), cy: y(values[lastI]), r: 3, class: "water-spark-dot" }, svg);
    const t = el("text", { x: x(lastI) + 6, y: y(values[lastI]), dy: "0.32em", class: "water-spark-end" }, svg);
    t.textContent = fmt(values[lastI]);
  }
  container.replaceChildren(svg);
}
