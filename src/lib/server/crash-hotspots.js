/*
 * NYC Crash Hotspots: the build, run by hand on a developer's machine about
 * once a month (npm run data:hotspots, scripts/build-hotspots.mjs). Nothing
 * here runs in the Worker.
 *
 * It fetches a year of the NYPD crashes and vehicles tables on NYC Open
 * Data, a month at a time (fetchYear()), boils each crash down to one facts
 * row (factsFromSource(), facts.js), and buildHotspots() turns those into the
 * static files the page downloads (names in hotspot-query.js):
 *   - facts.json, the whole year packed small (hotspot-compute.js
 *     packFacts(), about 1 MB compressed), which the page downloads for a
 *     ZIP, street, intersection or spot and counts itself;
 *   - a view file per view it can work out ahead: all of NYC and each
 *     borough, with no mode and with each, 24 in all;
 *   - summary.json, what was built and the data's dates.
 * They ship in ./dist as static assets, so requests never reach the Worker
 * or KV. Each build starts from the source, so amendments and rows the city
 * deleted are picked up at the next build. The date range is anchored to
 * the latest crash in the data (config.js dateRange()), so a month-old
 * snapshot is still a consistent year.
 */
import { soql, SocrataError } from "./socrata.js";
import { DATASETS, SOURCE_COLUMNS, dateRange } from "../crashes/config.js";
import { nycToday } from "../format.js";
import { crashRow, streetRows, vehicleRow } from "../crashes/rows.js";
import { factsRow, byCrash } from "../crashes/facts.js";
import { MODES, readQuery, viewFile, FACTS_FILE, SUMMARY_FILE } from "../crashes/hotspot-query.js";
import { packFacts, unpackFacts, summarize, mapOf, FACTS_FORMAT } from "../crashes/hotspot-compute.js";
import { BOROUGHS } from "../complaints311/config.js";

// The views built ahead (hotspot-query.js isPrebuilt()): all of NYC or a borough, with no mode or one.
export const PREBUILT = [null, ...BOROUGHS.map((b) => b.value)].flatMap((boro) =>
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
 * The whole fetch has a budget, generous now that it runs on a developer's
 * machine rather than in CI: it's there so a Socrata that has stopped
 * answering ends the run with a message instead of hanging. Running out
 * fails the build and leaves the last snapshot's files as they were.
 */
const LIMIT = 50000;           // rows per request; a month is about 7,000 crashes and 15,000 vehicles
const TIMEOUT_MS = 120e3;      // per request
const STREAK = 10;             // failures in a row before giving up
const BUDGET_MS = 60 * 60e3;   // the whole fetch
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
    if (Date.now() > deadline) throw new Error(`Crash data: out of time fetching ${table} (at ${windowLabel(w)}); keeping the last snapshot`);
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
 * Source rows ({ crashes, vehicles }, as fetchYear() returns them) → the
 * snapshot: { summary, files }, files being { [file name]: JSON text } for
 * every file under public/data/crash-hotspots/. Pure (no I/O); the script
 * writes the files.
 *   summary: { format, builtAt, dataThrough, dateFrom, crashes, factsBytes, views }
 *     builtAt is when the build started; dataThrough the newest crash.
 *   lastCrashes: the last snapshot's crash count. Far fewer now is an outage
 *     or a half-published dataset, not a quiet year, so it throws and the
 *     script keeps the last snapshot.
 */
export function buildHotspots(source, { range = dateRange(), builtAt = new Date().toISOString(), lastCrashes = 0 } = {}) {
  const rows = factsFromSource(source);
  if (!rows.length || (lastCrashes && rows.length < lastCrashes * MIN_SHARE)) {
    throw new Error(`NYC Open Data returned ${rows.length} crashes since ${range.from} (the last build had ${lastCrashes}); keeping the last snapshot`);
  }

  let dataThrough = null;
  for (const r of rows) if (!dataThrough || r.crash_date > dataThrough) dataThrough = r.crash_date;
  const meta = { version: builtAt, dataThrough, dateFrom: range.from, crashes: rows.length };
  const packed = packFacts(rows, meta);
  const facts = JSON.stringify(packed);
  const t = unpackFacts(packed);
  const dates = { dataThrough, dateFrom: range.from };
  const files = { [FACTS_FILE]: facts };
  for (const query of PREBUILT) {
    files[viewFile(query)] = JSON.stringify({ summary: { ...dates, ...summarize(t, query) }, map: { ...dates, ...mapOf(t, query) } });
  }
  const summary = { format: FACTS_FORMAT, builtAt, dataThrough, dateFrom: range.from, crashes: rows.length, factsBytes: facts.length, views: PREBUILT.length };
  files[SUMMARY_FILE] = JSON.stringify(summary, null, 2) + "\n";
  return { summary, files };
}
