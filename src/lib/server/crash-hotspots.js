/*
 * NYC Crash Hotspots: the build (run by the data refresh, outside the Worker)
 * and the two responses the Worker passes through.
 *
 * The data refresh (scripts/run-etl.mjs, dataset `crashes` in crashes.js)
 * runs hotspotsJob. It fetches a year of the NYPD crashes and vehicles
 * tables on NYC Open Data, a month at a time (fetchYear()), boils each crash down to one facts row
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
import { DATASETS, SOURCE_COLUMNS, REBUILD_HOURS, dateRange } from "../crashes/config.js";
import { nycToday } from "../format.js";
import { crashRow, streetRows, vehicleRow } from "../crashes/rows.js";
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
 * Paging, by date. Socrata's speed swings widely, and an $offset page costs
 * more the deeper it is: Socrata walks every earlier row to get there, so
 * on a slow day a 5,000-row page at row 150,000 of the vehicles took over
 * 5 minutes, while a whole month (about 15,000 vehicles) by date took under
 * a minute. ($where on :id isn't possible: Socrata won't compare it to text.)
 *
 * So each table is fetched a calendar month at a time, never with an
 * offset. A month that fails (a timeout, a 5xx) is split in half and both
 * halves tried, down to a single day; the next month starts whole again.
 * A window that comes back full (LIMIT rows) is split too, rather than
 * paged. A single day that keeps failing is retried after a growing wait,
 * and STREAK failures in a row with nothing fetched give up.
 *
 * The whole fetch has a budget. The data refresh sends every KV write at the
 * end of its run, so if the workflow's time limit killed the run, every
 * other dataset's rebuild would be lost too; running out of budget fails
 * only this job (the last build stays in KV).
 */
const LIMIT = 50000;           // rows per request; a month is about 7,000 crashes and 15,000 vehicles
const TIMEOUT_MS = 120e3;      // per request
const STREAK = 10;             // failures in a row before giving up
const BUDGET_MS = 20 * 60e3;   // the whole fetch; the workflow allows 45 minutes for the whole refresh
const MIN_SHARE = 0.8;         // of the last build's crashes the source must still have

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const nextMonth = (date) => {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

/*
 * The range as windows { from, to } of whole calendar months (the first from
 * range.from), `to` exclusive; the last is open-ended (to: null) when the
 * range runs through the latest crash. Exported for tests.
 */
export function monthWindows({ from, to }, today = nycToday()) {
  const end = to ? addDays(to, 1) : null;
  const last = end ?? addDays(today, 1);
  const out = [];
  for (let start = from; start < last;) {
    const next = nextMonth(start);
    if (next >= last) { out.push({ from: start, to: end }); break; }
    out.push({ from: start, to: next });
    start = next;
  }
  return out;
}

// A window in two, or null for a single day. An open-ended window ends today.
function split(w, today) {
  const days = daysBetween(w.from, w.to ?? addDays(today, 1));
  if (days <= 1) return null;
  const mid = addDays(w.from, Math.floor(days / 2));
  return [{ from: w.from, to: mid }, { from: mid, to: w.to }];
}

const windowWhere = ({ from, to }) =>
  `crash_date >= '${from}T00:00:00'${to ? ` AND crash_date < '${to}T00:00:00'` : ""}`;
const windowLabel = ({ from, to }) => `${from}…${to ? addDays(to, -1) : "latest"}`;

/*
 * Every row of one table in the date range, window by window. Rows the city
 * republishes mid-pull could repeat, so they're kept once, by key.
 */
async function fetchTable(table, range, { deadline, today }) {
  const { id, key } = DATASETS[table];
  const rows = new Map();
  const queue = monthWindows(range, today);
  let streak = 0;
  while (queue.length) {
    const w = queue.shift();
    if (Date.now() > deadline) throw new Error(`Crash data: out of time fetching ${table} (at ${windowLabel(w)}); keeping the last build`);
    let got;
    try {
      got = await soql(id, {
        $select: SOURCE_COLUMNS[table].join(","),
        $where: windowWhere(w),
        $limit: String(LIMIT)
      }, { timeoutMs: TIMEOUT_MS });
    } catch (err) {
      // 4xx (other than throttling) is a bad query: retrying won't help.
      const fatal = err instanceof SocrataError && err.status >= 400 && err.status < 500 && err.status !== 429;
      if (fatal || ++streak >= STREAK) throw err;
      const halves = split(w, today);
      const wait = 5000 * Math.min(streak, 6);
      console.warn(`Crash data: ${table} ${windowLabel(w)}: ${err.message}; ` +
        `${halves ? `trying ${windowLabel(halves[0])} and ${windowLabel(halves[1])} apart` : "retrying"} in ${wait / 1000} s`);
      queue.unshift(...(halves ?? [w]));
      await sleep(wait);
      continue;
    }
    streak = 0;
    if (got.length >= LIMIT) {
      const halves = split(w, today);
      if (!halves) throw new Error(`Crash data: ${table} has ${LIMIT.toLocaleString()}+ rows on ${w.from}; raise LIMIT`);
      queue.unshift(...halves);
      continue;
    }
    for (const r of got) rows.set(r[key], r);
  }
  return [...rows.values()];
}

// { crashes, vehicles }: the source rows for the date range. One table
// at a time: Socrata throttles parallel pulls of these into timeouts.
export async function fetchYear(range = dateRange(), { budgetMs = BUDGET_MS, today = nycToday() } = {}) {
  const paging = { deadline: Date.now() + budgetMs, today };
  const out = {};
  for (const table of Object.keys(DATASETS)) {
    const started = Date.now();
    out[table] = await fetchTable(table, range, paging);
    console.log(`Crash data: ${out[table].length.toLocaleString()} ${table} (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  return out;
}

/*
 * Source rows → the facts rows packFacts() takes: one per crash (factsRow()),
 * each with `streets`, the street keys it names. Vehicles whose crash isn't
 * in the range are left out. Pure; exported for tests.
 */
export function factsFromSource({ crashes, vehicles }) {
  const vehiclesOf = byCrash(vehicles.map(vehicleRow));
  return crashes.map((raw) => {
    const crash = crashRow(raw);
    const row = factsRow(crash, vehiclesOf.get(crash.collision_id));
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
  maxAgeHours: REBUILD_HOURS + 2, // as requestMaxAgeHours() for the dataset's rebuildHours
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
