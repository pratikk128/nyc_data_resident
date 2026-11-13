/*
 * NYC Crash Hotspots' numbers, worked out in JavaScript from a year of
 * crash_facts rows (facts.js) instead of in SQL, so no request needs a
 * database. Browser-safe.
 *
 * The data refresh (src/lib/server/crash-hotspots.js) builds the rows from a
 * fresh fetch of NYC Open Data, packs them with packFacts() and stores it in KV, along with the summary and
 * map of every view it can work out ahead (all of NYC and each borough, with
 * each mode). For any other place (a ZIP, a street, an intersection, a spot)
 * the page downloads the packed facts once and calls summarize() and
 * mapOf() itself.
 *
 * The results are the same as hotspot-sql.js's statements on the same rows
 * (tests/crash-hotspots.test.js checks), in the shapes readTotals() and
 * readCorners() give.
 */
import { DIMENSIONS, KIND_COLUMNS, maskOf } from "./facts.js";
import { streetBaseKey } from "./normalize.js";
import { readTotals, addTotals, TOP_CORNERS, MIN_CORNER_CRASHES, MIN_CORNER_HURT, MAX_POINTS } from "./hotspot-sql.js";
import { boroughLabel } from "../complaints311/config.js";

// Bump when the packed shape changes; the page refuses facts it can't read.
export const FACTS_FORMAT = 1;

// Meters per degree, exactly as hotspot-sql.js has them.
const M_LAT = 111320;
const M_LON = Math.round(111320 * Math.cos((40.7 * Math.PI) / 180));

// People counts beyond `injured`, packed together since most crashes have none.
const PEOPLE = ["killed", "serious", ...Object.values(KIND_COLUMNS).flatMap((p) => [`${p}_killed`, `${p}_serious`, `${p}_injured`])];
const MASKS = DIMENSIONS.map((d) => d.column);

// ---------- Packing ----------

/*
 * Values → a list, most common first (so the commonest get the shortest
 * numbers), and an index of value → position + 1, so 0 can stand for null.
 */
function byFrequency(values) {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([v]) => v);
  const index = new Map(list.map((v, i) => [v, i + 1]));
  return { list, of: (v) => (v == null ? 0 : index.get(v)) };
}

// Coordinates as millionths of a degree: the source has six decimals at most.
const micro = (v) => (v == null ? null : Math.round(v * 1e6));
const exact = (v) => v == null || micro(v) / 1e6 === v;

// Rows near each other on the map next to each other in the file (a Z-order
// curve over ~100 m squares), so places and streets repeat and compress well.
function zOrder(lat, lon) {
  if (lat == null || lon == null) return Infinity;
  const y = Math.max(0, Math.min(1023, Math.floor((lat - 40.4) * 1000)));
  const x = Math.max(0, Math.min(1023, Math.floor((lon + 74.3) * 1000)));
  let z = 0;
  for (let b = 9; b >= 0; b--) z = z * 4 + ((y >> b) & 1) * 2 + ((x >> b) & 1);
  return z;
}

/*
 * crash_facts rows, each with `streets` (its crash_streets.street keys; the
 * street_base of each is streetBaseKey() of it, as rows.js stores it) → a
 * compact, JSON-safe table that unpackFacts() reads back:
 *   - rows in map order, coordinates as differences from the row before;
 *   - places as numbers into dictionaries, most common first;
 *   - an intersection as its two streets, and each row's streets only
 *     beyond its intersection's two;
 *   - one label per intersection, with the rows that spell it differently
 *     listed apart;
 *   - dates only for crashes that seriously hurt or killed someone, the
 *     only ones the map shows.
 * Row order is free: nothing summarize() or mapOf() gives depends on it.
 */
