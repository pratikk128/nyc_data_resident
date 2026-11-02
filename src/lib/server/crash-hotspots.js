/*
 * NYC Crash Hotspots on the Worker: the summary and map for a view (a place
 * and filters, hotspot-query.js), read from crash_facts in the crash
 * database (crashes.js, CRASHES_DB). Requests never reach Socrata.
 *
 * Cached at the edge per view, data version and code version; misses are
 * rate limited per client (HOTSPOTS_RATE_LIMITER). The opening view (all of
 * NYC, no filters) is the one most people see and the most rows to read, so
 * it's also kept in KV for each data version (and so is each mode's
 * citywide view, three more).
 */
import { env } from "cloudflare:workers";
import { edgeCached } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { db, dataStatus, codeVersion, NoDatabase } from "./crashes.js";
import { queryKey } from "../crashes/hotspot-query.js";
import { totalsSql, boroughTotalsSql, readTotals, addTotals, cornersSql, readCorners, cornerRankSql, areaBoroughSql, pointsSql, MAX_POINTS } from "../crashes/hotspot-sql.js";
import { boroughLabel } from "../complaints311/config.js";
import { rowHash } from "../crashes/normalize.js";

export const TTL = 3600;
// Bump when the responses change shape, so no cache (including dev's, where codeVersion() is fixed) serves the old one.
const FORMAT = 2;
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
  const key = `hotspots/${kind}/${FORMAT}/${codeVersion()}/${s.version}/${query.area ? rowHash({ q }) : `nyc${query.mode ? `-${query.mode}` : ""}`}`;
  const withStatus = async () => ({ dataThrough: s.dataThrough, dateFrom: s.dateFrom, ...(await compute()) });
  return edgeCached(requestUrl, key, TTL, async () => {
    const kv = env.DATA_CACHE;
    if (!query.area && kv) {
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

const isCorner = (area) => area?.kind === "street" && area.streets.length === 2;

/*
 * → { dataThrough, dateFrom, area, compareTo, here, compare, city, boroughs, corners, rank }
 *   area: { kind ("corner" for an intersection), label } | null
 *   here, compare, city, boroughs[borough]: readTotals(), all with the query's mode.
 *     compare is the area's borough (the one most of its crashes are in), or NYC
 *     for a borough; null for all of NYC.
 *   corners: readCorners(), the intersections where crashes hurt people most often
 *   rank: for an intersection, { label, total, above } (cornerRankSql), else null
 */
export function loadSummary(query, requestUrl, ctx, clientAddress) {
  return cached("summary", query, requestUrl, ctx, clientAddress, async () => {
    const { area } = query;
    const [byBorough, topBorough, here, corners] = await Promise.all([
      rows(boroughTotalsSql(query)),
      area && area.kind !== "borough" ? rows(areaBoroughSql(query)).then(([r]) => r?.borough ?? null) : area?.borough ?? null,
      area ? rows(totalsSql(query)).then(([r]) => readTotals(r)) : null,
      rows(cornersSql(query)).then(readCorners)
    ]);
    const boroughs = Object.fromEntries(byBorough.filter((r) => r.borough).map((r) => [r.borough, readTotals(r)]));
    const city = addTotals(byBorough.map((r) => readTotals(r)));
    let compareTo = null;
    if (area?.kind === "borough") compareTo = { kind: "city", label: "NYC" };
    else if (area) compareTo = topBorough && boroughs[topBorough] ? { kind: "borough", borough: topBorough, label: boroughLabel(topBorough) } : { kind: "city", label: "NYC" };
    const compare = compareTo ? (compareTo.kind === "borough" ? boroughs[compareTo.borough] : city) : null;

    let rank = null;
    if (isCorner(area) && compareTo?.kind === "borough" && here.hurtCrashes) {
      const [r] = await rows(cornerRankSql(query, compareTo.borough, here.hurtCrashes));
      if (r?.total) rank = { label: compareTo.label, total: r.total, above: r.above };
    }
    return {
      area: area ? { kind: isCorner(area) ? "corner" : area.kind, label: area.label } : null,
      compareTo, here: here ?? city, compare, city, boroughs, corners, rank
    };
  });
}

/*
 * → { dataThrough, dateFrom, points: [[lat, lon, severity, id, date, label]], capped }
 */
export function loadMap(query, requestUrl, ctx, clientAddress) {
  return cached("map", query, requestUrl, ctx, clientAddress, async () => {
    const points = await rows(pointsSql(query));
    return {
      points: points.map((p) => [p.lat, p.lon, p.severity, p.id, p.date, p.label]),
      capped: points.length >= MAX_POINTS
    };
  });
}
