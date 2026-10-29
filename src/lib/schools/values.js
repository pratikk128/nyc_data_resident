/*
 * Reading and describing School Quality Report values: normalizing the raw
 * numbers (scale, invert), formatting, DOE target bands, comparisons with the
 * NYC average and the 3-year trend. Shared by the server, the pages, the
 * browser scripts and the tests.
 *
 * A blank or suppressed value (the dataset leaves metric_value empty when too
 * few students were counted) is null everywhere and shown as "Not reported",
 * never as 0.
 */
import { TARGET_BANDS, GAP_REASONS, yearLabel } from "./config.js";
import { count } from "../format.js";

export const NOT_REPORTED = "Not reported";

// A finite number, or null for blanks, suppression markers ("N<15", "s", "."), etc.
export function toNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Raw dataset value → the value we show (0–1 for percents, a change for points, a count).
export function normalize(metric, raw) {
  let v = toNumber(raw);
  if (v == null) return null;
  if (metric.field === "number_of_students") return v;
  v /= metric.scale ?? 1;
  if (metric.invert) v = 1 - v;
  return Math.round(v * 1e6) / 1e6; // 1 − 0.918 = 0.08199999… otherwise
}

/*
 * One dataset row → { v, cmp, score, n } for a metric: the value, the
 * comparison group average (same scale), DOE's metric score and the number
 * of students counted.
 */
export function pointFromRow(metric, row) {
  const counted = metric.field === "number_of_students";
  return {
    v: counted ? toNumber(row.number_of_students) : normalize(metric, row.metric_value),
    cmp: counted ? null : normalize(metric, row.comparison_group_average),
    score: counted ? null : toNumber(row.metric_score),
    n: toNumber(row.number_of_students)
  };
}

export function formatValue(metric, v) {
  if (v == null) return NOT_REPORTED;
  if (metric.format === "count") return count(v);
  if (metric.format === "points") {
    const pts = v * 100;
    const sign = pts > 0.05 ? "+" : pts < -0.05 ? "−" : "";
    return `${sign}${Math.abs(pts).toFixed(1)} pts`;
  }
  return `${shownPct(v)}%`;
}

// A percent as formatValue shows it: one decimal under 10%, and from 99.5%
// rounded down, so a rate short of 100% never reads "100%".
function shownPct(v) {
  const pct = v * 100;
  if (pct > 0 && pct < 10) return pct.toFixed(1);
  if (pct >= 99.5 && pct < 100) return (Math.floor(pct * 10) / 10).toFixed(1);
  return String(Math.round(pct));
}

// v − ref in whole percentage points, from the numbers as shown, so a card
// never says "1 pt above NYC avg (54%)" next to 54%.
function diffPts(metric, v, ref) {
  if (metric.format === "percent") return Math.round(Number(shownPct(v)) - Number(shownPct(ref)));
  return Math.round((v - ref) * 100);
}

