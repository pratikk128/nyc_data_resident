/*
 * Top agencies by payroll in one fiscal year, shared by the server-rendered
 * list (all pay types) and the page script (which re-ranks it when pay types
 * or the picked agency change).
 *
 * rows: [{ id, label, regular, overtime, other }] for one fiscal year.
 * Ranked by the sum of the selected pay types, so "Overtime" alone gives the
 * agencies that paid the most overtime. Bars stack the selected pay types in
 * the same order and colors as the workforce chart.
 */
import { money, percent } from "./format.js";

const PAY_KEYS = ["regular", "overtime", "other"];
export const TOP_N = 10;

const sumOf = (row, keys) => keys.reduce((acc, k) => acc + row[k], 0);

// Every agency in rank order with its amount for the selected pay types.
export function rankAgencies(rows, payTypes = PAY_KEYS) {
  const keys = PAY_KEYS.filter((k) => payTypes.includes(k));
  return rows
    .map((row) => ({ ...row, amount: sumOf(row, keys) }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

export function agencyRankingHtml(ranked, payTypes = PAY_KEYS, currentId = "") {
  const keys = PAY_KEYS.filter((k) => payTypes.includes(k));
  const cityTotal = ranked.reduce((acc, r) => acc + r.amount, 0);
  const top = ranked.slice(0, TOP_N);
  const max = Math.max(1, ...top.map((r) => r.amount));
  return top.map((r, i) => {
    // Negative pay types (refunds, corrections) are left out of the bar, not the amount.
    const segs = keys.map((k) => {
      const width = (Math.max(0, r[k]) / max) * 100;
      return width > 0 ? `<span class="rank-seg rank-seg-${k}" style="width:${width.toFixed(2)}%"></span>` : "";
    }).join("");
    const share = cityTotal > 0 ? r.amount / cityTotal : 0;
    const current = r.id === currentId;
    return `<li class="rank-row${current ? " is-current" : ""}"${current ? ' aria-current="true"' : ""}>` +
      `<span class="rank-n">${i + 1}</span>` +
      `<button type="button" class="rank-name" data-agency="${r.id}">${escapeHtml(r.label)}</button>` +
      `<span class="rank-value">${money(r.amount)} <span class="rank-share">${percent(share)}</span></span>` +
      `<span class="rank-bar" aria-hidden="true">${segs}</span></li>`;
  }).join("");
}

function escapeHtml(str) {
  return str.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
