/*
 * Pulls the NYPD crash tables for the site's date range from NYC Open Data
 * into gzipped NDJSON files (.data/crashes/raw/<table>.ndjson.gz), so a
 * rebuild of the database (new normalization, a fixed bug) doesn't have to
 * fetch 1.6 million rows again. Used by scripts/ingest-crashes.mjs.
 *
 * Pages by key ("unique_id > last one seen", ordered by it) rather than by
 * $offset: deep offsets get slow on Socrata, and a key cursor can't skip or
 * repeat rows when the city republishes mid-pull.
 */
import { createWriteStream, createReadStream, existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createGzip, createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { DATASETS, dateWhere } from "../../src/lib/crashes/config.js";

const DOMAIN = "https://data.cityofnewyork.us";
// Socrata can take 10 s for 1,000 of these rows when it's busy; smaller
// pages keep each request well inside the timeout.
const PAGE = 10000;
const RETRIES = 6;

// The crash table's `location` repeats latitude/longitude; everything else is kept.
const CRASH_COLUMNS = [
  "collision_id", "crash_date", "crash_time", "borough", "zip_code", "latitude", "longitude",
  "on_street_name", "cross_street_name", "off_street_name",
  "number_of_persons_injured", "number_of_persons_killed", "number_of_pedestrians_injured", "number_of_pedestrians_killed",
  "number_of_cyclist_injured", "number_of_cyclist_killed", "number_of_motorist_injured", "number_of_motorist_killed",
  "contributing_factor_vehicle_1", "contributing_factor_vehicle_2", "contributing_factor_vehicle_3",
  "contributing_factor_vehicle_4", "contributing_factor_vehicle_5",
  "vehicle_type_code1", "vehicle_type_code2", "vehicle_type_code_3", "vehicle_type_code_4", "vehicle_type_code_5"
].join(",");

export const rawFile = (dir, table) => new URL(`raw/${table}.ndjson.gz`, dir);

async function countLines(file) {
  let n = 0;
  for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) if (line) n++;
  return n;
}

async function getJson(url) {
  const headers = { Accept: "application/json" };
  if (process.env.SOCRATA_APP_TOKEN) headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(300e3) });
      if (res.ok) return await res.json();
      const body = (await res.text()).slice(0, 200);
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`${res.status}: ${body}`), { fatal: true });
      throw new Error(`${res.status}: ${body}`);
    } catch (err) {
      if (err.fatal || attempt >= RETRIES) throw err;
      const wait = 5000 * attempt;
      console.warn(`  retrying in ${wait / 1000}s (${err.message})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// One table, every row in the date range, to <dir>/raw/<table>.ndjson.gz. → row count
export async function fetchTable(dir, table, { where = dateWhere(), log = console.log } = {}) {
  const { id, key } = DATASETS[table];
  const out = rawFile(dir, table);
  const tmp = new URL(`${out.href}.part`);
  await mkdir(new URL("raw/", dir), { recursive: true });
  const gzip = createGzip();
  const file = gzip.pipe(createWriteStream(tmp));

  let last = null;
  let count = 0;
  const started = Date.now();
  for (;;) {
    const url = new URL(`/resource/${id}.json`, DOMAIN);
    if (table === "crashes") url.searchParams.set("$select", CRASH_COLUMNS);
    url.searchParams.set("$where", last ? `(${where}) AND ${key} > '${last}'` : where);
    url.searchParams.set("$order", key);
    url.searchParams.set("$limit", String(PAGE));
    const rows = await getJson(url);
    for (const row of rows) {
      if (!gzip.write(`${JSON.stringify(row)}\n`)) await once(gzip, "drain");
    }
    count += rows.length;
    log(`  ${table}: ${count.toLocaleString()} rows (${Math.round((Date.now() - started) / 1000)}s)`);
    if (rows.length < PAGE) break;
    last = rows.at(-1)[key];
  }
  gzip.end();
  await once(file, "finish");
  await rename(tmp, out);
  return count;
}

/*
 * All three tables, one after another (in parallel, Socrata throttles them
 * into timeouts), plus fetch.json (when, which range, how many).
 *   resume  keep a table whose file a stopped run already finished
 */
export async function fetchAll(dir, opts = {}) {
  const fetchedAt = new Date().toISOString();
  const counts = {};
  for (const t of Object.keys(DATASETS)) {
    if (opts.resume && existsSync(rawFile(dir, t))) {
      counts[t] = await countLines(rawFile(dir, t));
      console.log(`  ${t}: kept the ${counts[t].toLocaleString()} rows already fetched`);
      continue;
    }
    counts[t] = await fetchTable(dir, t, opts);
  }
  const info = { fetchedAt, where: opts.where ?? dateWhere(), counts };
  await writeFile(new URL("raw/fetch.json", dir), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}
