/*
 * NYC Crash Hotspots' SQL, on crash_facts (schema.js) alone, plus
 * crash_streets for a street or intersection. Runs on D1 and on the local
 * SQLite build alike.
 *
 * Places and dates are bound parameters. Masks, severities and hours come
 * from facts.js and hotspot-query.js keys, never from what was typed, so
 * they're written into the SQL as integers.
 *
 * Every function takes a query from readQuery() and returns { sql, params }.
 */
import { DIMENSIONS, maskOf } from "./facts.js";
import { SEVERITIES, TIMES } from "./hotspot-query.js";

// Meters per degree of latitude / longitude at NYC's latitude.
const M_LAT = 111320;
const M_LON = Math.round(111320 * Math.cos((40.7 * Math.PI) / 180));

export const TOP_CORNERS = 10;
export const MIN_CORNER_CRASHES = 3; // fewer isn't a pattern (DESIGN.md §7, small counts)
export const MAX_POINTS = 6000;      // serious and fatal crashes on the map; a year citywide is about 3,000

function areaWhere(area, params) {
  const p = (v) => { params.push(v); return "?"; };
  if (!area) return [];
  if (area.kind === "point") {
    // Parameters are positional: each part is built in the order it appears in the SQL.
    const dLat = area.radius / M_LAT, dLon = area.radius / M_LON;
    const box = [
      `lat BETWEEN ${p(area.lat - dLat)} AND ${p(area.lat + dLat)}`,
      `lon BETWEEN ${p(area.lon - dLon)} AND ${p(area.lon + dLon)}`
    ];
    const dy = () => `((lat - ${p(area.lat)}) * ${M_LAT})`;
    const dx = () => `((lon - ${p(area.lon)}) * ${M_LON})`;
    return [...box, `${dy()} * ${dy()} + ${dx()} * ${dx()} <= ${area.radius * area.radius}`];
  }
  if (area.kind === "street") {
    // A street typed without East/West ("72 St") takes in both; with one, only that.
    const parts = area.streets.map((s) => s.key === s.base
      ? `collision_id IN (SELECT collision_id FROM crash_streets WHERE street_base = ${p(s.base)})`
      : `collision_id IN (SELECT collision_id FROM crash_streets WHERE street = ${p(s.key)})`);
    if (area.borough) parts.push(`borough = ${p(area.borough)}`);
    return parts;
  }
  if (area.kind === "zip") return [`zip_code = ${p(area.zip)}`];
  if (area.kind === "borough") return [`borough = ${p(area.borough)}`];
  return [];
}

function filterWhere(filters) {
  const parts = [];
  for (const d of DIMENSIONS) {
    const mask = maskOf(d.groups, filters[d.param] ?? []);
    if (mask) parts.push(`(${d.column} & ${mask}) != 0`);
  }
  const min = SEVERITIES.find((s) => s.key === filters.sev)?.min ?? 0;
  if (min) parts.push(`severity >= ${min}`);
  const hours = TIMES.filter((t) => filters.time?.includes(t.key)).flatMap((t) => t.hours);
  if (hours.length) parts.push(`hour IN (${hours.join(",")})`);
  return parts;
}

