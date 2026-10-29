/*
 * SoQL for the water quality dataset. All aggregation runs on Socrata; the
 * Worker only ever receives one row per month (or per site and month).
 *
 * The rules match parseMeasurement() in parse.js. A value is one of
 *   number          a plain non-negative number ("0.69", ".5")
 *   below           "<X" or "ND": not detected / below the detection limit
 *   above           ">X": above the counting limit
 * and anything else ("-9", "NA", "") is missing. Detected means above, or a
 * number greater than 0.
 *
 * SoQL has no regex, so a value is sorted by its shape: the trimmed text
 * with the digits taken out ("" or "." for a number, "<" or "<." for "<1").
 * Only number-shaped text is ever cast, inside case(), so a value like "NA"
 * can't make Socrata reject the query.
 *
 * The shape is ten nested replace()s, too long to repeat in every aggregate
 * (Socrata rejects URLs past ~8 KB), so each query runs in three stages:
 *   1. each column's trimmed text (coli_t) and shape (coli_s)
 *   2. its kind (coli_k: 'number', 'below', 'above' or null)
 *   3. the aggregates or filters, which cast coli_t only where coli_k = 'number'
 */
import { FIELDS as F, ROUTINE_CLASSES, REFERENCES as R } from "./config.js";

const COLUMNS = { coli: F.coliform, ecoli: F.ecoli, cl: F.chlorine, turb: F.turbidity, fl: F.fluoride };

const shapeOf = (c) => [..."0123456789"].reduce((s, d) => `replace(${s}, '${d}', '')`, `trim(${c})`);
const list = (xs) => xs.map((x) => `'${x}'`).join(", ");
// Shapes only leave ".", "<", ">" and " ", so text of a known shape that ends
// in a digit has one, and has none after a "." ("5." and "<" are missing).
const kindOf = (k) => `case(upper(${k}_t) IN ('ND', 'ND.', 'N.D', 'N.D.'), 'below', ` +
  `${k}_t = '' OR ${k}_t LIKE '%.' OR ${k}_t LIKE '%<' OR ${k}_t LIKE '%>', null, ` +
  `${k}_s IN ('', '.'), 'number', ${k}_s IN (${list(["<", "<.", "< ", "< ."])}), 'below', ` +
  `${k}_s IN (${list([">", ">.", "> ", "> ."])}), 'above')`;

/*
 * Runs `last` (the third stage's SELECT ... clauses, reading the aliases) over
 * the samples matching `where`. `keep`: other columns to carry through, as
 * "expr AS alias".
 */
function staged({ keep = [], where, last }) {
  const aliases = keep.map((k) => k.split(" AS ").pop());
  const keys = Object.keys(COLUMNS);
  const one = [...keep, ...keys.map((k) => `trim(${COLUMNS[k]}) AS ${k}_t, ${shapeOf(COLUMNS[k])} AS ${k}_s`)];
  const two = [...aliases, ...keys.map((k) => `${k}_t, ${kindOf(k)} AS ${k}_k`)];
  return { $query: `SELECT ${one.join(", ")}${where ? ` WHERE ${where}` : ""} |> SELECT ${two.join(", ")} |> ${last}` };
}

// The number, for number-kind values only: nothing else reaches the cast.
const num = (k) => `case(${k}_k = 'number', ${k}_t::number)`;
const valid = (k) => `${k}_k IS NOT NULL`;
const below = (k) => `${k}_k = 'below'`;
const detected = (k) => `(${k}_k = 'above' OR ${num(k)} > 0)`;
const countIf = (test) => `sum(case(${test}, 1, true, 0))`;

// Medians count a below-limit result as 0 (fewer than 1% of samples, so it doesn't move them).
const medianOf = (k) => `median(case(${below(k)}, 0, true, ${num(k)}))`;

// Within the reference value: a below-limit result always is.
const atMost = (k, max) => `(${below(k)} OR ${num(k)} <= ${max})`;

// Chlorine must be detectable (above 0) and at most the EPA maximum.
const chlorineOk = `(${num("cl")} > ${R.chlorine.min} AND ${num("cl")} <= ${R.chlorine.max})`;

