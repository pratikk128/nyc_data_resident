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
import { FIELDS as F, WINDOWS, UNSPECIFIED_BOROUGH } from "./config.js";

const BIG_LIMIT = "50000";

export function soqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Calendar-day cutoff for a window, as YYYY-MM-DD. "12m" on 2026-10-28 → 2025-10-28.
export function windowStart(windowKey, today = new Date()) {
  const w = WINDOWS[windowKey];
  if (!w) throw new Error(`Unknown window ${windowKey}`);
  if (w.since) return w.since;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - w.months);
  // Clamp: Mar 31 minus 1 month is Feb 28/29, not Mar 3.
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
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

// ---------- Baselines (run once a day, ~1 minute each) ----------
// Grouped by borough; the city total is the sum over every borough, Unspecified included.

export function baselineParams(since, column) {
  return {
    $select: `${F.borough}, ${column}, count(*) AS n`,
    $where: createdSince(since),
    $group: `${F.borough}, ${column}`,
    $limit: BIG_LIMIT
  };
}
