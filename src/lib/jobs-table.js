/*
 * Rows for the "What do city jobs actually pay?" table, shared by the
 * server-rendered first page and the browser script that re-sorts, filters
 * and pages it. Each job gets a main row plus a hidden detail row that holds
 * its salary chart once expanded.
 *
 * Jobs come from src/data/payroll-jobs.json:
 *   { title, label, employees, fullYearEmployees, base, extra, change, series }
 * employees counts everyone active in the title; the pay medians cover only
 * full-year employees. extra is the median of each person's own overtime plus
 * other pay.
 */
import { money, count, percent } from "./format.js";

export const PAGE_SIZE = 25;

// Column keys double as sort keys. Text sorts A–Z first, numbers high to low.
export const COLUMNS = [
  { key: "label", label: "Job title", text: true },
  { key: "employees", label: "# employees" },
  { key: "base", label: "Median base salary" },
  { key: "extra", label: "Median OT & other pay" },
  { key: "change", label: "5-yr change in base salary" }
];

export const DEFAULT_SORT = { key: "employees", dir: "desc" };

// Missing values (no 5-yr change) always sort last.
export function sortJobs(jobs, { key, dir }) {
  const sign = dir === "asc" ? 1 : -1;
  return jobs.slice().sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    const diff = typeof x === "string" ? x.localeCompare(y) : x - y;
    return sign * diff || a.label.localeCompare(b.label);
  });
}

const dollars = (v) => `$${Math.round(v).toLocaleString("en-US")}`;

const escape = (str) => str.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function changeCell(change, compareYear) {
  if (change == null) {
    return `<span aria-hidden="true">—</span><span class="sr-only">Not available: fewer than 25 employees in FY${compareYear}</span>`;
  }
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "";
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return `${arrow ? `<span class="delta-arrow" aria-hidden="true">${arrow}</span> ` : ""}${sign}${percent(Math.abs(change))}`;
}

// maxExtra scales the inline bar so the largest extra in the list fills the cell.
export function jobRowsHtml(jobs, { maxExtra, compareYear, expanded = new Set() }) {
  return jobs.map((job) => {
    const id = `job-${slug(job.title)}`;
    const open = expanded.has(job.title);
    const bar = job.extra > 0 && maxExtra > 0 ? Math.max(2, (job.extra / maxExtra) * 100) : 0;
    return (
      `<tr class="job-row${open ? " is-open" : ""}" data-title="${escape(job.title)}">` +
        `<th scope="row" data-label="Job title"><button type="button" class="job-toggle" aria-expanded="${open}" aria-controls="${id}">` +
          `<span class="job-chevron" aria-hidden="true"></span><span class="job-name">${escape(job.label)}</span></button></th>` +
        `<td data-col="employees" data-label="Employees">${count(job.employees)}</td>` +
        `<td data-col="base" data-label="Median base" title="${dollars(job.base)}">${money(job.base)}</td>` +
        `<td data-col="extra" data-label="Median OT & other" title="${dollars(job.extra)}">` +
          `<span class="extra-cell"><span class="extra-bar" aria-hidden="true"><span style="width:${bar.toFixed(1)}%"></span></span>${money(job.extra)}</span></td>` +
        `<td data-col="change" data-label="5-yr change">${changeCell(job.change, compareYear)}</td>` +
      "</tr>" +
      `<tr class="job-detail" id="${id}"${open ? "" : " hidden"}><td colspan="${COLUMNS.length}">` +
        `<div class="job-detail-body"><div class="job-chart" data-title="${escape(job.title)}"></div><p class="job-sentence"></p></div>` +
      "</td></tr>"
    );
  }).join("");
}

// Spells out punctuation so "CASE - MANAGEMENT NURSE" and "CASE MANAGEMENT NURSE"
// get different ids.
function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, (c) => `-${c.charCodeAt(0)}`);
}
