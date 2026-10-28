/*
 * Stacked bar chart of city payroll by fiscal year (plain SVG, no library).
 *
 * mountWorkforceChart(frame, years, subject)
 *   frame    The chart's <figure>. Must contain .chart (drawing area),
 *            .chart-tooltip and the .toggle-btn[data-mode] buttons.
 *   years    Rows from src/data/payroll-by-year.json (or one agency's rows
 *            from payroll-by-agency.json, same shape).
 *   subject  Whose payroll this is, for the screen reader summary.
 * Returns { update(years, subject) } to redraw with different data.
 *
 * Keyboard: the chart is one tab stop; Left/Right/Home/End move between
 * years and show that year's details. Escape hides them.
 */
import { money, count, percent } from "./format.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Bottom-to-top stacking order. Colors live in dashboard.css (.seg-*).
const SEGMENTS = [
  { key: "regular", label: "Regular pay" },
  { key: "overtime", label: "Overtime" },
  { key: "other", label: "Other pay" }
];

let instance = 0;

export function mountWorkforceChart(frame, initialYears, initialSubject = "NYC payroll") {
  const chart = frame.querySelector(".chart");
  const tooltip = frame.querySelector(".chart-tooltip");
  const buttons = Array.from(frame.querySelectorAll(".toggle-btn[data-mode]"));
  const hatchId = `pay-other-hatch-${++instance}`;

  let years = initialYears;
  let subject = initialSubject;
  let mode = "dollars";
  let active = years.length - 1; // keyboard focus starts on the latest year
  let svg = null;

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      hideTooltip();
      render();
    });
  });

  // ---------- Scales ----------
  function niceStep(max, targetTicks) {
    const raw = max / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    return step;
  }

  function scaleFor(height) {
    if (mode === "share") return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => percent(v, 0) };
    const peak = Math.max(1, ...years.map((y) => y.total)); // tiny agencies can net to $0 or less
    const step = niceStep(peak, height < 320 ? 4 : 5);
    const max = Math.ceil(peak / step) * step;
    const ticks = [];
    for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
    return { max, ticks, fmt: tickMoney };
  }

  // $B citywide, $M/$K for small agencies. Two decimals so a $1.25M tick
  // isn't shown as $1.3M, minus a trailing zero ($2.50B → $2.5B).
  function tickMoney(v) {
    return v === 0 ? "$0" : money(v, 2).replace(/(\.\d)0(?=[BM]$)/, "$1");
  }

  function value(year, key) {
    const v = Math.max(0, year[key]); // yearly sums are positive; guard the stack anyway
    return mode === "share" ? share(v, year.total) : v;
  }

  function share(part, total) {
    return total > 0 ? part / total : 0;
  }

  // ---------- Drawing ----------
  function el(name, attrs = {}, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function render() {
    const width = Math.max(280, chart.clientWidth);
    const height = width < 480 ? 300 : 380;
    const scale = scaleFor(height);
    const m = { top: 12, right: 4, bottom: 30, left: mode === "share" ? 44 : 52 };
    const plotW = width - m.left - m.right;
    const plotH = height - m.top - m.bottom;
    const band = plotW / years.length;
    const barW = Math.min(56, band * 0.7);
    const y = (v) => m.top + plotH - (v / scale.max) * plotH;

    if (svg) svg.remove();
    svg = el("svg", {
      width, height, viewBox: `0 0 ${width} ${height}`,
      class: "chart-svg",
      role: "application",
      tabindex: "0",
      "aria-roledescription": "bar chart",
      "aria-label": summaryLabel()
    });

    const defs = el("defs", {}, svg);
    const pattern = el("pattern", {
      id: hatchId, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)"
    }, defs);
    el("rect", { width: 6, height: 6, class: "seg-other" }, pattern);
    el("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hatch-line" }, pattern);

    // Gridlines + y-axis labels
    const grid = el("g", { class: "chart-grid", "aria-hidden": "true" }, svg);
    scale.ticks.forEach((t) => {
      el("line", { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t) }, grid);
      const label = el("text", { x: m.left - 8, y: y(t), dy: "0.32em", "text-anchor": "end" }, grid);
      label.textContent = scale.fmt(t);
    });

    // Bars
    const labelEvery = band < 26 ? 2 : 1;
    const shortLabels = band < 48;
    const bars = el("g", { class: "chart-bars" }, svg);

    years.forEach((year, i) => {
      const cx = m.left + band * i + band / 2;
      const g = el("g", { class: "bar", "data-index": i, "aria-hidden": "true" }, bars);

      // Full-height hit area so thin bars are easy to hover and tap
      el("rect", { x: m.left + band * i, y: m.top, width: band, height: plotH, class: "bar-hit" }, g);

      let base = 0;
      SEGMENTS.forEach((seg) => {
        const v = value(year, seg.key);
        const top = y(base + v);
        el("rect", {
          x: cx - barW / 2, y: top, width: barW, height: Math.max(0, y(base) - top),
          class: `seg seg-${seg.key}`,
          // Inline style: a fill attribute would lose to the .seg-other CSS rule
          ...(seg.key === "other" ? { style: `fill: url(#${hatchId})` } : {})
        }, g);
        base += v;
      });

      if ((years.length - 1 - i) % labelEvery === 0) {
        const label = el("text", { x: cx, y: height - 8, "text-anchor": "middle", class: "x-label" }, g);
        label.textContent = shortLabels ? `’${String(year.fiscalYear).slice(-2)}` : `FY${year.fiscalYear}`;
      }

      g.addEventListener("pointerenter", () => show(i));
      g.addEventListener("pointerdown", () => show(i));
    });

    // Baseline
    el("line", { x1: m.left, x2: width - m.right, y1: y(0), y2: y(0), class: "chart-baseline", "aria-hidden": "true" }, svg);

    svg.addEventListener("pointerleave", hideTooltip);
    svg.addEventListener("keydown", onKey);
    svg.addEventListener("focus", () => show(active));
    svg.addEventListener("blur", hideTooltip);

    chart.insertBefore(svg, tooltip);
  }

  function summaryLabel() {
    const first = years[0];
    const last = years[years.length - 1];
    const what = mode === "share" ? "share of total pay by type" : "total pay in dollars";
    return `Stacked bar chart of ${subject}, ${what}, FY${first.fiscalYear} to FY${last.fiscalYear}. ` +
      `Total pay went from ${money(first.total)} to ${money(last.total)}. ` +
      "Use the left and right arrow keys to hear each year.";
  }

  // ---------- Tooltip ----------
  function show(i) {
    active = i;
    const year = years[i];
    const g = svg.querySelector(`.bar[data-index="${i}"]`);
    svg.querySelectorAll(".bar").forEach((b) => b.classList.toggle("is-dim", b !== g));

    tooltip.innerHTML =
      `<p class="tt-title">FY${year.fiscalYear}</p>` +
      '<table class="tt-table"><tbody>' +
      SEGMENTS.slice().reverse().map((seg) =>
        `<tr><th scope="row"><span class="swatch swatch-${seg.key}" aria-hidden="true"></span>${seg.label}</th>` +
        `<td>${money(year[seg.key])}</td><td class="tt-share">${percent(share(year[seg.key], year.total))}</td></tr>`
      ).join("") +
      `<tr class="tt-total"><th scope="row">Total</th><td>${money(year.total)}</td><td class="tt-share">100%</td></tr>` +
      "</tbody></table>" +
      `<p class="tt-people">${count(year.peoplePaid)} people paid</p>`;
    tooltip.hidden = false;

    // Position beside the bar, kept inside the chart box
    const chartBox = chart.getBoundingClientRect();
    const barBox = g.querySelector(".seg-regular").getBoundingClientRect();
    const tipW = tooltip.offsetWidth;
    let left = barBox.right - chartBox.left + 8;
    if (left + tipW > chartBox.width) left = barBox.left - chartBox.left - tipW - 8;
    tooltip.style.left = `${Math.max(0, left)}px`;
    tooltip.style.top = "8px";
  }

  function hideTooltip() {
    tooltip.hidden = true;
    if (svg) svg.querySelectorAll(".bar").forEach((b) => b.classList.remove("is-dim"));
  }

  function onKey(e) {
    const last = years.length - 1;
    const next = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: last }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      show(Math.min(last, Math.max(0, next)));
    } else if (e.key === "Escape") {
      hideTooltip();
    }
  }

  // ---------- Init ----------
  render();
  let lastWidth = chart.clientWidth;
  new ResizeObserver(() => {
    if (chart.clientWidth !== lastWidth) {
      lastWidth = chart.clientWidth;
      hideTooltip();
      render();
    }
  }).observe(chart);

  return {
    update(nextYears, nextSubject) {
      years = nextYears;
      subject = nextSubject;
      active = years.length - 1;
      hideTooltip();
      render();
    }
  };
}
