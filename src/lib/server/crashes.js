/*
 * The crash tables in D1 (binding CRASHES_DB, wrangler.jsonc), loaded by
 * scripts/ingest-crashes.mjs and kept current by the daily sync
 * (crashes-sync.js). Only the data refresh reads them: NYC Crash Hotspots
 * serves what the refresh built from them into KV (crash-hotspots.js).
 *
 * The ETL dataset at the bottom runs the daily sync, then the hotspots build.
 */
import { dailyValue, storedValue } from "./cache.js";
import { datasetMetadata } from "./socrata.js";
import { syncCrashes } from "./crashes-sync.js";
import { hotspotsJob } from "./crash-hotspots.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { nycToday } from "../format.js";
import { DATASETS, REBUILD_DUE_DAYS } from "../crashes/config.js";

// True when the last full rebuild is older than REBUILD_DUE_DAYS (or there's never been one).
export const rebuildDue = (s, now = Date.now()) =>
  !s.lastFull || now - Date.parse(s.lastFull) > REBUILD_DUE_DAYS * 864e5;

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
    return { syncedAt: new Date().toISOString(), ...summary };
  }
};

export const crashesDataset = {
  id: "crashes",
  dashboard: "crash-hotspots",
  datasetId: DATASETS.crashes.id,
  cadence: CADENCE,
  rolling: true,
  metadataJob,
  // The hotspots build reads what the sync wrote, so it waits for it.
  jobs: [syncJob, { ...hotspotsJob, after: syncJob }],
  // For /api/etl/status: the monthly full rebuild, which the refresh doesn't do.
  // Read from the last hotspots build, so the public status page never reads D1.
  async attention(now = Date.now()) {
    const s = await storedValue(hotspotsJob).catch(() => null);
    if (!s) return ["crashes: NYC Crash Hotspots hasn't been built; load the crash database (npm run data:crashes, then npm run data:crashes:push -- --remote), which builds it"];
    if (!rebuildDue(s, now)) return [];
    return [`crashes: the last full rebuild was ${s.lastFull ?? "never"}; run npm run data:crashes -- --refetch, then npm run data:crashes:push -- --remote`];
  }
};

export const getMetadata = () => dailyValue(metadataJob);