export const ROUTINE = `${F.sampleClass} IN (${ROUTINE_CLASSES.map((c) => `'${c}'`).join(", ")})`;

// Shared by the citywide and per-site queries.
function measures({ fluoride = true } = {}) {
  return [
    "count(*) AS n",
    `${countIf(valid("coli"))} AS coli_n`,
    `${countIf(detected("coli"))} AS coli_pos`,
    `${countIf(valid("ecoli"))} AS ecoli_n`,
    `${countIf(detected("ecoli"))} AS ecoli_pos`,
    `${countIf(valid("cl"))} AS cl_n`,
    `${medianOf("cl")} AS cl_med`,
    `${countIf(chlorineOk)} AS cl_ok`,
    `${countIf(valid("turb"))} AS turb_n`,
    `${medianOf("turb")} AS turb_med`,
    `${countIf(atMost("turb", R.turbidity.max))} AS turb_ok`,
    ...(fluoride ? [
      `${countIf(valid("fl"))} AS fl_n`,
      `${medianOf("fl")} AS fl_med`,
      `${countIf(atMost("fl", R.fluoride.max))} AS fl_ok`
    ] : [])
  ].join(", ");
}

// Citywide, one row per month across the whole history.
export function monthlyParams() {
  return staged({
    keep: [`date_trunc_ym(${F.date}) AS month`, `${F.site} AS site`],
    where: ROUTINE,
    last: `SELECT month, count(distinct site) AS sites, ${measures()} GROUP BY month ORDER BY month LIMIT 5000`
  });
}

// The newest sample date, to tell whether the last month is complete.
export function latestDateParams() {
  return { $select: `max(${F.date}) AS latest` };
}

const between = (since, until) => `${ROUTINE} AND ${F.date} >= '${since}' AND ${F.date} < '${until}'`;

// One row per site and month from `since` (YYYY-MM-DD) through `until` (exclusive).
export function siteMonthlyParams(since, until) {
  return staged({
    keep: [`${F.site} AS site`, `date_trunc_ym(${F.date}) AS month`],
    where: between(since, until),
    last: `SELECT site, month, ${measures({ fluoride: false })} GROUP BY site, month ORDER BY site, month LIMIT 50000`
  });
}

// Whole-window totals and medians, one row per site (bySite) or one for the city.
export function windowTotalParams(since, until, { bySite = false } = {}) {
  return staged({
    keep: bySite ? [`${F.site} AS site`] : [],
    where: between(since, until),
    last: bySite
      ? `SELECT site, ${measures({ fluoride: false })} GROUP BY site ORDER BY site LIMIT 50000`
      : `SELECT ${measures({ fluoride: false })} LIMIT 1`
  });
}

// The sample columns the detection and follow-up queries return, under their own names.
const SAMPLE = [F.number, F.date, F.time, F.site, F.sampleClass, F.coliform, F.ecoli];

// Every sample, of any class, where coliform or E. coli was found.
export function detectionParams() {
  return staged({
    keep: SAMPLE.map((c) => `${c} AS ${c}`),
    last: `SELECT ${SAMPLE.join(", ")} WHERE ${detected("coli")} OR ${detected("ecoli")} ` +
      `ORDER BY ${F.date} DESC, ${F.number} LIMIT 50000`
  });
}

// Samples at each E. coli station from the detection's day through `days`
// after it (any class): the candidates for DEP's follow-up tests. The
// detection itself and same-day samples taken before it are dropped in
// laterSamples() (stats.js). detections: [{ site, date }].
export function followUpParams(detections, days = 14) {
  const clauses = detections.map(({ site, date }) => {
    const end = new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
    return `(${F.site} = '${String(site).replace(/'/g, "''")}' AND ${F.date} >= '${date}' AND ${F.date} <= '${end}')`;
  });
  return {
    $select: SAMPLE.join(", "),
    $where: clauses.join(" OR "),
    $order: `${F.date}, ${F.number}`,
    $limit: "5000"
  };
}
