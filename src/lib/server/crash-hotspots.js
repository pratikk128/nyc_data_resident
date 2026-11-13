/*
 * NYC Crash Hotspots on the Worker. No request reads D1: the free plan
 * allows 5M rows read a day, and every view used to scan crash_facts (about
 * 80,000 rows) three or four times.
 *
 * Instead the data refresh (scripts/run-etl.mjs, right after the crash sync
 * in crashes.js) runs hotspotsJob: it reads crash_facts once and writes to KV
 *   - FACTS_KEY, the whole year packed small (hotspot-compute.js packFacts(),
 *     about 1 MB compressed), which the page downloads for a ZIP, street,
 *     intersection or spot and counts itself;
 *   - viewKey(), the summary and map of each view it can work out ahead: all
 *     of NYC and each borough, with no mode and with each, 24 in all;
 *   - the job's own value (dailyValue()), what was built and the data's
 *     dates, which the page header and /api/etl/status read.
 * Requests pass those values through as text, so they cost a KV read and
 * almost no CPU, and are cached at the edge.
 *
 * In astro dev and tests, a view with nothing built yet builds it from the
 * local D1 (dailyValue()); in production it says the data isn't loaded.
 */
import { env } from "cloudflare:workers";
import { dailyValue, edgeCachedResponse } from "./cache.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { dateRange } from "../crashes/config.js";
import { MODES, readQuery } from "../crashes/hotspot-query.js";
import { factsPageSql, STREET_SEP } from "../crashes/hotspot-sql.js";
import { packFacts, unpackFacts, summarize, mapOf, FACTS_FORMAT } from "../crashes/hotspot-compute.js";
import { BOROUGHS } from "../complaints311/config.js";

export class NoDatabase extends Error {}
export const NOT_LOADED_TEXT = "The crash data isn’t loaded yet. Try again later.";

export const FACTS_KEY = `crashes:hotspots:facts:v${FACTS_FORMAT}`;
const PAGE = 10000; // crash_facts rows per D1 read

// The views built ahead: all of NYC or a borough, with no mode or one.
export const isPrebuilt = (query) => !query.area || query.area.kind === "borough";
export const viewKey = ({ area, mode }) =>
  `crashes:hotspots:view:v${FACTS_FORMAT}:${area?.borough ?? "nyc"}:${mode ?? "all"}`;
const PREBUILT = [null, ...BOROUGHS.map((b) => b.value)].flatMap((boro) =>
  [null, ...MODES.map((m) => m.key)].map((mode) => readQuery(new URLSearchParams({ ...(boro && { boro }), ...(mode && { mode }) }))));

async function d1All(d1, { sql, params }) {
  try {
    return (await d1.prepare(sql).bind(...params).all()).results;
  } catch (err) {
    // No tables yet: nothing has been loaded into this database.
    if (/no such table/i.test(err.message)) throw new NoDatabase(err.message);
    throw err;
  }
}

// Every crash_facts row with its street keys, a page at a time.
async function readFacts(d1) {
  const rows = [];
  for (let after = ""; ;) {
    const page = await d1All(d1, factsPageSql(after, PAGE));
    for (const r of page) rows.push({ ...r, streets: r.streets ? r.streets.split(STREET_SEP) : [] });
    if (page.length < PAGE) return rows;
    after = page.at(-1).collision_id;
  }
}

/*
 * The build. Its value (what dailyValue() keeps) is
 *   { version, dataThrough, dateFrom, crashes, lastFull, lastSync, factsBytes, views }
 * version is when it was built; dataThrough the newest crash.
 */
export const hotspotsJob = {
  key: `crashes:hotspots:v${FACTS_FORMAT}`,
  maxAgeHours: requestMaxAgeHours("daily", true),
  async run() {
    const d1 = env.CRASHES_DB;
    const kv = env.DATA_CACHE;
    if (!d1) throw new NoDatabase("No CRASHES_DB binding");
    const logs = await d1All(d1, { sql: "SELECT kind, max(finished_at) AS at FROM ingest_log WHERE finished_at IS NOT NULL GROUP BY kind", params: [] });
    const at = Object.fromEntries(logs.map((l) => [l.kind, l.at]));
    const rows = await readFacts(d1);
    if (!rows.length) throw new NoDatabase("crash_facts is empty");

    let dataThrough = null;
    for (const r of rows) if (!dataThrough || r.crash_date > dataThrough) dataThrough = r.crash_date;
    const meta = {
      version: new Date().toISOString(),
      dataThrough, dateFrom: dateRange().from, crashes: rows.length,
      lastFull: at.full ?? null, lastSync: at.sync ?? null
    };
    const packed = packFacts(rows, meta);
    const facts = JSON.stringify(packed);
    const t = unpackFacts(packed);
    const dates = { dataThrough: meta.dataThrough, dateFrom: meta.dateFrom };
    // The data first: the job's value, written after run() returns, says it's there.
    for (const query of PREBUILT) {
      await kv?.put(viewKey(query), JSON.stringify({ summary: { ...dates, ...summarize(t, query) }, map: { ...dates, ...mapOf(t, query) } }));
    }
    await kv?.put(FACTS_KEY, facts);
    return { ...meta, factsBytes: facts.length, views: PREBUILT.length };
  }
};

// The last build's dates (for the page header), building it first where that's allowed (dailyValue()).
export const hotspotsStatus = () => dailyValue(hotspotsJob);

const TTL = 1800;

// One stored value as the response body, untouched (no parsing), cached at the edge per build.
async function passThrough(key, requestUrl, ctx) {
  const status = await hotspotsStatus();
  return edgeCachedResponse(requestUrl, `hotspots/${status.version}/${key}`, async () => {
    const body = await env.DATA_CACHE?.get(key, "stream");
    if (!body) throw new NoDatabase(`${key} isn't in KV`);
    return new Response(body, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${TTL}` }
    });
  }, ctx);
}

/*
 * → Response: { summary, map } for all of NYC or a borough (isPrebuilt()).
 *   summary: { dataThrough, dateFrom, ...summarize() }
 *   map: { dataThrough, dateFrom, ...mapOf() }
 */
export const viewResponse = (query, requestUrl, ctx) => passThrough(viewKey(query), requestUrl, ctx);

// → Response: the packed facts (packFacts()), for the page to count any other place itself.
export const factsResponse = (requestUrl, ctx) => passThrough(FACTS_KEY, requestUrl, ctx);