export function packFacts(rows, meta = {}) {
  rows = rows.map((r, i) => ({ r, z: zOrder(r.lat, r.lon), i }))
    .sort((a, b) => a.z - b.z || a.i - b.i).map((x) => x.r);
  const dict = {
    borough: byFrequency(rows.map((r) => r.borough)),
    zip: byFrequency(rows.map((r) => r.zip_code)),
    street: byFrequency(rows.flatMap((r) => r.streets ?? [])),
    label: byFrequency(rows.map((r) => r.corner_label))
  };
  dict.base = byFrequency(dict.street.list.map(streetBaseKey));
  const streetBase = dict.street.list.map((s) => dict.base.of(streetBaseKey(s)));

  // Each intersection: its two streets when its key is made of them (facts.js cornerOf()), and its commonest label.
  const cornerRows = new Map();
  for (const r of rows) if (r.corner != null) (cornerRows.get(r.corner) ?? cornerRows.set(r.corner, []).get(r.corner)).push(r);
  const cornerIndex = new Map();
  const corners = [];
  for (const [key, list] of cornerRows) {
    const label = byFrequency(list.map((r) => r.corner_label)).list[0] ?? null;
    const [a, b, more] = key.split("&");
    const pair = more == null && dict.street.of(a) && dict.street.of(b);
    corners.push(pair ? [dict.street.of(a), dict.street.of(b), dict.label.of(label)] : [key, dict.label.of(label)]);
    cornerIndex.set(key, { n: corners.length, label, streets: pair ? [dict.street.of(a), dict.street.of(b)] : [] });
  }

  const col = { date: [], borough: [], zip: [], corner: [], lat: [], lon: [], severity: [], injured: [], people: [], streets: [] };
  for (const m of MASKS) col[m] = [];
  const labels = {}, coords = {};
  let lat = 0, lon = 0;
  rows.forEach((r, i) => {
    col.date.push(r.severity >= 2 ? r.crash_date : 0);
    col.borough.push(dict.borough.of(r.borough));
    col.zip.push(dict.zip.of(r.zip_code));
    const c = r.corner == null ? null : cornerIndex.get(r.corner);
    col.corner.push(c?.n ?? 0);
    if ((c?.label ?? null) !== (r.corner_label ?? null)) labels[i] = dict.label.of(r.corner_label);
    if (exact(r.lat) && exact(r.lon)) {
      const y = micro(r.lat), x = micro(r.lon);
      col.lat.push(y == null ? null : y - lat);
      col.lon.push(x == null ? null : x - lon);
      if (y != null) lat = y;
      if (x != null) lon = x;
    } else {
      col.lat.push(null); col.lon.push(null);
      coords[i] = [r.lat, r.lon];
    }
    col.severity.push(r.severity);
    col.injured.push(r.injured);
    const people = PEOPLE.map((k) => r[k] ?? 0);
    col.people.push(people.some(Boolean) ? people : 0);
    for (const m of MASKS) col[m].push(r[m]);
    const streets = [...new Set((r.streets ?? []).map(dict.street.of))].filter((n) => !c?.streets.includes(n));
    col.streets.push(streets.length === 1 ? streets[0] : streets.length ? streets : 0);
  });
  return {
    format: FACTS_FORMAT, ...meta, n: rows.length,
    dict: Object.fromEntries(Object.entries(dict).map(([k, d]) => [k, d.list])),
    streetBase, corners, people: PEOPLE, col, labels, coords
  };
}

/*
 * packFacts()'s output (as parsed JSON) → the table summarize() and mapOf()
 * read: one array per column (row i is index i of each), people counts by
 * column name, dictionaries, and lookups for places.
 */
