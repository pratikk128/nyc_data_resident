/*
 * Year-over-year change line for stat cards: "−3.0% from FY2024 ($35.7B)".
 * Shared by server-rendered cards and the page scripts that redraw them.
 */
import { percent } from "./format.js";

// `value` picks the number from a year row; `format` prints the prior value.
// Returns null when there's nothing fair to compare with: no row for the
// fiscal year right before the latest one, or a prior value of zero or less.
/**
 * @template {{ fiscalYear: number }} Y
 * @param {Y[]} years
 * @param {(y: Y) => number} value
 * @param {(n: number) => string} format
 * @returns {{ dir: "up" | "down" | "flat", text: string } | null}
 */
export function yearChange(years, value, format) {
  const last = years[years.length - 1];
  const prev = years.find((y) => y.fiscalYear === last.fiscalYear - 1);
  if (!last || !prev || value(prev) <= 0) return null;

  const fraction = value(last) / value(prev) - 1;
  const shown = percent(Math.abs(fraction));
  const dir = shown === percent(0) ? "flat" : fraction > 0 ? "up" : "down";
  const sign = { up: "+", down: "−", flat: "" }[dir];
  const amount = dir === "flat" ? "No change" : `${sign}${shown}`;
  return { dir, text: `${amount} from FY${prev.fiscalYear} (${format(value(prev))})` };
}
