/*
 * NYC Crash Hotspots' SQL, on crash_facts (schema.js) alone, plus
 * crash_streets for a street or intersection. Runs on D1 and on the local
 * SQLite build alike.
 *
 * Places are bound parameters. Masks come from facts.js keys (through the
 * mode, hotspot-query.js), never from what was typed, so they're written
 * into the SQL as integers.
 *
 * Every function takes a query from readQuery() and returns { sql, params }.
 */
import { DIMENSIONS, KIND_COLUMNS, maskOf } from "./facts.js";

// Meters per degree of latitude / longitude at NYC's latitude.
const M_LAT = 111320;
const M_LON = Math.round(111320 * Math.cos((40.7 * Math.PI) / 180));

export const TOP_CORNERS = 10;
export const MIN_CORNER_CRASHES = 3; // fewer isn't a pattern (DESIGN.md §7, small counts)
export const MIN_CORNER_HURT = 2;    // a corner is listed for people getting hurt there, more than once
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
  return parts;
}

// → { where: "WHERE …" or "", params }
export function whereOf({ area, filters = {} }, extra = []) {
  const params = [];
  const parts = [...areaWhere(area, params), ...filterWhere(filters), ...extra];
  return { where: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

const bitColumns = (withKsi = true) => DIMENSIONS.flatMap((d) => d.groups.flatMap((g) => [
  `sum((${d.column} >> ${g.bit}) & 1) AS "n:${d.column}:${g.key}"`,
  ...(withKsi ? [`sum(((${d.column} >> ${g.bit}) & 1) * (severity >= 2)) AS "k:${d.column}:${g.key}"`] : [])
]));

/*
 * The people counted as injured, killed and seriously hurt, as SQL: everyone
 * in the crash, or with a who filter whose kinds all have their own counts
 * (the walk and bike modes), only those people.
 */
function peopleOf(filters = {}) {
  const prefixes = (filters.who ?? []).map((k) => KIND_COLUMNS[k]);
  if (!prefixes.length || prefixes.some((p) => !p)) return { injured: "injured", killed: "killed", serious: "serious" };
  const sum = (c) => prefixes.map((p) => `${p}_${c}`).join(" + ");
  return { injured: sum("injured"), killed: sum("killed"), serious: sum("serious") };
}

const totals = (filters) => {
  const people = peopleOf(filters);
  return `count(*) AS crashes, coalesce(sum(${people.injured}), 0) AS injured, coalesce(sum(${people.killed}), 0) AS killed,
      coalesce(sum(${people.serious}), 0) AS serious, coalesce(sum(severity >= 1), 0) AS hurt_crashes, coalesce(sum(severity >= 2), 0) AS ksi_crashes`;
};

// Counts for the stat cards, and per kind of crash (crashes, and those that seriously hurt or killed someone).
export function totalsSql(query) {
  const { where, params } = whereOf(query);
  return { sql: `SELECT ${totals(query.filters)},\n      ${bitColumns().join(",\n      ")}\n      FROM crash_facts ${where}`, params };
}

/*
 * The same counts for each borough (and the crashes with none), citywide
 * with the query's mode: what an area and each of its corners are compared with.
 */
export function boroughTotalsSql({ filters }) {
  const { where, params } = whereOf({ area: null, filters });
  return { sql: `SELECT borough, ${totals(filters)},\n      ${bitColumns().join(",\n      ")}\n      FROM crash_facts ${where} GROUP BY borough`, params };
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

// readTotals() results added together (the boroughs into all of NYC).
export function addTotals(list) {
  const out = readTotals();
  for (const t of list) {
    for (const k of ["crashes", "injured", "killed", "serious", "hurtCrashes", "ksiCrashes"]) out[k] += t[k];
    for (const d of DIMENSIONS) for (const g of d.groups) {
      out.groups[d.column][g.key].n += t.groups[d.column][g.key].n;
      out.groups[d.column][g.key].ksi += t.groups[d.column][g.key].ksi;
    }
  }
  return out;
}

/*
 * The intersections where crashes hurt people most often: ranked by crashes
 * that hurt someone (with the mode, someone walking or on a bike), then by
 * those that seriously hurt or killed someone. Each row carries its counts per
 * kind of crash, so the page can say what goes wrong there, and its people
 * hurt and killed (peopleOf(): with the mode, only the mode's people).
 */
export function cornersSql(query) {
  const { where, params } = whereOf(query, ["corner IS NOT NULL"]);
  const people = peopleOf(query.filters);
  return {
    sql: `SELECT corner, min(corner_label) AS label, max(borough) AS borough, round(avg(lat), 5) AS lat, round(avg(lon), 5) AS lon,
      count(*) AS n, sum(severity >= 1) AS hurt, sum(${people.injured}) AS injured, sum(${people.killed}) AS killed, sum(severity >= 2) AS ksi,
      ${bitColumns(false).join(", ")}
      FROM crash_facts ${where} GROUP BY corner
      HAVING count(*) >= ${MIN_CORNER_CRASHES} AND sum(severity >= 1) >= ${MIN_CORNER_HURT}
      ORDER BY hurt DESC, ksi DESC, n DESC, corner LIMIT ${TOP_CORNERS}`,
    params
  };
}

// cornersSql()'s rows → [{ corner, label, borough, lat, lon, n, hurt, injured, killed, ksi, groups }]
export function readCorners(rows) {
  return rows.map((r) => {
    const { groups } = readTotals(r);
    return { corner: r.corner, label: r.label, borough: r.borough, lat: r.lat, lon: r.lon,
      n: r.n, hurt: r.hurt, injured: r.injured, killed: r.killed, ksi: r.ksi, groups };
  });
}

/*
 * Where one intersection stands in its borough: how many intersections there
 * had any crash that hurt someone (with the mode), and how many had more than `hurt`.
 */
export function cornerRankSql({ filters }, borough, hurt) {
  const { where, params } = whereOf({ area: { kind: "borough", borough }, filters }, ["corner IS NOT NULL"]);
  return {
    sql: `SELECT count(*) AS total, coalesce(sum(hurt > ${Math.max(0, Math.floor(hurt))}), 0) AS above
      FROM (SELECT sum(severity >= 1) AS hurt FROM crash_facts ${where} GROUP BY corner HAVING sum(severity >= 1) > 0)`,
    params
  };
}

// The borough most of an area's crashes are in (whatever the mode), to compare it with.
export function areaBoroughSql({ area }) {
  const { where, params } = whereOf({ area }, ["borough IS NOT NULL"]);
  return { sql: `SELECT borough, count(*) AS n FROM crash_facts ${where} GROUP BY borough ORDER BY n DESC LIMIT 1`, params };
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

/*
 * One page of crash_facts for the data refresh to pack (hotspot-compute.js),
 * in collision_id order after `after`, each row with its crash_streets keys
 * joined by STREET_SEP in `streets`.
 */
export const STREET_SEP = "\u001f";
export const FACTS_COLUMNS = ["collision_id", "crash_date", "borough", "zip_code", "lat", "lon", "corner", "corner_label", "severity",
  "killed", "injured", "serious", "ped_killed", "ped_serious", "ped_injured", "cyc_killed", "cyc_serious", "cyc_injured",
  "erider_killed", "erider_serious", "erider_injured", "who", "causes", "maneuvers", "vehicles"];
export function factsPageSql(after, limit) {
  return {
    sql: `SELECT ${FACTS_COLUMNS.map((c) => `f.${c}`).join(", ")},
      (SELECT group_concat(s.street, char(31)) FROM crash_streets s WHERE s.collision_id = f.collision_id) AS streets
      FROM crash_facts f WHERE f.collision_id > ? ORDER BY f.collision_id LIMIT ${Math.floor(limit)}`,
    params: [after]
  };
}
