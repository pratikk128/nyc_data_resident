/*
 * 311 Service Requests queries (dataset erm2-nwe9). Builds on socrata.js; the
 * query text comes from src/lib/complaints311/soql.js and the math from stats.js.
 *
 * Borough and city baselines (share of requests by complaint type, by location
 * type and open vs closed, for each time window) and the citywide distribution
 * of ¼ and 1 mile counts take Socrata about a minute per query, so they're
 * daily jobs kept in KV. Areas around a point,
 * and ZIPs, take a few seconds and are cached at the edge for AREA_TTL.
 */
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue } from "./cache.js";
import {
  DATASET_ID, FIELDS as F, WINDOWS, RADII, BOROUGHS, UNSPECIFIED_BOROUGH, STATUS_CLOSED, GRID_CHUNK_MONTHS,
  HEATMAP_CELLS_PER_DEGREE
} from "../complaints311/config.js";
import {
  windowStart, windowChunks, circle, typeCountParams, locationTypeCountParams, statusCountParams,
  boroughCountParams, zipSummaryParams, baselineParams, gridCountParams, heatmapParams
} from "../complaints311/soql.js";
import { typeCounts, locationCounts, statusCounts, sum, circleDistributions } from "../complaints311/stats.js";
import { typeKey, locationGroup } from "../complaints311/labels.js";

export const AREA_TTL = 6 * 3600;      // areas and ZIPs: the data updates once a day
export const BASELINE_TTL = 3600;      // the baseline API response (the value itself lives in KV)
const BASELINE_TIMEOUT_MS = 240000;    // ~1 minute each on a good day
const HEATMAP_TIMEOUT_MS = 45000;      // a few seconds warm, but a cold 1 mile query can pass the default 20

const today = () => new Date().toISOString().slice(0, 10);

// Rounded to ~100 m so nearby lookups share a cache entry (and the same query).
export const roundCoord = (v) => Math.round(Number(v) * 1000) / 1000;

// ---------- Daily jobs (see daily-jobs.js) ----------

export const metadataJob = {
  key: `311:metadata:${DATASET_ID}`,
  maxAgeHours: 26,
  run: () => datasetMetadata(DATASET_ID)
};

function emptyArea() {
  return { total: 0, types: {}, locations: {}, status: { open: 0, closed: 0 } };
}

// One job per window: every borough's counts, and the city's (Unspecified included).
function baselineJob(windowKey) {
  return {
    key: `311:baseline:v1:${windowKey}`,
    maxAgeHours: 26,
    async run() {
      const since = windowStart(windowKey);
      const through = today();
      const started = Date.now();
      const opts = { timeoutMs: BASELINE_TIMEOUT_MS };
      const [types, locations, statuses] = await Promise.all([
        soql(DATASET_ID, baselineParams(since, F.type), opts),
        soql(DATASET_ID, baselineParams(since, F.locationType), opts),
        soql(DATASET_ID, baselineParams(since, F.status), opts)
      ]);
      console.log(`311 baseline ${windowKey}: ${Date.now() - started} ms`);

      const city = emptyArea();
      const boroughs = Object.fromEntries(BOROUGHS.map((b) => [b.value, emptyArea()]));
      const targets = (row) => [city, row[F.borough] !== UNSPECIFIED_BOROUGH ? boroughs[row[F.borough]] : null].filter(Boolean);
      const add = (obj, key, n) => { obj[key] = (obj[key] ?? 0) + n; };

      for (const row of types) {
        for (const t of targets(row)) { add(t.types, typeKey(row[F.type]), Number(row.n)); t.total += Number(row.n); }
      }
      for (const row of locations) {
        for (const t of targets(row)) add(t.locations, locationGroup(row[F.locationType]), Number(row.n));
      }
      for (const row of statuses) {
        for (const t of targets(row)) add(t.status, row[F.status] === STATUS_CLOSED ? "closed" : "open", Number(row.n));
      }
      return {
        window: windowKey,
        since,
        through,
        computedAt: new Date().toISOString(),
        city,
        boroughs
      };
    }
  };
}

export const baselineJobs = Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, baselineJob(w)]));

/*
 * One job per window: how many requests fall within ¼ and 1 mile of every
 * ~100 m grid cell in the city that has any, so a spot's counts can be ranked
 * against the rest of NYC. The grid query runs in GRID_CHUNK_MONTHS pieces at
 * once (a cell can appear in several; its counts are added up).
 */
function distributionJob(windowKey) {
  return {
    key: `311:distribution:v1:${windowKey}`,
    maxAgeHours: 26,
    async run() {
      const since = windowStart(windowKey);
      const through = today();
      const started = Date.now();
      const chunks = await Promise.all(windowChunks(windowKey, GRID_CHUNK_MONTHS).map((c) =>
        soql(DATASET_ID, gridCountParams(c.since, c.until), { timeoutMs: BASELINE_TIMEOUT_MS })));
      const cells = new Map();
      for (const row of chunks.flat()) {
        if (row.y == null || row.x == null) continue; // no coordinates
        const key = `${row.y},${row.x}`;
        const cell = cells.get(key) ?? { y: Number(row.y), x: Number(row.x), n: 0 };
        cell.n += Number(row.n);
        cells.set(key, cell);
      }
      const dist = circleDistributions([...cells.values()], RADII);
      console.log(`311 distribution ${windowKey}: ${Date.now() - started} ms, ${dist.samples} locations`);
      return { window: windowKey, since, through, computedAt: new Date().toISOString(), ...dist };
    }
  };
}

