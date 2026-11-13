/*
 * NYC Crash Hotspots: the build (run by the data refresh, outside the Worker)
 * and the two responses the Worker passes through.
 *
 * The data refresh (scripts/run-etl.mjs, dataset `crashes` in crashes.js)
 * runs hotspotsJob. It pages through a year of the three NYPD tables on NYC
 * Open Data (fetchYear()), boils each crash down to one facts row
 * (factsFromSource(), facts.js), and writes to KV
 *   - FACTS_KEY, the whole year packed small (hotspot-compute.js packFacts(),
 *     about 1 MB compressed), which the page downloads for a ZIP, street,
 *     intersection or spot and counts itself;
 *   - viewKey(), the summary and map of each view it can work out ahead: all
 *     of NYC and each borough, with no mode and with each, 24 in all;
 *   - the job's own value (dailyValue()), what was built and the data's
 *     dates, which the page header and /api/etl/status read.
 * Requests pass those values through as text, so they cost a KV read and
 * almost no CPU, and are cached at the edge. Nothing is stored between
 * builds but KV: each build starts from the source, so amendments and rows
 * the city deleted are picked up the next day.
 *
 * In astro dev and tests, a view with nothing built yet builds it on the
 * spot (dailyValue(); a few minutes of Socrata queries, so seed it first
 * with npm run data:hotspots -- --local). In production it says the data
 * isn't loaded.
 */
import { env } from "cloudflare:workers";
import { dailyValue, edgeCachedResponse } from "./cache.js";
import { soql, SocrataError } from "./socrata.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { DATASETS, SOURCE_COLUMNS, dateRange, dateWhere } from "../crashes/config.js";
import { crashRow, streetRows, vehicleRow, personRow } from "../crashes/rows.js";
import { factsRow, byCrash } from "../crashes/facts.js";
import { MODES, readQuery } from "../crashes/hotspot-query.js";
import { packFacts, unpackFacts, summarize, mapOf, FACTS_FORMAT } from "../crashes/hotspot-compute.js";
import { BOROUGHS } from "../complaints311/config.js";

export class NotLoaded extends Error {}
export const NOT_LOADED_TEXT = "The crash data isn’t loaded yet. Try again later.";

export const FACTS_KEY = `crashes:hotspots:facts:v${FACTS_FORMAT}`;

// The views built ahead: all of NYC or a borough, with no mode or one.
export const isPrebuilt = (query) => !query.area || query.area.kind === "borough";
export const viewKey = ({ area, mode }) =>
  `crashes:hotspots:view:v${FACTS_FORMAT}:${area?.borough ?? "nyc"}:${mode ?? "all"}`;
const PREBUILT = [null, ...BOROUGHS.map((b) => b.value)].flatMap((boro) =>
  [null, ...MODES.map((m) => m.key)].map((mode) => readQuery(new URLSearchParams({ ...(boro && { boro }), ...(mode && { mode }) }))));

// ---------- The source ----------

/*
 * Paging. Socrata's speed swings widely: a 50,000-row page can take 30 s one
 * hour and time out after 5 minutes the next, when 5,000 rows still take
 * 20 s. So pages start big (fast on a good day), and a page that fails is
 * retried at half the size, down to MIN_PAGE; later pages, including the
 * next table's, keep the size that worked.
 *
 * The whole fetch has a budget. The data refresh sends every KV write at the
 * end of its run, so if the workflow's time limit killed the run, every
 * other dataset's rebuild would be lost too; running out of budget fails
 * only this job (the last build stays in KV).
 */
const MAX_PAGE = 50000;
const MIN_PAGE = 5000;
const TIMEOUT_MS = 120e3;      // per request
const RETRIES = 6;             // failures in a row on one page before giving up
const BUDGET_MS = 20 * 60e3;   // the whole fetch; the workflow allows 45 minutes for the whole refresh
const MIN_SHARE = 0.8;         // of the last build's crashes the source must still have

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Every row of one table in the date range, in Socrata's own row order
 * (:id), which is what Socrata recommends for paging and is fast: ordering
 * by a column like unique_id makes it sort the whole range for every page,
 * and a first page could take minutes. Rows the city republishes mid-pull
 * could repeat, so they're kept once, by key.
 *   paging  { size, deadline }, shared across the tables of one fetch
 */
