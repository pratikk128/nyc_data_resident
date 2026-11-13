/*
 * The crash database (NYC Crash Hotspots): the full build, and the push to D1.
 *
 *   npm run data:crashes                 build .data/crashes/crashes.sqlite (fetches first if there's no copy)
 *   npm run data:crashes -- --refetch    fetch every row in the date range again, then build
 *   npm run data:crashes:push -- --local   load the build into the local D1 (what `astro dev` reads)
 *   npm run data:crashes:push -- --remote  load it into production D1
 *   (a push then rebuilds NYC Crash Hotspots' KV values: scripts/build-hotspots.mjs)
 *
 * The date range is dateRange() in src/lib/crashes/config.js (the last
 * RANGE_YEARS years); the build drops rows older than it on the day it runs,
 * so a kept fetch can be rebuilt later. The site's
 * data refresh keeps recent weeks current (src/lib/server/crashes-sync.js);
 * run a full rebuild about monthly to pick up older amendments and rows the
 * city deleted (the ETL status page says when one is due).
 *
 * Re-runnable: each build starts from an empty file, and a push replaces the
 * tables in D1 in one go (built as *_next, then swapped in), keeping only
 * ingest_log's history.
 *
 * Prints rows per table, checks that every vehicle and person belongs to a
 * crash in the range and every person's vehicle exists (orphans are kept and
 * reported, not dropped), and lists the most common makes and vehicle types
 * the maps don't know yet (src/lib/crashes/makes.js, vehicle-types.js).
 *
 * SOCRATA_APP_TOKEN (optional) raises Socrata's rate limits for the fetch.
 */
import { createReadStream, existsSync, createWriteStream } from "node:fs";
import { rm, rename, stat, readFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fetchAll, rawFile } from "./lib/crash-fetch.mjs";
import { dateRange } from "../src/lib/crashes/config.js";
import { TABLES, INDEXES, COLUMNS } from "../src/lib/crashes/schema.js";
import { crashRow, streetRows, vehicleRow, personRow } from "../src/lib/crashes/rows.js";
import { factsRow, byCrash, causeKey, maneuverKey, UNGROUPED_CAUSES, UNGROUPED_MANEUVERS } from "../src/lib/crashes/facts.js";

const DIR = new URL("../.data/crashes/", import.meta.url);
const DB_FILE = new URL("crashes.sqlite", DIR);
const SQL_FILE = new URL("d1-import.sql", DIR);
const D1_NAME = "asknycdata-crashes"; // wrangler.jsonc → d1_databases
const DATA_TABLES = ["crashes", "crash_streets", "vehicles", "persons", "crash_facts"];

const args = new Set(process.argv.slice(2));

async function* lines(file) {
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield JSON.parse(line);
}

const insertSql = (table) =>
  `INSERT OR REPLACE INTO ${table} (${COLUMNS[table].join(", ")}) VALUES (${COLUMNS[table].map(() => "?").join(", ")})`;

async function build() {
  const startedAt = new Date().toISOString();
  const range = dateRange();
  const fetchInfo = JSON.parse(await readFile(new URL("raw/fetch.json", DIR), "utf8"));
  const tmp = new URL("crashes.sqlite.part", DIR);
  await rm(tmp, { force: true });
  const db = new DatabaseSync(tmp.pathname);
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
  for (const sql of Object.values(TABLES)) db.exec(sql);

  const counts = {};
  const duplicates = {};
  const load = async (table, map, extra) => {
    const insert = db.prepare(insertSql(table));
    const insertStreet = extra && db.prepare(insertSql("crash_streets"));
    let n = 0, streets = 0;
    db.exec("BEGIN");
    for await (const raw of lines(rawFile(DIR, table))) {
      const row = map(raw);
      if (row.crash_date < range.from || (range.to && row.crash_date > range.to)) continue;
      insert.run(...COLUMNS[table].map((c) => row[c] ?? null));
      n++;
      if (insertStreet) for (const s of extra(row)) { insertStreet.run(...COLUMNS.crash_streets.map((c) => s[c])); streets++; }
    }
    db.exec("COMMIT");
    const stored = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    counts[table] = stored;
    if (stored !== n) duplicates[table] = n - stored;
    if (insertStreet) counts.crash_streets = db.prepare("SELECT count(*) AS n FROM crash_streets").get().n;
    console.log(`  ${table}: ${stored.toLocaleString()} rows${stored !== n ? ` (${n - stored} duplicate keys in the source, last one kept)` : ""}`);
  };

  console.log("Loading");
  await load("crashes", crashRow, streetRows);
  await load("vehicles", vehicleRow);
  await load("persons", personRow);
  counts.crash_facts = buildFacts(db);

  console.log("Indexing");
  for (const sql of INDEXES) db.exec(sql);

  const orphans = checkOrphans(db);
  reportUnmapped(db);

  const fileStats = await stat(tmp);
  db.prepare(`INSERT INTO ingest_log (kind, started_at, finished_at, date_from, date_to, counts, orphans, note)
    VALUES ('full', ?, ?, ?, ?, ?, ?, ?)`).run(
    startedAt, new Date().toISOString(), range.from, range.to,
    JSON.stringify(counts), JSON.stringify(orphans),
    `fetched ${fetchInfo.fetchedAt}${Object.keys(duplicates).length ? `; duplicate keys: ${JSON.stringify(duplicates)}` : ""}`
  );
  db.exec("VACUUM");
  db.close();
  await rename(tmp, DB_FILE);
  console.log(`Built ${DB_FILE.pathname} (${(fileStats.size / 1e6).toFixed(0)} MB before vacuum, ${((await stat(DB_FILE)).size / 1e6).toFixed(0)} MB after)`);
}

