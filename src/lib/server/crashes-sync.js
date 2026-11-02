/*
 * The crash lookup's daily sync, run by the hourly ETL (etl.js) when the
 * crash table changes on NYC Open Data.
 *
 * The city republishes every row each day, so ":updated_at" can't say what
 * changed. Instead the sync re-reads the last SYNC_DAYS days of all three
 * tables (new crashes, and the recent ones most often amended), compares
 * each row's hash with the stored one, and writes only rows that are new or
 * changed; rows in the window the city no longer has are deleted. Older
 * amendments wait for the monthly full rebuild (scripts/ingest-crashes.mjs).
 *
 * NYC Crash Hotspots' crash_facts are rebuilt from the same rows: a crash's
 * facts row is rewritten when it, or any of its vehicles or persons, changed.
 *
 * If the source returns far fewer crashes for the window than the database
 * holds, the sync stops without deleting anything: that's an outage or a
 * half-published dataset, not a mass deletion.
 */
import { env } from "cloudflare:workers";
import { soql } from "./socrata.js";
import { DATASETS, SYNC_DAYS, dateRange } from "../crashes/config.js";
import { COLUMNS } from "../crashes/schema.js";
import { crashRow, streetRows, vehicleRow, personRow } from "../crashes/rows.js";
import { factsRow, byCrash } from "../crashes/facts.js";

const PAGE = 10000;
const MAX_ROWS = 300000; // a 45-day window is ~75,000 rows across the three tables
const BATCH = 200;       // statements per D1 batch
const MIN_SHARE = 0.8;   // of the stored crashes the source must still have

const ROW = { crashes: crashRow, vehicles: vehicleRow, persons: personRow };

export function windowStart(today, days = SYNC_DAYS) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  const start = d.toISOString().slice(0, 10);
  const { from } = dateRange(today);
  return start < from ? from : start;
}

async function fetchWindow(table, from, to) {
  const { id, key } = DATASETS[table];
  const where = `crash_date >= '${from}T00:00:00'${to ? ` AND crash_date <= '${to}T23:59:59'` : ""}`;
  const rows = [];
  let last = null;
  while (rows.length < MAX_ROWS) {
    const page = await soql(id, {
      $where: last ? `(${where}) AND ${key} > '${last}'` : where,
      $order: key,
      $limit: String(PAGE)
    }, { timeoutMs: 120000 });
    rows.push(...page);
    if (page.length < PAGE) return rows;
    last = page.at(-1)[key];
  }
  throw new Error(`${table}: more than ${MAX_ROWS} rows since ${from}; run a full rebuild instead`);
}

const insert = (table) =>
  `INSERT OR REPLACE INTO ${table} (${COLUMNS[table].join(", ")}) VALUES (${COLUMNS[table].map(() => "?").join(", ")})`;

/*
 * What to write and delete for one table, from the source rows and the
 * stored { id, h } in the window. Pure; exported for tests.
 * → { upserts: [row], deletes: [id] }
 */
export function diffTable(table, sourceRows, stored) {
  const key = DATASETS[table].key;
  const have = new Map(stored.map((r) => [r.id, r.h]));
  const upserts = [];
  const seen = new Set();
  for (const raw of sourceRows) {
    const row = ROW[table](raw);
    seen.add(row[key]);
    if (have.get(row[key]) !== row.h) upserts.push(row);
  }
  const deletes = stored.filter((r) => !seen.has(r.id)).map((r) => r.id);
  return { upserts, deletes };
}

/*
 * The crash_facts rows to write and delete, from the window's source rows
 * (all three tables) and the stored { id, h }. Pure; exported for tests.
 * → { upserts: [row], deletes: [id] }
 */
export function diffFacts(source, stored) {
  const vehicles = byCrash(source.vehicles.map(vehicleRow));
  const persons = byCrash(source.persons.map(personRow));
  const have = new Map(stored.map((r) => [r.id, r.h]));
  const upserts = [];
  const seen = new Set();
  for (const raw of source.crashes) {
    const crash = crashRow(raw);
    const row = factsRow(crash, vehicles.get(crash.collision_id), persons.get(crash.collision_id));
    seen.add(row.collision_id);
    if (have.get(row.collision_id) !== row.h) upserts.push(row);
  }
  return { upserts, deletes: stored.filter((r) => !seen.has(r.id)).map((r) => r.id) };
}