// Axis ticks and other places where a short label fits.
export function formatTick(metric, v) {
  if (metric.format === "count") return count(v);
  if (metric.format === "points") return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}`;
  return `${Math.round(v * 100)}%`;
}

// DOE's target band for a metric score (1.00–4.99), or null.
export function targetBand(score) {
  if (score == null || score < 1) return null;
  return TARGET_BANDS.find((b) => score >= b.min) ?? null;
}

/*
 * How v compares with a reference (the NYC average or similar schools):
 * { dir: "above" | "below" | "same", text: "6 pts above", good: true | false | null }.
 * Percent and points differences are in percentage points, between the
 * values as shown; within half a point counts as the same.
 */
export function compare(metric, v, ref) {
  if (v == null || ref == null || metric.format === "count") return null;
  const pts = diffPts(metric, v, ref);
  if (pts === 0) return { dir: "same", text: "Same as", good: null };
  const dir = pts > 0 ? "above" : "below";
  const good = metric.higherIsBetter == null ? null : (pts > 0) === metric.higherIsBetter;
  return { dir, text: `${Math.abs(pts)} ${Math.abs(pts) === 1 ? "pt" : "pts"} ${dir}`, good };
}

/*
 * The headline call for a measure: "better" or "worse" than the NYC average,
 * "similar" within 2 points either way, or null when there's nothing to
 * compare (no value, no average, a count, or no better direction).
 */
export const SIMILAR_PTS = 2;
export function verdict(metric, v, city) {
  const c = compare(metric, v, city);
  if (!c) return null;
  if (Math.abs(diffPts(metric, v, city)) <= SIMILAR_PTS) return "similar";
  return c.good == null ? null : c.good ? "better" : "worse";
}

/*
 * Improving, steady or declining, from the last 3 years with a value (not
 * counting years before the metric's seriesBreak or firstYear). The change is the
 * least-squares slope × the years spanned, so one odd year moves it less
 * than first-to-last would. Fewer than 3 values → { dir: null }.
 * points: { [year]: { v } }.
 */
export function trend(metric, points) {
  const from = metric.seriesBreak?.year ?? metric.firstYear ?? -Infinity;
  const series = Object.entries(points ?? {})
    .map(([y, p]) => [Number(y), p?.v])
    .filter(([y, v]) => v != null && y >= from)
    .sort((a, b) => a[0] - b[0])
    .slice(-3);
  if (series.length < 3) return { dir: null, years: series.map(([y]) => y) };
  const n = series.length;
  const mx = series.reduce((s, [y]) => s + y, 0) / n;
  const my = series.reduce((s, [, v]) => s + v, 0) / n;
  const slope = series.reduce((s, [y, v]) => s + (y - mx) * (v - my), 0) /
    series.reduce((s, [y]) => s + (y - mx) ** 2, 0);
  const change = slope * (series[n - 1][0] - series[0][0]);
  const threshold = metric.trendThreshold ?? 0.03;
  const years = series.map(([y]) => y);
  if (!(Math.abs(change) >= threshold)) return { dir: "steady", change, years };
  const better = metric.higherIsBetter === false ? change < 0 : change > 0;
  return { dir: better ? "improving" : "declining", change, years };
}

export const TREND_TEXT = { improving: "Improving", steady: "Steady", declining: "Declining" };

// "Improving: up 7 pts over 2022–23 to 2024–25"
export function trendSentence(metric, t) {
  if (!t?.dir) return "Not enough years with data for a trend (needs 3).";
  const span = `${yearLabel(t.years[0])} to ${yearLabel(t.years[t.years.length - 1])}`;
  if (metric.format === "count") {
    return `${t.change >= 0 ? "Up" : "Down"} about ${count(Math.abs(t.change))} from ${span}.`;
  }
  const pts = Math.round(Math.abs(t.change) * 100);
  if (t.dir === "steady") return `Steady: within ${pts < 1 ? "1 pt" : `${pts} ${pts === 1 ? "pt" : "pts"}`} from ${span}.`;
  return `${TREND_TEXT[t.dir]}: ${t.change > 0 ? "up" : "down"} ${pts} ${pts === 1 ? "pt" : "pts"} from ${span}.`;
}

/*
 * Years between a metric's first and last value that have no value, with
 * why when we know (COVID-19 testing years, for state test measures only):
 * [{ year, reason }].
 */
export function gapYears(metric, points, years) {
  const has = years.filter((y) => points?.[y]?.v != null);
  if (!has.length) return [];
  return years
    .filter((y) => y > has[0] && y < has[has.length - 1] && points?.[y]?.v == null)
    .map((y) => ({ year: y, reason: (metric.stateTest && GAP_REASONS[y]) || "Not reported this year." }));
}

// The newest year with a value, or null.
export function latestYearWithValue(points) {
  const ys = Object.keys(points ?? {}).map(Number).filter((y) => points[y]?.v != null);
  return ys.length ? Math.max(...ys) : null;
}