// NYC Crash Hotspots' table: one row per crash from it and its vehicles and persons (facts.js).
function buildFacts(db) {
  const vehicles = byCrash(db.prepare("SELECT * FROM vehicles").all());
  const persons = byCrash(db.prepare("SELECT * FROM persons").all());
  const insert = db.prepare(insertSql("crash_facts"));
  let n = 0;
  db.exec("BEGIN");
  for (const crash of db.prepare("SELECT * FROM crashes").iterate()) {
    const row = factsRow(crash, vehicles.get(crash.collision_id), persons.get(crash.collision_id));
    insert.run(...COLUMNS.crash_facts.map((c) => row[c] ?? null));
    n++;
  }
  db.exec("COMMIT");
  console.log(`  crash_facts: ${n.toLocaleString()} rows`);
  return n;
}

function checkOrphans(db) {
  const q = (sql) => db.prepare(sql).get().n;
  const sample = (sql) => db.prepare(`${sql} LIMIT 5`).all().map((r) => r.id);
  const vehiclesSql = "FROM vehicles v WHERE NOT EXISTS (SELECT 1 FROM crashes c WHERE c.collision_id = v.collision_id)";
  const personsSql = "FROM persons p WHERE NOT EXISTS (SELECT 1 FROM crashes c WHERE c.collision_id = p.collision_id)";
  const personVehiclesSql = "FROM persons p WHERE p.vehicle_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.unique_id = p.vehicle_ref)";
  const orphans = {
    vehicles: q(`SELECT count(*) AS n ${vehiclesSql}`),
    persons: q(`SELECT count(*) AS n ${personsSql}`),
    personVehicles: q(`SELECT count(*) AS n ${personVehiclesSql}`),
    samples: {
      vehicles: sample(`SELECT v.unique_id AS id ${vehiclesSql}`),
      persons: sample(`SELECT p.unique_id AS id ${personsSql}`),
      personVehicles: sample(`SELECT p.unique_id AS id ${personVehiclesSql}`)
    }
  };
  console.log("Orphans (kept, not dropped)");
  console.log(`  vehicles whose crash isn't in the crash table: ${orphans.vehicles.toLocaleString()}`);
  console.log(`  persons whose crash isn't in the crash table: ${orphans.persons.toLocaleString()}`);
  console.log(`  persons whose vehicle isn't in the vehicle table: ${orphans.personVehicles.toLocaleString()}`);
  for (const [k, ids] of Object.entries(orphans.samples)) if (ids.length) console.log(`    e.g. ${k}: ${ids.join(", ")}`);
  return orphans;
}

