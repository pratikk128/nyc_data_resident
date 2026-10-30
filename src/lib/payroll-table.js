/*
 * Rows for the payroll-by-fiscal-year table, shared by the server-rendered
 * citywide table and the agency and pay type filters (which rebuild it in the
 * browser). Newest year first. Every pay column is always written; filtered
 * ones are hidden with a class on the table wrapper. With some pay types
 * filtered out, the total sums only the ones kept, matching the total card.
 * The next column restates that total in the latest fiscal year's dollars
 * (cpi is byYear.cpi; see payroll-inflation.js).
 */
import { money, count } from "./format.js";
import { inflationFactor } from "./payroll-inflation.js";

const PAY_KEYS = ["regular", "overtime", "other"];

export function payrollRowsHtml(years, cpi, payTypes = PAY_KEYS) {
  const allPay = PAY_KEYS.every((k) => payTypes.includes(k));
  const total = (y) => (allPay ? y.total : payTypes.reduce((sum, k) => sum + y[k], 0));
  return years.slice().reverse().map((y) =>
    `<tr><th scope="row">FY${y.fiscalYear}</th><td data-pay="regular">${money(y.regular, 2)}</td>` +
    `<td data-pay="overtime">${money(y.overtime, 2)}</td><td data-pay="other">${money(y.other, 2)}</td>` +
    `<td>${money(total(y), 2)}</td><td>${real(total(y), inflationFactor(cpi, y.fiscalYear))}</td><td>${count(y.activeJune30)}</td><td>${count(y.peoplePaid)}</td></tr>`
  ).join("");
}

const real = (amount, factor) => (factor === null ? '<span aria-label="not available">—</span>' : money(amount * factor, 2));
