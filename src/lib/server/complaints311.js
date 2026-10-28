/*
 * 311 Service Requests queries (dataset erm2-nwe9). Builds on socrata.js; the
 * query text comes from src/lib/complaints311/soql.js and the math from stats.js.
 *
 * Borough and city baselines (share of requests by complaint type, by location
 * type and open vs closed, for each time window) take Socrata about
 * a minute per query, so they're daily jobs kept in KV. Areas around a point,
 * and ZIPs, take a few seconds and are cached at the edge for AREA_TTL.
 */
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue } from "./cache.js";
import {
  DATASET_ID, FIELDS as F, WINDOWS, RADII, BOROUGHS, UNSPECIFIED_BOROUGH, STATUS_CLOSED
} from "../complaints311/config.js";
import {
  windowStart, circle, typeCountParams, locationTypeCountParams, statusCountParams,
  boroughCountParams, zipSummaryParams, baselineParams
} from "../complaints311/soql.js";
import { typeCounts, locationCounts, statusCounts, sum } from "../complaints311/stats.js";
import { typeKey, locationGroup } from "../complaints311/labels.js";

export const AREA_TTL = 6 * 3600;      // areas and ZIPs: the data updates once a day
export const BASELINE_TTL = 3600;      // the baseline API response (the value itself lives in KV)
const BASELINE_TIMEOUT_MS = 240000;    // ~1 minute each on a good day

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

export const complaints311DailyJobs = [metadataJob, ...Object.values(baselineJobs)];

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
