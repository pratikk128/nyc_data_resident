/*
 * SoQL for the water quality dataset. All aggregation runs on Socrata; the
 * Worker only ever receives one row per month (or per site and month).
 *
 * The rules match parseMeasurement() in parse.js:
 *   valid(c)        not null, not a negative placeholder ("-9")
 *   below(c)        "<X" or "ND": not detected / below the detection limit
 *   detected(c)     valid and not below
 *   num(c)          the number, for valid values that aren't "<X", "ND" or ">X"
 * case() stops at the first true test, so the ::number casts only see numbers.
 */
import { FIELDS as F, ROUTINE_CLASSES, REFERENCES as R } from "./config.js";

const valid = (c) => `(${c} IS NOT NULL AND ${c} NOT LIKE '-%')`;
const below = (c) => `(${c} LIKE '<%' OR upper(${c}) = 'ND')`;
const detected = (c) => `(${valid(c)} AND NOT ${below(c)})`;
const num = (c) => `case(${valid(c)} AND NOT ${below(c)} AND ${c} NOT LIKE '>%', ${c}::number)`;
const countIf = (test) => `sum(case(${test}, 1, true, 0))`;

// Medians count a below-limit result as 0 (fewer than 1% of samples, so it doesn't move them).
const medianOf = (c) => `median(case(${below(c)}, 0, true, ${num(c)}))`;

// Within the reference value: a below-limit result always is.
const atMost = (c, max) => `(${below(c)} OR (${valid(c)} AND ${c} NOT LIKE '>%' AND ${c}::number <= ${max}))`;

// Chlorine must be detectable (above 0) and at most the EPA maximum.
const chlorineOk = `(${valid(F.chlorine)} AND NOT ${below(F.chlorine)} AND ${F.chlorine} NOT LIKE '>%' ` +
  `AND ${F.chlorine}::number > ${R.chlorine.min} AND ${F.chlorine}::number <= ${R.chlorine.max})`;

export const ROUTINE = `${F.sampleClass} IN (${ROUTINE_CLASSES.map((c) => `'${c}'`).join(", ")})`;

// Shared by the citywide and per-site queries.
function measures({ fluoride = true } = {}) {
  return [
    "count(*) AS n",
    `${countIf(valid(F.coliform))} AS coli_n`,
    `${countIf(detected(F.coliform))} AS coli_pos`,
    `${countIf(valid(F.ecoli))} AS ecoli_n`,
    `${countIf(detected(F.ecoli))} AS ecoli_pos`,
    `${countIf(valid(F.chlorine))} AS cl_n`,
    `${medianOf(F.chlorine)} AS cl_med`,
    `${countIf(chlorineOk)} AS cl_ok`,
    `${countIf(valid(F.turbidity))} AS turb_n`,
    `${medianOf(F.turbidity)} AS turb_med`,
    `${countIf(atMost(F.turbidity, R.turbidity.max))} AS turb_ok`,
    ...(fluoride ? [
      `${countIf(valid(F.fluoride))} AS fl_n`,
      `${medianOf(F.fluoride)} AS fl_med`,
      `${countIf(atMost(F.fluoride, R.fluoride.max))} AS fl_ok`
    ] : [])
  ].join(", ");
}

// Citywide, one row per month across the whole history.
export function monthlyParams() {
  return {
    $select: `date_trunc_ym(${F.date}) AS month, count(distinct ${F.site}) AS sites, ${measures()}`,
    $where: ROUTINE,
    $group: "month",
    $order: "month",
    $limit: "5000"
  };
}

// The newest sample date, to tell whether the last month is complete.
export function latestDateParams() {
  return { $select: `max(${F.date}) AS latest` };
}

// One row per site and month from `since` (YYYY-MM-DD) through `until` (exclusive).
export function siteMonthlyParams(since, until) {
  return {
    $select: `${F.site} AS site, date_trunc_ym(${F.date}) AS month, ${measures({ fluoride: false })}`,
    $where: `${ROUTINE} AND ${F.date} >= '${since}' AND ${F.date} < '${until}'`,
    $group: "site, month",
    $order: "site, month",
    $limit: "50000"
  };
}

// Whole-window totals and medians, one row per site (bySite) or one for the city.
export function windowTotalParams(since, until, { bySite = false } = {}) {
  return {
    $select: `${bySite ? `${F.site} AS site, ` : ""}${measures({ fluoride: false })}`,
    $where: `${ROUTINE} AND ${F.date} >= '${since}' AND ${F.date} < '${until}'`,
    ...(bySite ? { $group: "site", $order: "site" } : {}),
    $limit: "50000"
  };
}

// Every sample, of any class, where coliform or E. coli was found.
export function detectionParams() {
  return {
    $select: [F.number, F.date, F.site, F.sampleClass, F.coliform, F.ecoli].join(", "),
    $where: `${detected(F.coliform)} OR ${detected(F.ecoli)}`,
    $order: `${F.date} DESC, ${F.number}`,
    $limit: "50000"
  };
}

// Samples at each E. coli station in the `days` after the detection (any class):
// DEP's follow-up tests. detections: [{ site, date }].
export function followUpParams(detections, days = 14) {
  const clauses = detections.map(({ site, date }) => {
    const end = new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
    return `(${F.site} = '${String(site).replace(/'/g, "''")}' AND ${F.date} > '${date}' AND ${F.date} <= '${end}')`;
  });
  return {
    $select: [F.number, F.date, F.site, F.sampleClass, F.coliform, F.ecoli].join(", "),
    $where: clauses.join(" OR "),
    $order: `${F.date}, ${F.number}`,
    $limit: "5000"
  };
}
