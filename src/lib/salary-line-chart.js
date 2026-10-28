/*
 * Small line chart of one job title's median base salary by fiscal year
 * (plain SVG, no library), drawn when a row in the jobs table is expanded.
 *
 * drawSalaryLine(container, job, minEmployees)
 *   container  Empty element to draw into; redraw by calling again.
 *   job        One entry from src/data/payroll-jobs.json. series is
 *              [[fiscalYear, medianBase, fullYearEmployees], ...].
 *   minEmployees  Years with fewer full-year employees get a hollow dot.
 *
 * salarySentence(job) returns the one-line summary shown under the chart.
 */
import { money, count } from "./format.js";
import { niceStep } from "./chart-scale.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export function salarySentence(job, minEmployees = 25) {
  const s = job.series;
  const [fy0, first, n0] = s[0];
  const [fy1, last] = s[s.length - 1];
  if (s.length === 1) return `Median base salary was ${money(last)} in FY${fy1}, the only year with data for this title.`;

  const verb = money(first) === money(last) ? "stayed at" : last > first ? "rose from" : "fell from";
  let text = verb === "stayed at"
    ? `Median base salary stayed at about ${money(last)} from FY${fy0} to FY${fy1}.`
    : `Median base salary ${verb} ${money(first)} in FY${fy0} to ${money(last)} in FY${fy1}.`;
  if (n0 < minEmployees) text += ` FY${fy0} had only ${count(n0)} full-year ${n0 === 1 ? "employee" : "employees"} with this title.`;
  if (s.length < fy1 - fy0 + 1) text += " Some years have no data.";
  return text;
}

export function drawSalaryLine(container, job, minEmployees = 25) {
  const s = job.series;
  const width = Math.max(260, container.clientWidth);
  const height = 170;
  const m = { top: 14, right: 16, bottom: 26, left: 52 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  // Zero baseline so growth isn't exaggerated
  const peak = Math.max(...s.map((p) => p[1]));
  const step = niceStep(peak, 3);
  const max = Math.ceil(peak / step) * step;
  const fy0 = s[0][0];
  const fy1 = s[s.length - 1][0];
  const span = Math.max(1, fy1 - fy0);
  const x = (fy) => m.left + (s.length === 1 ? plotW / 2 : ((fy - fy0) / span) * plotW);
  const y = (v) => m.top + plotH - (v / max) * plotH;

  const values = s.map(([fy, base]) => `FY${fy} ${money(base)}`).join(", ");
  const svg = el("svg", {
    width, height, viewBox: `0 0 ${width} ${height}`,
    class: "line-svg",
    role: "img",
    "aria-label": `Line chart of median base salary for ${job.label} by fiscal year: ${values}.`
  });

  const grid = el("g", { class: "chart-grid", "aria-hidden": "true" }, svg);
  for (let v = 0; v <= max + step / 2; v += step) {
    el("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }, grid);
    const label = el("text", { x: m.left - 8, y: y(v), dy: "0.32em", "text-anchor": "end" }, grid);
    label.textContent = money(v);
  }

  // Years are labeled every other year when space is tight; first and last always.
  const every = plotW / span < 34 ? 2 : 1;
  const shortLabels = plotW / span < 52;
  for (let fy = fy0; fy <= fy1; fy++) {
    const counted = (fy1 - fy) % every === 0 && fy - fy0 >= every; // keeps clear of the first label
    if (fy !== fy0 && fy !== fy1 && !counted) continue;
    const label = el("text", { x: x(fy), y: height - 6, "text-anchor": "middle", class: "x-label" }, grid);
    label.textContent = shortLabels ? `’${String(fy).slice(-2)}` : `FY${fy}`;
  }

  // Break the line where a year is missing
  const g = el("g", { "aria-hidden": "true" }, svg);
  let d = "";
  s.forEach(([fy, base], i) => {
    d += `${i && fy === s[i - 1][0] + 1 ? "L" : "M"}${x(fy).toFixed(1)},${y(base).toFixed(1)}`;
  });
  el("path", { d, class: "salary-line" }, g);

  s.forEach(([fy, base, n]) => {
    const dot = el("circle", { cx: x(fy), cy: y(base), r: 3.5, class: n < minEmployees ? "salary-dot is-small" : "salary-dot" }, g);
    el("title", {}, dot).textContent =
      `FY${fy}: ${money(base)} median base salary (${count(n)} full-year ${n === 1 ? "employee" : "employees"})`;
  });

  const [, lastBase] = s[s.length - 1];
  const end = el("text", { x: x(fy1), y: y(lastBase) - 10, "text-anchor": s.length === 1 ? "middle" : "end", class: "salary-end" }, g);
  end.textContent = money(lastBase);

  container.replaceChildren(svg);
  return s.some((p) => p[2] < minEmployees);
}
