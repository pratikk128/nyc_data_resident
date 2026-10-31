/*
 * NYC Crash Lookup on the Worker: searches and deep dives read the crash
 * tables in D1 (binding CRASHES_DB, wrangler.jsonc), loaded by
 * scripts/ingest-crashes.mjs and kept current by the daily sync
 * (crashes-sync.js). Requests never reach Socrata.
 *
 * Results are cached at the edge per query, data version and code version;
 * misses are rate limited per client (CRASHES_RATE_LIMITER).
 *
 * The ETL dataset at the bottom runs the daily sync from the hourly cron.
 */
import { env } from "cloudflare:workers";
import { edgeCached, dailyValue } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { datasetMetadata } from "./socrata.js";
import { syncCrashes } from "./crashes-sync.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { nycToday } from "../format.js";
import { searchCrashes, crashRows } from "../crashes/search.js";
import { crashDetail } from "../crashes/detail.js";
import { criteriaKey } from "../crashes/query.js";
import { rowHash } from "../crashes/normalize.js";
import { DATASETS, REBUILD_DUE_DAYS, dateRange } from "../crashes/config.js";

export const SEARCH_TTL = 3600;
export const DETAIL_TTL = 3600;
const STATUS_MS = 5 * 60e3;

export class NoDatabase extends Error {}
export const NOT_LOADED_TEXT = "The crash data isn’t loaded yet. Try again later.";

// D1 as search.js wants it: all(sql, params) → rows.
function db() {
  const d1 = env.CRASHES_DB;
  if (!d1) throw new NoDatabase("No CRASHES_DB binding");
  return { all: async (sql, params = []) => (await d1.prepare(sql).bind(...params).all()).results };
}

const codeVersion = () => env.CF_VERSION_METADATA?.id ?? "dev";

/*
 * The newest crash in the database and the last full build and sync, for
 * the page ("Data through …") and the cache keys. Kept a few minutes per isolate.
 * → { dataThrough, lastFull, lastSync, version } (null fields before the first build)
 */
let status = null;
export async function dataStatus() {
  if (status && Date.now() - status.at < STATUS_MS) return status.value;
  const d = db();
  let value;
  try {
    const [[through], logs] = await Promise.all([
      d.all("SELECT max(crash_date) AS through, count(*) AS crashes FROM crashes"),
      d.all("SELECT kind, max(finished_at) AS at FROM ingest_log WHERE finished_at IS NOT NULL GROUP BY kind")
    ]);
    const at = Object.fromEntries(logs.map((l) => [l.kind, l.at]));
    value = {
      dataThrough: through?.through ?? null,
      crashes: through?.crashes ?? 0,
      dateFrom: dateRange().from,
      lastFull: at.full ?? null,
      lastSync: at.sync ?? null,
      version: `${at.full ?? "-"}|${at.sync ?? "-"}`
    };
  } catch (err) {
    // No tables yet: nothing has been loaded into this database.
    if (/no such table/i.test(err.message)) throw new NoDatabase(err.message);
    throw err;
  }
  status = { at: Date.now(), value };
  return value;
}

// True when the last full rebuild is older than REBUILD_DUE_DAYS (or there's never been one).
export const rebuildDue = (s, now = Date.now()) =>
  !s.lastFull || now - Date.parse(s.lastFull) > REBUILD_DUE_DAYS * 864e5;

export async function loadSearch(criteria, requestUrl, ctx, clientAddress) {
  const s = await dataStatus();
  const key = `crashes/search/${codeVersion()}/${s.version}/${rowHash({ q: criteriaKey(criteria) })}`;
  return edgeCached(requestUrl, key, SEARCH_TTL, async () => {
    await checkRateLimit("CRASHES_RATE_LIMITER", clientAddress);
    return { dataThrough: s.dataThrough, ...(await searchCrashes(db(), criteria)) };
  }, ctx);
}

// → the deep dive, or null when there's no such crash in the database.
export async function loadDetail(collisionId, requestUrl, ctx, clientAddress) {
  const s = await dataStatus();
  const key = `crashes/detail/${codeVersion()}/${s.version}/${collisionId}`;
  return edgeCached(requestUrl, key, DETAIL_TTL, async () => {
    await checkRateLimit("CRASHES_RATE_LIMITER", clientAddress);
    const record = (await crashRows(db(), [collisionId])).get(collisionId);
    return record ? { dataThrough: s.dataThrough, ...crashDetail(record) } : null;
  }, ctx);
}

// ---------- The daily sync, as an ETL dataset (etl.js) ----------

const CADENCE = "daily";

export const metadataJob = {
  key: `crashes:metadata:${DATASETS.crashes.id}`,
  maxAgeHours: requestMaxAgeHours(CADENCE),
  run: () => datasetMetadata(DATASETS.crashes.id)
};

// Its value in KV is the last sync's summary; the rows themselves go to D1.
export const syncJob = {
  key: "crashes:sync:v1",
  maxAgeHours: requestMaxAgeHours(CADENCE, true),
  async run() {
    const summary = await syncCrashes(nycToday());
    status = null;
    return { syncedAt: new Date().toISOString(), ...summary };
  }
};

export const crashesDataset = {
  id: "crashes",
  dashboard: "crash-lookup",
  datasetId: DATASETS.crashes.id,
  cadence: CADENCE,
  rolling: true,
  metadataJob,
  jobs: [syncJob],
  // For /api/etl/status: the monthly full rebuild, which the cron can't do.
  async attention(now = Date.now()) {
    try {
      const s = await dataStatus();
      if (!rebuildDue(s, now)) return [];
      return [`crashes: the last full rebuild was ${s.lastFull ?? "never"}; run npm run data:crashes -- --refetch, then npm run data:crashes:push -- --remote`];
    } catch (err) {
      if (err instanceof NoDatabase) return ["crashes: the crash database is empty; run npm run data:crashes, then npm run data:crashes:push -- --remote"];
      return [`crashes: couldn't read the crash database (${err.message})`];
    }
  }
};

export const getMetadata = () => dailyValue(metadataJob);
