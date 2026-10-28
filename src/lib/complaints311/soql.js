/*
 * Every SoQL query the 311 dashboard runs (dataset erm2-nwe9). Pure functions:
 * they return the $-parameters and src/lib/server/complaints311.js sends them.
 * The dataset has tens of millions of rows, so every query aggregates on
 * Socrata's side ($select count(*) ... $group); none of them pull raw rows.
 *
 * Radius queries use within_circle(location, lat, lon, meters). Rows with no
 * coordinates (about 2% of requests) have no `location`, so within_circle()
 * leaves them out on its own; a separate IS NOT NULL test would only slow it down.
 */
import { FIELDS as F, WINDOWS, UNSPECIFIED_BOROUGH, GRID_CELLS_PER_DEGREE, HEATMAP_CELLS_PER_DEGREE } from "./config.js";
import { typeKey } from "./labels.js";

const BIG_LIMIT = "50000";

export function soqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const NYC_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

// The calendar date in New York, as YYYY-MM-DD. created_date is NY local time, so cutoffs follow NY's day, not UTC's.
export function nycToday(now = new Date()) {
  return NYC_DATE.format(now);
}

// `months` before the YYYY-MM-DD `today`, as YYYY-MM-DD. Clamped: Mar 31 minus 1 month is Feb 28/29, not Mar 3.
function monthsBefore(today, months) {
  const d = new Date(`${today}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

// Calendar-day cutoff for a window, as YYYY-MM-DD, by New York's date. "12m" on 2026-10-28 → 2025-10-28.
export function windowStart(windowKey, now = new Date()) {
  const w = WINDOWS[windowKey];
  if (!w) throw new Error(`Unknown window ${windowKey}`);
  return monthsBefore(nycToday(now), w.months);
}

/*
 * A window cut into pieces of `months`, oldest first: [{ since, until }], with
 * `until` null on the newest. "12m" in 3 month pieces → 4 pieces.
 */
export function windowChunks(windowKey, months, now = new Date()) {
  const total = WINDOWS[windowKey].months;
  const today = nycToday(now);
  const out = [];
  for (let m = total; m > 0; m -= months) {
    out.push({ since: monthsBefore(today, m), until: m - months > 0 ? monthsBefore(today, m - months) : null });
  }
  return out;
}

const createdSince = (since) => `${F.created} >= '${since}T00:00:00'`;

export function circle(lat, lon, meters) {
  return `within_circle(${F.location}, ${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}, ${Math.round(meters)})`;
}

// ---------- One area (a circle, a ZIP or a borough) ----------
// `where` is the area test: circle(...), zipWhere(...) or boroughWhere(...).

export const zipWhere = (zip) => `${F.zip} = ${soqlString(zip)}`;
export const boroughWhere = (borough) => `${F.borough} = ${soqlString(borough)}`;

const area = (since, where) => `${createdSince(since)} AND ${where}`;

export function typeCountParams(since, where) {
  return {
    $select: `${F.type}, count(*) AS n`,
    $where: area(since, where),
    $group: F.type,
    $limit: BIG_LIMIT
  };
}

export function locationTypeCountParams(since, where) {
  return {
    $select: `${F.locationType}, count(*) AS n`,
    $where: area(since, where),
    $group: F.locationType,
    $limit: BIG_LIMIT
  };
}

export function statusCountParams(since, where) {
  return {
    $select: `${F.status}, count(*) AS n`,
    $where: area(since, where),
    $group: F.status,
    $limit: "100"
  };
}

// Which borough most nearby requests name, when the geocoder didn't say.
export function boroughCountParams(since, where) {
  return {
    $select: `${F.borough}, count(*) AS n`,
    $where: `${area(since, where)} AND ${F.borough} != ${soqlString(UNSPECIFIED_BOROUGH)}`,
    $group: F.borough,
    $order: "n DESC",
    $limit: "10"
  };
}

// A ZIP: its request count, centre (the average location of its requests) and borough.
export function zipSummaryParams(since, zip) {
  return {
    $select: `${F.borough}, count(*) AS n, avg(${F.latitude}) AS lat, avg(${F.longitude}) AS lon`,
    $where: area(since, zipWhere(zip)),
    $group: F.borough,
    $order: "n DESC",
    $limit: "10"
  };
}

/*
 * The heat map: requests per small grid cell in an area, y and x as in gridCountParams().
 * `types` are typeKey() values; empty means every type. typeKey() also collapses inner
 * spaces, which SoQL can't, but no complaint_type has a doubled space.
 */
export function heatmapParams(since, where, types = []) {
  const g = HEATMAP_CELLS_PER_DEGREE;
  const typeTest = types.length
    ? ` AND upper(trim(${F.type})) IN (${types.map((t) => soqlString(typeKey(t))).join(", ")})`
    : "";
  return {
    $select: `floor(${F.latitude} * ${g}) AS y, floor(${F.longitude} * ${g}) AS x, count(*) AS n`,
    $where: area(since, where) + typeTest,
    $group: "y, x",
    $limit: BIG_LIMIT
  };
}

// ---------- Baselines (run once a day, ~1 minute each) ----------
// Grouped by borough; the city total is the sum over every borough, Unspecified included.
// Only requests with a location, like the radius counts they're compared with: types often
// filed without one would otherwise look rarer near every spot.

export function baselineParams(since, column) {
  return {
    $select: `${F.borough}, ${column}, count(*) AS n`,
    $where: `${createdSince(since)} AND ${F.location} IS NOT NULL`,
    $group: `${F.borough}, ${column}`,
    $limit: BIG_LIMIT
  };
}

/*
 * Requests per grid cell, citywide: y and x are floor(latitude × GRID_CELLS_PER_DEGREE)
 * and the same for longitude. Rows without coordinates come back as one group with no y/x.
 */
export function gridCountParams(since, until) {
  const g = GRID_CELLS_PER_DEGREE;
  return {
    $select: `floor(${F.latitude} * ${g}) AS y, floor(${F.longitude} * ${g}) AS x, count(*) AS n`,
    $where: createdSince(since) + (until ? ` AND ${F.created} < '${until}T00:00:00'` : ""),
    $group: "y, x",
    $limit: "500000"
  };
}
