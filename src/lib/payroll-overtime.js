/*
 * "Who depends on overtime?" (src/components/city-payroll/OvertimeSection.astro):
 * how overtime is spread across agencies in one fiscal year. agencies are
 * byAgency.agencies from the payroll data.
 */
import { money, percent } from "./format.js";

export const MIN_AGENCY_PAYROLL = 50e6; // smaller agencies' shares swing on a few people
export const TOP_DEPENDENT = 10;
export const TOP_SHARE_AGENCIES = 5;

function rowsFor(agencies, fiscalYear) {
  return agencies.flatMap((a) => {
    const y = a.years.find((y) => y.fiscalYear === fiscalYear);
    return y ? [{ id: a.id, label: a.label, overtime: y.overtime, total: y.total }] : [];
  });
}

// Agencies with at least MIN_AGENCY_PAYROLL that year, by overtime as a share
// of their own payroll, largest first: [{ id, label, overtime, total, share }].
export function overtimeDependence(agencies, fiscalYear) {
  return rowsFor(agencies, fiscalYear)
    .filter((r) => r.total >= MIN_AGENCY_PAYROLL)
    .map((r) => ({ ...r, share: Math.max(0, r.overtime) / r.total }))
    .sort((a, b) => b.share - a.share || a.label.localeCompare(b.label));
}

// The n agencies that paid the most overtime, and their share of all of it:
// { agencies: [{ id, label, overtime }], overtime, cityOvertime, share }.
export function overtimeLeaders(agencies, fiscalYear, n = TOP_SHARE_AGENCIES) {
  const rows = rowsFor(agencies, fiscalYear).sort((a, b) => b.overtime - a.overtime);
  const cityOvertime = rows.reduce((sum, r) => sum + Math.max(0, r.overtime), 0);
  const top = rows.slice(0, n);
  const overtime = top.reduce((sum, r) => sum + r.overtime, 0);
  return { agencies: top, overtime, cityOvertime, share: cityOvertime > 0 ? overtime / cityOvertime : 0 };
}

export function dependenceHtml(ranked) {
  const top = ranked.slice(0, TOP_DEPENDENT);
  const max = Math.max(0.01, ...top.map((r) => r.share));
  return top.map((r, i) =>
    `<li class="rank-row"><span class="rank-n">${i + 1}</span>` +
    `<a class="rank-name" href="/city-payroll/?agency=${encodeURIComponent(r.id)}#workforce">${escapeHtml(r.label)}</a>` +
    `<span class="rank-value">${percent(r.share)} <span class="rank-share">${money(r.overtime)} of ${money(r.total)}</span></span>` +
    `<span class="rank-bar" aria-hidden="true"><span class="rank-seg rank-seg-overtime" style="width:${((r.share / max) * 100).toFixed(2)}%"></span></span></li>`
  ).join("");
}

function escapeHtml(str) {
  return str.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