export function unpackFacts(packed) {
  if (packed?.format !== FACTS_FORMAT) throw new Error(`Crash facts format ${packed?.format}, expected ${FACTS_FORMAT}`);
  const { n, col, corners } = packed;
  const dict = { ...packed.dict };
  const int = (list) => Int32Array.from(list);
  const cornerStreets = corners.map((c) => (c.length === 3 ? [c[0], c[1]] : []));
  dict.corner = corners.map((c) => {
    if (c.length === 2) return c[0];
    const [a, b] = [dict.street[c[0] - 1], dict.street[c[1] - 1]];
    return a < b ? `${a}&${b}` : `${b}&${a}`;
  });
  const corner = int(col.corner);
  const label = Int32Array.from(corner, (c) => (c ? corners[c - 1].at(-1) : 0));
  for (const [i, l] of Object.entries(packed.labels)) label[i] = l;

  const lat = new Float64Array(n), lon = new Float64Array(n);
  let y = 0, x = 0;
  for (let i = 0; i < n; i++) {
    if (col.lat[i] == null) lat[i] = NaN; else { y += col.lat[i]; lat[i] = y / 1e6; }
    if (col.lon[i] == null) lon[i] = NaN; else { x += col.lon[i]; lon[i] = x / 1e6; }
  }
  for (const [i, [a, b]] of Object.entries(packed.coords)) { lat[i] = a ?? NaN; lon[i] = b ?? NaN; }

  const t = {
    n, dict, corner, label, lat, lon,
    meta: Object.fromEntries(Object.entries(packed).filter(([k]) => !["n", "dict", "col", "streetBase", "corners", "people", "labels", "coords"].includes(k))),
    date: col.date,
    borough: int(col.borough), zip: int(col.zip),
    severity: int(col.severity), injured: int(col.injured),
    streets: col.streets.map((s, i) => {
      const own = s === 0 ? [] : typeof s === "number" ? [s] : s;
      return corner[i] ? [...cornerStreets[corner[i] - 1], ...own] : own;
    }),
    streetBase: packed.streetBase,
    index: Object.fromEntries(["borough", "zip", "street", "base"].map((k) => [k, new Map(dict[k].map((v, i) => [v, i + 1]))]))
  };
  for (const m of MASKS) t[m] = int(col[m]);
  for (const [i, name] of packed.people.entries()) t[name] = Int32Array.from(col.people, (p) => (p ? p[i] : 0));
  return t;
}

// ---------- Selecting rows ----------

/*
 * The rows a query's place and filters take in, as hotspot-sql.js whereOf()
 * would, and `also`, extra conditions: a function (t, i) → boolean.
 * → [row index]
 */
function select(t, { area, filters = {} }, also = []) {
  const tests = [...areaTests(t, area), ...filterTests(t, filters), ...also];
  const out = [];
  outer: for (let i = 0; i < t.n; i++) {
    for (const f of tests) if (!f(t, i)) continue outer;
    out.push(i);
  }
  return out;
}

function areaTests(t, area) {
  if (!area) return [];
  if (area.kind === "point") {
    const dLat = area.radius / M_LAT, dLon = area.radius / M_LON;
    const lat0 = area.lat - dLat, lat1 = area.lat + dLat, lon0 = area.lon - dLon, lon1 = area.lon + dLon;
    const r2 = area.radius * area.radius;
    return [(t, i) => {
      const lat = t.lat[i], lon = t.lon[i];
      if (!(lat >= lat0 && lat <= lat1 && lon >= lon0 && lon <= lon1)) return false;
      const dy = (lat - area.lat) * M_LAT, dx = (lon - area.lon) * M_LON;
      return dy * dy + dx * dx <= r2;
    }];
  }
  if (area.kind === "street") {
    const tests = area.streets.map((s) => {
      // A street typed without East/West ("72 St") takes in both; with one, only that.
      if (s.key === s.base) {
        const b = t.index.base.get(s.base) ?? -1;
        return (t, i) => t.streets[i].some((n) => t.streetBase[n - 1] === b);
      }
      const k = t.index.street.get(s.key) ?? -1;
      return (t, i) => t.streets[i].includes(k);
    });
    if (area.borough) tests.push(equals("borough", t.index.borough.get(area.borough)));
    return tests;
  }
  if (area.kind === "zip") return [equals("zip", t.index.zip.get(area.zip))];
  if (area.kind === "borough") return [equals("borough", t.index.borough.get(area.borough))];
  return [];
}

const equals = (column, value = -1) => (t, i) => t[column][i] === value;

function filterTests(t, filters) {
  const tests = [];
  for (const d of DIMENSIONS) {
    const mask = maskOf(d.groups, filters[d.param] ?? []);
    if (mask) tests.push((t, i) => (t[d.column][i] & mask) !== 0);
  }
  return tests;
}

const hasCorner = (t, i) => t.corner[i] !== 0;
const hasBorough = (t, i) => t.borough[i] !== 0;

// ---------- Counting ----------

