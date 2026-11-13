/*
 * NYC Crash Hotspots as an ETL dataset (etl.js): every REBUILD_HOURS the data
 * refresh rebuilds the hotspots from a fresh fetch of the year
 * (crash-hotspots.js hotspotsJob) and writes them to KV.
 *
 * The city updates the crash table daily, but a fetch of the year is the
 * refresh's biggest job by far, and a year's counts barely move in a few
 * days; so the source changing doesn't rebuild it sooner (minGapHours).
 */
import { dailyValue } from "./cache.js";
import { datasetMetadata } from "./socrata.js";
import { hotspotsJob } from "./crash-hotspots.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { DATASETS, REBUILD_HOURS } from "../crashes/config.js";

const CADENCE = "daily";

export const metadataJob = {
  key: `crashes:metadata:${DATASETS.crashes.id}`,
  maxAgeHours: requestMaxAgeHours(CADENCE),
  run: () => datasetMetadata(DATASETS.crashes.id)
};

export const crashesDataset = {
  id: "crashes",
  dashboard: "crash-hotspots",
  datasetId: DATASETS.crashes.id,
  cadence: CADENCE,
  rolling: true,
  rebuildHours: REBUILD_HOURS,
  minGapHours: REBUILD_HOURS,
  metadataJob,
  jobs: [hotspotsJob]
};

export const getMetadata = () => dailyValue(metadataJob);