export const distributionJobs = Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, distributionJob(w)]));

export const complaints311DailyJobs = [metadataJob, ...Object.values(baselineJobs), ...Object.values(distributionJobs)];

export function distribution(windowKey) {
  return dailyValue(distributionJobs[windowKey]);
}

export function getMetadata() {
  return dailyValue(metadataJob);
}

// The city, plus one borough (or none), for a window.
export async function baseline(windowKey, borough) {
  const all = await dailyValue(baselineJobs[windowKey]);
  // Each area carries its window, like a radius summary, so the page can treat them alike.
  const area = (a) => (a ? { ...a, window: all.window, since: all.since, through: all.through } : null);
  return {
    window: all.window,
    since: all.since,
    through: all.through,
    computedAt: all.computedAt,
    city: area(all.city),
    borough: borough ? area(all.boroughs[borough]) : null
  };
}

// ---------- Areas ----------

// Counts for one area (`where` is a SoQL test) over a window, three queries at once (four with the borough).
async function areaSummary(where, windowKey, { withBorough = false } = {}) {
  const since = windowStart(windowKey);
  const through = today();
  const queries = [
    soql(DATASET_ID, typeCountParams(since, where)),
    soql(DATASET_ID, locationTypeCountParams(since, where)),
    soql(DATASET_ID, statusCountParams(since, where)),
    withBorough ? soql(DATASET_ID, boroughCountParams(since, where)) : Promise.resolve([])
  ];
  const [types, locations, statuses, boroughRows] = await Promise.all(queries);
  const typeMap = typeCounts(types);
  return {
    window: windowKey,
    since,
    through,
    total: sum(typeMap),
    types: typeMap,
    locations: locationCounts(locations),
    status: statusCounts(statuses),
    // Most common borough among these requests (Unspecified left out); for when the geocoder didn't say.
    topBorough: boroughRows[0]?.[F.borough] ?? null
  };
}

// areaKey: "immediate" | "neighborhood". Logs how long each radius takes.
export async function radiusSummary(lat, lon, areaKey, windowKey) {
  const started = Date.now();
  const summary = await areaSummary(circle(roundCoord(lat), roundCoord(lon), RADII[areaKey]), windowKey, {
    withBorough: areaKey === "neighborhood"
  });
  console.log(`311 radius ${areaKey} (${RADII[areaKey]} m) ${windowKey} at ${roundCoord(lat)},${roundCoord(lon)}: ` +
    `${Date.now() - started} ms, ${summary.total} requests`);
  return { ...summary, area: areaKey, center: { lat: roundCoord(lat), lon: roundCoord(lon) }, radius: RADII[areaKey] };
}

/*
 * The heat map: requests per ~50 m cell within the 1 mile circle, as
 * [lat, lon, n] at each cell's middle. `types` (typeKey() values) narrows it.
 */
export async function heatmapCells(lat, lon, windowKey, types = []) {
  const since = windowStart(windowKey);
  const g = HEATMAP_CELLS_PER_DEGREE;
  const started = Date.now();
  const where = circle(roundCoord(lat), roundCoord(lon), RADII.neighborhood);
  const rows = await soql(DATASET_ID, heatmapParams(since, where, types), { timeoutMs: HEATMAP_TIMEOUT_MS });
  const cells = [];
  for (const r of rows) {
    if (r.y == null || r.x == null) continue;
    cells.push([Math.round(((Number(r.y) + 0.5) / g) * 1e5) / 1e5, Math.round(((Number(r.x) + 0.5) / g) * 1e5) / 1e5, Number(r.n)]);
  }
  console.log(`311 heatmap ${windowKey} at ${roundCoord(lat)},${roundCoord(lon)} (${types.length} types): ` +
    `${Date.now() - started} ms, ${cells.length} cells`);
  return {
    window: windowKey, since, through: today(),
    center: { lat: roundCoord(lat), lon: roundCoord(lon) }, radius: RADII.neighborhood,
    total: cells.reduce((a, c) => a + c[2], 0),
    cells
  };
}

/*
 * A ZIP on its own: how many requests name it, and a centre for the radius
 * views (the average location of its requests, weighted by count) and its
 * borough. null when nothing in the window names the ZIP.
 */
export async function zipSummary(zip, windowKey) {
  const since = windowStart(windowKey);
  const rows = await soql(DATASET_ID, zipSummaryParams(since, zip));
  const total = rows.reduce((a, r) => a + Number(r.n || 0), 0);
  if (!total) return null;
  let lat = 0, lon = 0, weight = 0;
  for (const r of rows) {
    if (r.lat == null || r.lon == null) continue;
    lat += Number(r.lat) * Number(r.n);
    lon += Number(r.lon) * Number(r.n);
    weight += Number(r.n);
  }
  const borough = rows.find((r) => r[F.borough] !== UNSPECIFIED_BOROUGH)?.[F.borough] ?? null;
  return {
    zip, window: windowKey, since, total, borough,
    center: weight ? { lat: Math.round((lat / weight) * 1e5) / 1e5, lon: Math.round((lon / weight) * 1e5) / 1e5 } : null
  };
}