async function fetchTable(table, where, paging) {
  const { id, key } = DATASETS[table];
  const rows = new Map();
  let offset = 0, failures = 0;
  for (;;) {
    if (Date.now() > paging.deadline) throw new Error(`Crash data: out of time fetching ${table} (row ${offset.toLocaleString()}); keeping the last build`);
    const size = paging.size;
    let got;
    try {
      got = await soql(id, {
        $select: SOURCE_COLUMNS[table].join(","),
        $where: where,
        $order: ":id",
        $limit: String(size),
        $offset: String(offset)
      }, { timeoutMs: TIMEOUT_MS });
    } catch (err) {
      // 4xx (other than throttling) is a bad query: retrying won't help.
      const fatal = err instanceof SocrataError && err.status >= 400 && err.status < 500 && err.status !== 429;
      if (fatal || ++failures >= RETRIES) throw err;
      paging.size = Math.max(MIN_PAGE, Math.floor(size / 2));
      const wait = 5000 * failures;
      console.warn(`Crash data: ${table} at row ${offset.toLocaleString()}: ${err.message}; retrying in ${wait / 1000} s with ${paging.size.toLocaleString()}-row pages`);
      await sleep(wait);
      continue;
    }
    failures = 0;
    for (const r of got) rows.set(r[key], r);
    offset += got.length;
    if (got.length < size) return [...rows.values()];
  }
}

// { crashes, vehicles, persons }: the source rows for the date range. One table
// at a time: Socrata throttles parallel pulls of these into timeouts.
export async function fetchYear(range = dateRange(), { budgetMs = BUDGET_MS } = {}) {
  const where = dateWhere(range);
  const paging = { size: MAX_PAGE, deadline: Date.now() + budgetMs };
  const out = {};
  for (const table of Object.keys(DATASETS)) {
    const started = Date.now();
    out[table] = await fetchTable(table, where, paging);
    console.log(`Crash data: ${out[table].length.toLocaleString()} ${table} (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  return out;
}

/*
 * Source rows → the facts rows packFacts() takes: one per crash (factsRow()),
 * each with `streets`, the street keys it names. Vehicles and persons whose
 * crash isn't in the range are left out. Pure; exported for tests.
 */
export function factsFromSource({ crashes, vehicles, persons }) {
  const vehiclesOf = byCrash(vehicles.map(vehicleRow));
  const personsOf = byCrash(persons.map(personRow));
  return crashes.map((raw) => {
    const crash = crashRow(raw);
    const row = factsRow(crash, vehiclesOf.get(crash.collision_id), personsOf.get(crash.collision_id));
    return { ...row, streets: streetRows(crash).map((s) => s.street) };
  });
}

// ---------- The build ----------

/*
 * Its value (what dailyValue() keeps) is
 *   { version, dataThrough, dateFrom, crashes, factsBytes, views }
 * version is when it was built; dataThrough the newest crash.
 */
export const hotspotsJob = {
  key: `crashes:hotspots:v${FACTS_FORMAT}`,
  maxAgeHours: requestMaxAgeHours("daily", true),
  async run(source) {
    const kv = env.DATA_CACHE;
    const range = dateRange();
    const rows = factsFromSource(source ?? await fetchYear(range));
    // Far fewer crashes than last time is an outage or a half-published
    // dataset, not a quiet year: keep the last build rather than replace it.
    const last = (await kv?.get(hotspotsJob.key, "json").catch(() => null))?.value;
    if (!rows.length || (last?.crashes && rows.length < last.crashes * MIN_SHARE)) {
      throw new Error(`NYC Open Data returned ${rows.length} crashes since ${range.from} (the last build had ${last?.crashes ?? 0}); keeping the last build`);
    }

    let dataThrough = null;
    for (const r of rows) if (!dataThrough || r.crash_date > dataThrough) dataThrough = r.crash_date;
    const meta = { version: new Date().toISOString(), dataThrough, dateFrom: range.from, crashes: rows.length };
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
    if (!body) throw new NotLoaded(`${key} isn't in KV`);
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