// The people columns to count: everyone, or only the mode's people (hotspot-sql.js peopleOf()).
function peopleOf(filters = {}) {
  const prefixes = (filters.who ?? []).map((k) => KIND_COLUMNS[k]);
  if (!prefixes.length || prefixes.some((p) => !p)) return { injured: ["injured"], killed: ["killed"], serious: ["serious"] };
  return Object.fromEntries(["injured", "killed", "serious"].map((c) => [c, prefixes.map((p) => `${p}_${c}`)]));
}

const sumOf = (t, columns, i) => {
  let s = 0;
  for (const c of columns) s += t[c][i];
  return s;
};

// Rows → readTotals()'s shape (totalsSql()).
function totalsOf(t, rows, filters) {
  const people = peopleOf(filters);
  const out = readTotals();
  for (const i of rows) {
    const sev = t.severity[i];
    out.crashes++;
    out.injured += sumOf(t, people.injured, i);
    out.killed += sumOf(t, people.killed, i);
    out.serious += sumOf(t, people.serious, i);
    if (sev >= 1) out.hurtCrashes++;
    if (sev >= 2) out.ksiCrashes++;
    countGroups(t, i, out.groups, sev >= 2);
  }
  return out;
}

function countGroups(t, i, groups, ksi) {
  for (const d of DIMENSIONS) {
    const v = t[d.column][i];
    if (!v) continue;
    const g = groups[d.column];
    for (const grp of d.groups) {
      if ((v >> grp.bit) & 1) {
        g[grp.key].n++;
        if (ksi) g[grp.key].ksi++;
      }
    }
  }
}

// Rows grouped by a column's value → Map(value → [row]).
function groupBy(t, rows, column) {
  const out = new Map();
  for (const i of rows) {
    const k = t[column][i];
    const list = out.get(k);
    if (list) list.push(i); else out.set(k, [i]);
  }
  return out;
}

const sqliteRound5 = (v) => Math.sign(v) * Math.round(Math.abs(v) * 1e5) / 1e5;

// The ranked intersections (cornersSql() + readCorners()).
function cornersOf(t, query) {
  const people = peopleOf(query.filters);
  const list = [];
  for (const [c, rows] of groupBy(t, select(t, query, [hasCorner]), "corner")) {
    let hurt = 0, ksi = 0, injured = 0, killed = 0, latSum = 0, latN = 0, lonSum = 0, lonN = 0, label = null, borough = null;
    const groups = readTotals().groups;
    for (const i of rows) {
      const sev = t.severity[i];
      if (sev >= 1) hurt++;
      if (sev >= 2) ksi++;
      injured += sumOf(t, people.injured, i);
      killed += sumOf(t, people.killed, i);
      if (!Number.isNaN(t.lat[i])) { latSum += t.lat[i]; latN++; }
      if (!Number.isNaN(t.lon[i])) { lonSum += t.lon[i]; lonN++; }
      const l = t.dict.label[t.label[i] - 1] ?? null;
      if (l != null && (label == null || l < label)) label = l;
      const b = t.dict.borough[t.borough[i] - 1] ?? null;
      if (b != null && (borough == null || b > borough)) borough = b;
      countGroups(t, i, groups, false);
    }
    if (rows.length < MIN_CORNER_CRASHES || hurt < MIN_CORNER_HURT) continue;
    list.push({
      corner: t.dict.corner[c - 1], label, borough,
      lat: latN ? sqliteRound5(latSum / latN) : null,
      lon: lonN ? sqliteRound5(lonSum / lonN) : null,
      n: rows.length, hurt, injured, killed, ksi, groups
    });
  }
  list.sort((a, b) => b.hurt - a.hurt || b.ksi - a.ksi || b.n - a.n || (a.corner < b.corner ? -1 : a.corner > b.corner ? 1 : 0));
  return list.slice(0, TOP_CORNERS);
}

// Where one intersection stands in its borough (cornerRankSql()).
function cornerRank(t, { filters }, borough, hurt) {
  const rows = select(t, { area: { kind: "borough", borough }, filters }, [hasCorner]);
  let total = 0, above = 0;
  const floor = Math.max(0, Math.floor(hurt));
  for (const list of groupBy(t, rows, "corner").values()) {
    let h = 0;
    for (const i of list) if (t.severity[i] >= 1) h++;
    if (h > 0) { total++; if (h > floor) above++; }
  }
  return { total, above };
}

