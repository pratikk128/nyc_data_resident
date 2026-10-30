/*
 * Payroll in inflation-adjusted dollars, shared by the server-rendered cards
 * and table and the page script. cpi is byYear.cpi from the payroll data
 * (src/lib/payroll/cpi.js): { baseFiscalYear, index: { "2014": 255.1, ... } }.
 * Every amount is restated in baseFiscalYear dollars (the latest fiscal year).
 */
import { percent } from "./format.js";

const MONEY_KEYS = ["regular", "overtime", "other", "total"];

// How many base-year dollars one dollar paid in fiscalYear is worth, or null
// when there is no index for that year.
export function inflationFactor(cpi, fiscalYear) {
  const then = cpi?.index?.[fiscalYear];
  const base = cpi?.index?.[cpi.baseFiscalYear];
  return then > 0 && base > 0 ? base / then : null;
}

// Year rows with every amount in base-year dollars. asPaid keeps the
// nominal total for tooltips. A year without an index stays as paid, flagged.
export function inRealDollars(years, cpi) {
  return years.map((y) => {
    const f = inflationFactor(cpi, y.fiscalYear);
    if (f === null) return { ...y, asPaid: y.total, unadjusted: true };
    const out = { ...y, asPaid: y.total };
    for (const k of MONEY_KEYS) out[k] = Math.round(y[k] * f);
    return out;
  });
}

/*
 * Change from the first year to the last, as paid and after inflation, and
 * how much NYC-area prices rose in between:
 * { from, to, nominal: 0.52, real: 0.08, prices: 0.40 }, or null when it
 * can't be worked out (one year, a total of $0 or less, no index).
 */
export function changeSince(years, cpi, value = (y) => y.total) {
  if (years.length < 2) return null;
  const first = years[0];
  const last = years[years.length - 1];
  const f0 = inflationFactor(cpi, first.fiscalYear);
  const f1 = inflationFactor(cpi, last.fiscalYear);
  if (f0 === null || f1 === null || value(first) <= 0) return null;
  return {
    from: first.fiscalYear,
    to: last.fiscalYear,
    nominal: value(last) / value(first) - 1,
    real: (value(last) * f1) / (value(first) * f0) - 1,
    prices: f0 / f1 - 1
  };
}

const signed = (f) => `${f < 0 ? "−" : "+"}${percent(Math.abs(f))}`;

// [label, value, context] for the "after inflation" stat card. what names
// the pay ("Payroll", "Overtime"). change is from changeSince().
export function realChangeCard(change, what = "Payroll") {
  if (!change) return [`${what}, change after inflation`, "—", "Needs at least two fiscal years of pay to compare."];
  return [
    `${what}, change since FY${change.from} after inflation`,
    signed(change.real),
    `As paid: ${signed(change.nominal)}. NYC-area prices rose ${percent(change.prices)} from FY${change.from} to FY${change.to}.`
  ];
}
