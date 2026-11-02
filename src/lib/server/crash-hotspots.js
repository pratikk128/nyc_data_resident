/*
 * NYC Crash Hotspots on the Worker: the summary and map for a view (a place
 * and filters, hotspot-query.js), read from crash_facts in the crash
 * database (crashes.js, CRASHES_DB). Requests never reach Socrata.
 *
 * Cached at the edge per view, data version and code version; misses are
 * rate limited per client (HOTSPOTS_RATE_LIMITER). The opening view (all of
 * NYC, no filters) is the one most people see and the most rows to read, so
 * it's also kept in KV for each data version.
 */
import { env } from "cloudflare:workers";
import { edgeCached } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { db, dataStatus, codeVersion, NoDatabase } from "./crashes.js";
import { queryKey } from "../crashes/hotspot-query.js";
import { totalsSql, readTotals, hoursSql, monthsSql, cornersSql, readCorners, areaBoroughSql, cellsSql, pointsSql, MAX_POINTS } from "../crashes/hotspot-sql.js";
import { boroughLabel } from "../complaints311/config.js";
import { rowHash } from "../crashes/normalize.js";

export const TTL = 3600;
const KV_TTL = 3 * 86400;

// One statement's rows; a database without crash_facts (built before this dashboard) counts as not loaded.
async function rows({ sql, params }) {
  try {
    return await db().all(sql, params);
  } catch (err) {
    if (/no such table/i.test(err.message)) throw new NoDatabase(err.message);
    throw err;
  }
}

async function cached(kind, query, requestUrl, ctx, clientAddress, compute) {
  const s = await dataStatus();
  const q = queryKey(query);
  const key = `hotspots/${kind}/${codeVersion()}/${s.version}/${q ? rowHash({ q }) : "nyc"}`;
  const withStatus = async () => ({ dataThrough: s.dataThrough, dateFrom: s.dateFrom, ...(await compute()) });
  return edgeCached(requestUrl, key, TTL, async () => {
    const kv = env.DATA_CACHE;
    if (!q && kv) {
      const hit = await kv.get(key, "json");
      if (hit) return hit;
      const value = await withStatus();
      await kv.put(key, JSON.stringify(value), { expirationTtl: KV_TTL });
      return value;
    }
    await checkRateLimit("HOTSPOTS_RATE_LIMITER", clientAddress);
    return withStatus();
  }, ctx);
}

/*
 * What to compare an area with: its borough (the one most of its crashes
 * are in), or all of NYC for a borough. null for all of NYC.
 * → { kind: "borough", borough, label } | { kind: "city", label } | null
 */
async function comparisonFor(area) {
  if (!area) return null;
  if (area.kind === "borough") return { kind: "city", label: "NYC" };
  const [top] = await rows(areaBoroughSql({ area }));
  return top ? { kind: "borough", borough: top.borough, label: boroughLabel(top.borough) } : { kind: "city", label: "NYC" };
}

/*
 * → { dataThrough, dateFrom, area, compareTo, here, compare, hours, months, corners: { crashes, ksi } }
 *   here, compare: readTotals() (compare is null for all of NYC)
 *   hours: [[dow, hour, crashes, ksi]]; months: [[YYYY-MM, crashes, hurt, ksi]]
 */
export function loadSummary(query, requestUrl, ctx, clientAddress) {
  return cached("summary", query, requestUrl, ctx, clientAddress, async () => {
    const compareTo = await comparisonFor(query.area);
    const compareQuery = compareTo && {
      area: compareTo.kind === "borough" ? { kind: "borough", borough: compareTo.borough } : null,
      filters: query.filters
    };
    const [[here], compare, hours, months, byCrashes, byKsi] = await Promise.all([
      rows(totalsSql(query)),
      compareQuery ? rows(totalsSql(compareQuery)).then(([r]) => readTotals(r)) : null,
      rows(hoursSql(query)),
      rows(monthsSql(query)),
      rows(cornersSql(query, "crashes")),
      rows(cornersSql(query, "ksi"))
    ]);
    return {
      area: query.area ? { kind: query.area.kind, label: query.area.label } : null,
      compareTo,
      here: readTotals(here),
      compare,
      hours: hours.map((r) => [r.dow, r.hour, r.n, r.ksi]),
      months: months.map((r) => [r.month, r.n, r.hurt, r.ksi]),
      corners: { crashes: readCorners(byCrashes), ksi: readCorners(byKsi) }
    };
  });
}

/*
 * → { dataThrough, dateFrom, cells: [[lat, lon, crashes, ksi]], points: [[lat, lon, severity, id, date, label]], capped }
 */
export function loadMap(query, requestUrl, ctx, clientAddress) {
  return cached("map", query, requestUrl, ctx, clientAddress, async () => {
    const [cells, points] = await Promise.all([rows(cellsSql(query)), rows(pointsSql(query))]);
    return {
      cells: cells.map((c) => [c.lat, c.lon, c.n, c.ksi]),
      points: points.map((p) => [p.lat, p.lon, p.severity, p.id, p.date, p.label]),
      capped: points.length >= MAX_POINTS
    };
  });
}