async function runBatches(d1, statements) {
  for (let i = 0; i < statements.length; i += BATCH) await d1.batch(statements.slice(i, i + BATCH));
}

export async function syncCrashes(today, d1 = env.CRASHES_DB) {
  if (!d1) throw new Error("No CRASHES_DB binding");
  const startedAt = new Date().toISOString();
  const range = dateRange(today);
  const from = windowStart(today);
  // Nothing to keep current until the first full build is pushed (the status page says so).
  const built = new Set((await d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('ingest_log', 'crash_facts')").all()).results.map((r) => r.name));
  if (!built.has("ingest_log")) return { from, skipped: "no full build loaded yet" };
  // A database built before NYC Crash Hotspots has no facts table until its next full build.
  const hasFacts = built.has("crash_facts");

  const source = {};
  for (const table of Object.keys(DATASETS)) source[table] = await fetchWindow(table, from, range.to);

  const plan = {};
  for (const table of Object.keys(DATASETS)) {
    const key = DATASETS[table].key;
    const { results } = await d1.prepare(`SELECT ${key} AS id, h FROM ${table} WHERE crash_date >= ?`).bind(from).all();
    if (table === "crashes" && results.length && source.crashes.length < results.length * MIN_SHARE) {
      throw new Error(`Source has ${source.crashes.length} crashes since ${from}, the database ${results.length}; not syncing`);
    }
    plan[table] = diffTable(table, source[table], results);
  }
  if (hasFacts) {
    const { results } = await d1.prepare("SELECT collision_id AS id, h FROM crash_facts WHERE crash_date >= ?").bind(from).all();
    plan.crash_facts = diffFacts(source, results);
  }

  const statements = [];
  const del = (table, col, ids) => {
    for (let i = 0; i < ids.length; i += 500) {
      statements.push(d1.prepare(`DELETE FROM ${table} WHERE ${col} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids.slice(i, i + 500))));
    }
  };
  // Crashes: a changed crash gets its street rows rebuilt; a deleted one loses them.
  const changedCrashes = plan.crashes.upserts.map((r) => r.collision_id);
  del("crash_streets", "collision_id", [...changedCrashes, ...plan.crashes.deletes]);
  for (const table of Object.keys(DATASETS)) {
    del(table, DATASETS[table].key, plan[table].deletes);
    const sql = insert(table);
    for (const row of plan[table].upserts) statements.push(d1.prepare(sql).bind(...COLUMNS[table].map((c) => row[c] ?? null)));
  }
  const streetSql = insert("crash_streets");
  for (const crash of plan.crashes.upserts) {
    for (const s of streetRows(crash)) statements.push(d1.prepare(streetSql).bind(...COLUMNS.crash_streets.map((c) => s[c])));
  }
  if (hasFacts) {
    del("crash_facts", "collision_id", plan.crash_facts.deletes);
    const factsSql = insert("crash_facts");
    for (const row of plan.crash_facts.upserts) statements.push(d1.prepare(factsSql).bind(...COLUMNS.crash_facts.map((c) => row[c] ?? null)));
  }
  // The range rolls forward a day at a time: drop crashes that aged out of it,
  // street rows first (found through the crash date index), then the rest.
  const before = range.from;
  statements.push(d1.prepare("DELETE FROM crash_streets WHERE collision_id IN (SELECT collision_id FROM crashes WHERE crash_date < ?)").bind(before));
  for (const table of [...Object.keys(DATASETS), ...(hasFacts ? ["crash_facts"] : [])]) {
    statements.push(d1.prepare(`DELETE FROM ${table} WHERE crash_date < ?`).bind(before));
  }
  await runBatches(d1, statements);

  const counts = Object.fromEntries(Object.keys(DATASETS).map((t) => [t, {
    fetched: source[t].length, written: plan[t].upserts.length, deleted: plan[t].deletes.length
  }]));
  if (hasFacts) counts.crash_facts = { written: plan.crash_facts.upserts.length, deleted: plan.crash_facts.deletes.length };
  await d1.prepare(`INSERT INTO ingest_log (kind, started_at, finished_at, date_from, date_to, counts)
    VALUES ('sync', ?, ?, ?, ?, ?)`).bind(startedAt, new Date().toISOString(), from, range.to, JSON.stringify(counts)).run();
  return { from, agedOutBefore: before, counts };
}