function reportUnmapped(db) {
  const top = (sql) => db.prepare(sql).all();
  const makes = top("SELECT make_raw AS v, count(*) AS n FROM vehicles WHERE make_raw IS NOT NULL AND make_key IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25");
  const types = top("SELECT type_raw AS v, count(*) AS n FROM vehicles WHERE type_raw IS NOT NULL AND type_key IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25");
  const share = (table, col) => db.prepare(`SELECT round(100.0 * sum(${col} IS NULL) / count(*), 1) AS p FROM vehicles WHERE ${table} IS NOT NULL`).get().p;
  console.log(`Makes not in makes.js: ${share("make_raw", "make_key")}% of vehicles with a make`);
  if (makes.length) console.log(`  ${makes.map((m) => `${m.v} (${m.n})`).join(", ")}`);
  console.log(`Vehicle types not in vehicle-types.js: ${share("type_raw", "type_key")}% of vehicles with a type`);
  if (types.length) console.log(`  ${types.map((m) => `${m.v} (${m.n})`).join(", ")}`);

  // Contributing factors and pre-crash actions no group in facts.js takes (and none left out on purpose).
  const unmapped = (values, keyOf, ungrouped) => [...values]
    .filter((r) => !keyOf(r.v) && !ungrouped.test(r.v.toUpperCase()))
    .sort((a, b) => b.n - a.n).slice(0, 25);
  const factorCounts = new Map();
  for (const t of ["crashes", "vehicles", "persons"]) {
    for (const { f } of db.prepare(`SELECT factors AS f FROM ${t} WHERE factors IS NOT NULL`).iterate()) {
      for (const v of JSON.parse(f)) if (v) factorCounts.set(v, (factorCounts.get(v) ?? 0) + 1);
    }
  }
  const factors = unmapped([...factorCounts].map(([v, n]) => ({ v, n })), causeKey, UNGROUPED_CAUSES);
  console.log(`Contributing factors not in facts.js CAUSES: ${factors.length ? factors.map((m) => `${m.v} (${m.n})`).join(", ") : "none"}`);
  const actions = unmapped(top("SELECT pre_crash AS v, count(*) AS n FROM vehicles WHERE pre_crash IS NOT NULL GROUP BY 1"), maneuverKey, UNGROUPED_MANEUVERS);
  console.log(`Pre-crash actions not in facts.js MANEUVERS: ${actions.length ? actions.map((m) => `${m.v} (${m.n})`).join(", ") : "none"}`);
}

// ---------- Push to D1 ----------

const sqlValue = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const ROWS_PER_INSERT = 100; // D1 caps a statement at 100 KB

async function writeImportSql() {
  const db = new DatabaseSync(DB_FILE.pathname, { readOnly: true });
  const out = createWriteStream(SQL_FILE);
  const write = async (s) => { if (!out.write(s)) await once(out, "drain"); };

  for (const t of DATA_TABLES) {
    await write(`DROP TABLE IF EXISTS ${t}_next;\n${TABLES[t].replace(`CREATE TABLE ${t} `, `CREATE TABLE ${t}_next `)};\n`);
    const cols = COLUMNS[t];
    let batch = [];
    const flush = async () => {
      if (batch.length) await write(`INSERT INTO ${t}_next (${cols.join(",")}) VALUES\n${batch.join(",\n")};\n`);
      batch = [];
    };
    for (const row of db.prepare(`SELECT ${cols.join(",")} FROM ${t}`).iterate()) {
      batch.push(`(${cols.map((c) => sqlValue(row[c])).join(",")})`);
      if (batch.length >= ROWS_PER_INSERT) await flush();
    }
    await flush();
  }
  // The swap: old tables (and their indexes) go, the new ones take their names.
  for (const t of DATA_TABLES) await write(`DROP TABLE IF EXISTS ${t};\nALTER TABLE ${t}_next RENAME TO ${t};\n`);
  for (const sql of INDEXES) await write(`${sql};\n`);
  await write(`${TABLES.ingest_log.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")};\n`);
  for (const r of db.prepare("SELECT * FROM ingest_log").all()) {
    const cols = Object.keys(r).filter((c) => c !== "id");
    await write(`INSERT INTO ingest_log (${cols.join(",")}) VALUES (${cols.map((c) => sqlValue(r[c])).join(",")});\n`);
  }
  out.end();
  await once(out, "finish");
  db.close();
  console.log(`Wrote ${SQL_FILE.pathname} (${((await stat(SQL_FILE)).size / 1e6).toFixed(0)} MB)`);
}

async function push() {
  const where = args.has("--remote") ? "--remote" : args.has("--local") ? "--local" : null;
  if (!where) throw new Error("Say where to push: --local or --remote");
  if (!existsSync(DB_FILE)) throw new Error("No build yet: run npm run data:crashes first");
  await writeImportSql();
  console.log(`Loading into D1 (${where.slice(2)})…`);
  execFileSync("npx", ["wrangler", "d1", "execute", D1_NAME, where, "--yes", `--file=${SQL_FILE.pathname}`], { stdio: "inherit" });
  // NYC Crash Hotspots serves what was built from D1 into KV, so build it again now.
  console.log("Building NYC Crash Hotspots from it…");
  execFileSync(process.execPath, [new URL("build-hotspots.mjs", import.meta.url).pathname, where], { stdio: "inherit" });
}

if (args.has("--push")) {
  await push();
} else {
  if (args.has("--refetch") || !existsSync(new URL("raw/fetch.json", DIR))) {
    const range = dateRange();
    console.log(`Fetching crashes from ${range.from} to ${range.to ?? "the latest"}`);
    // Without --refetch, a stopped fetch picks up after the tables it finished.
    const info = await fetchAll(DIR, { resume: !args.has("--refetch") });
    console.log(`Fetched ${Object.entries(info.counts).map(([t, n]) => `${n.toLocaleString()} ${t}`).join(", ")}`);
  }
  await build();
}