// The borough most of an area's crashes are in, whatever the mode (areaBoroughSql()).
function areaBorough(t, { area }) {
  let best = null, bestN = 0;
  for (const [b, rows] of groupBy(t, select(t, { area }, [hasBorough]), "borough")) {
    const name = t.dict.borough[b - 1];
    if (rows.length > bestN || (rows.length === bestN && name < best)) { best = name; bestN = rows.length; }
  }
  return best;
}

// Each borough's totals and the city's with the mode's filters, the same for every place: worked out once per table.
function cityTotals(t, filters) {
  const key = JSON.stringify(filters ?? {});
  t.cityTotals ??= new Map();
  if (!t.cityTotals.has(key)) {
    const byBorough = groupBy(t, select(t, { area: null, filters }), "borough");
    const boroughs = {};
    const all = [];
    for (const [b, rows] of [...byBorough].sort((x, y) => x[0] - y[0])) {
      const totals = totalsOf(t, rows, filters);
      all.push(totals);
      if (b) boroughs[t.dict.borough[b - 1]] = totals;
    }
    t.cityTotals.set(key, { boroughs, city: addTotals(all) });
  }
  return t.cityTotals.get(key);
}

const isCorner = (area) => area?.kind === "street" && area.streets.length === 2;

/*
 * A view's summary, as /api/crash-hotspots/view gives it (without the dates):
 * → { area, compareTo, here, compare, city, boroughs, corners, rank }
 *   area: { kind ("corner" for an intersection), label } | null
 *   here, compare, city, boroughs[borough]: readTotals(), all with the query's mode.
 *     compare is the area's borough (the one most of its crashes are in), or NYC
 *     for a borough; null for all of NYC.
 *   corners: readCorners(), the intersections where crashes hurt people most often
 *   rank: for an intersection, { label, total, above }, else null
 */
export function summarize(t, query) {
  const { area, filters } = query;
  const { boroughs, city } = cityTotals(t, filters);
  const topBorough = area && area.kind !== "borough" ? areaBorough(t, query) : area?.borough ?? null;
  const here = area ? totalsOf(t, select(t, query), filters) : null;
  const corners = cornersOf(t, query);

  let compareTo = null;
  if (area?.kind === "borough") compareTo = { kind: "city", label: "NYC" };
  else if (area) compareTo = topBorough && boroughs[topBorough] ? { kind: "borough", borough: topBorough, label: boroughLabel(topBorough) } : { kind: "city", label: "NYC" };
  const compare = compareTo ? (compareTo.kind === "borough" ? boroughs[compareTo.borough] : city) : null;

  let rank = null;
  if (isCorner(area) && compareTo?.kind === "borough" && here.hurtCrashes) {
    const r = cornerRank(t, query, compareTo.borough, here.hurtCrashes);
    if (r.total) rank = { label: compareTo.label, total: r.total, above: r.above };
  }
  return {
    area: area ? { kind: isCorner(area) ? "corner" : area.kind, label: area.label } : null,
    compareTo, here: here ?? city, compare, city, boroughs, corners, rank
  };
}

/*
 * Each crash that seriously hurt or killed someone, worst and newest first (pointsSql()).
 * → { points: [[lat, lon, severity, null, date, label]], capped }
 *   The fourth place held the crash's id, which the map never used; it's
 *   left empty so the points keep their shape.
 */
export function mapOf(t, query) {
  const rows = select(t, query, [(t, i) => t.severity[i] >= 2 && !Number.isNaN(t.lat[i])]);
  rows.sort((a, b) => t.severity[b] - t.severity[a] || (t.date[a] < t.date[b] ? 1 : t.date[a] > t.date[b] ? -1 : 0) || t.lat[a] - t.lat[b] || t.lon[a] - t.lon[b]);
  const points = rows.slice(0, MAX_POINTS).map((i) => [t.lat[i], t.lon[i], t.severity[i], null, t.date[i], t.dict.label[t.label[i] - 1] ?? null]);
  return { points, capped: points.length >= MAX_POINTS };
}