// → { where: "WHERE …" or "", params }
export function whereOf({ area, filters }, extra = []) {
  const params = [];
  const parts = [...areaWhere(area, params), ...filterWhere(filters), ...extra];
  return { where: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

const bitColumns = () => DIMENSIONS.flatMap((d) => d.groups.flatMap((g) => [
  `sum((${d.column} >> ${g.bit}) & 1) AS "n:${d.column}:${g.key}"`,
  `sum(((${d.column} >> ${g.bit}) & 1) * (severity >= 2)) AS "k:${d.column}:${g.key}"`
]));

// Counts for the stat cards, and per filter group (crashes, and those that seriously hurt or killed someone).
export function totalsSql(query) {
  const { where, params } = whereOf(query);
  return {
    sql: `SELECT count(*) AS crashes, coalesce(sum(injured), 0) AS injured, coalesce(sum(killed), 0) AS killed,
      coalesce(sum(serious), 0) AS serious, coalesce(sum(severity >= 1), 0) AS hurt_crashes, coalesce(sum(severity >= 2), 0) AS ksi_crashes,
      ${bitColumns().join(",\n      ")}
      FROM crash_facts ${where}`,
    params
  };
}

/*
 * totalsSql()'s row → { crashes, injured, killed, serious, hurtCrashes, ksiCrashes,
 *   groups: { [column]: { [key]: { n, ksi } } } }
 */
export function readTotals(row = {}) {
  const groups = {};
  for (const d of DIMENSIONS) {
    groups[d.column] = {};
    for (const g of d.groups) groups[d.column][g.key] = { n: row[`n:${d.column}:${g.key}`] ?? 0, ksi: row[`k:${d.column}:${g.key}`] ?? 0 };
  }
  return {
    crashes: row.crashes ?? 0, injured: row.injured ?? 0, killed: row.killed ?? 0, serious: row.serious ?? 0,
    hurtCrashes: row.hurt_crashes ?? 0, ksiCrashes: row.ksi_crashes ?? 0, groups
  };
}

export function hoursSql(query) {
  const { where, params } = whereOf(query, ["hour IS NOT NULL"]);
  return { sql: `SELECT dow, hour, count(*) AS n, sum(severity >= 2) AS ksi FROM crash_facts ${where} GROUP BY dow, hour`, params };
}

export function monthsSql(query) {
  const { where, params } = whereOf(query);
  return {
    sql: `SELECT substr(crash_date, 1, 7) AS month, count(*) AS n, sum(severity >= 1) AS hurt, sum(severity >= 2) AS ksi
      FROM crash_facts ${where} GROUP BY month ORDER BY month`,
    params
  };
}

// The intersections with the most crashes ("crashes") or the most that seriously hurt or killed someone ("ksi").
export function cornersSql(query, by = "crashes") {
  const { where, params } = whereOf(query, ["corner IS NOT NULL"]);
  const causes = DIMENSIONS.find((d) => d.column === "causes").groups
    .map((g) => `sum((causes >> ${g.bit}) & 1) AS "c:${g.key}"`);
  return {
    sql: `SELECT corner, min(corner_label) AS label, max(borough) AS borough, count(*) AS n,
      sum(injured) AS injured, sum(killed) AS killed, sum(severity >= 2) AS ksi, ${causes.join(", ")}
      FROM crash_facts ${where} GROUP BY corner
      HAVING count(*) >= ${MIN_CORNER_CRASHES}${by === "ksi" ? " AND sum(severity >= 2) > 0" : ""}
      ORDER BY ${by === "ksi" ? "ksi DESC, n DESC" : "n DESC, ksi DESC"}, corner LIMIT ${TOP_CORNERS}`,
    params
  };
}

// cornersSql()'s rows → [{ corner, label, borough, n, injured, killed, ksi, topCause: key | null }]
export function readCorners(rows) {
  const causes = DIMENSIONS.find((d) => d.column === "causes").groups;
  return rows.map((r) => {
    let topCause = null, most = 0;
    for (const g of causes) if (r[`c:${g.key}`] > most) { most = r[`c:${g.key}`]; topCause = g.key; }
    return { corner: r.corner, label: r.label, borough: r.borough, n: r.n, injured: r.injured, killed: r.killed, ksi: r.ksi, topCause };
  });
}

// The borough most of an area's crashes are in (whatever the filters), to compare it with.
export function areaBoroughSql({ area }) {
  const { where, params } = whereOf({ area, filters: {} }, ["borough IS NOT NULL"]);
  return { sql: `SELECT borough, count(*) AS n FROM crash_facts ${where} GROUP BY borough ORDER BY n DESC LIMIT 1`, params };
}

// The map's grid: [lat, lon, crashes, ksi] per square, at the middle of its crashes.
export function cellsSql(query) {
  const { where, params } = whereOf(query, ["cell IS NOT NULL"]);
  return {
    sql: `SELECT round(avg(lat), 5) AS lat, round(avg(lon), 5) AS lon, count(*) AS n, sum(severity >= 2) AS ksi
      FROM crash_facts ${where} GROUP BY cell`,
    params
  };
}

// Each crash that seriously hurt or killed someone, worst and newest first.
export function pointsSql(query) {
  const { where, params } = whereOf(query, ["lat IS NOT NULL", "severity >= 2"]);
  return {
    sql: `SELECT lat, lon, severity, collision_id AS id, crash_date AS date, corner_label AS label
      FROM crash_facts ${where} ORDER BY severity DESC, crash_date DESC LIMIT ${MAX_POINTS}`,
    params
  };
}
