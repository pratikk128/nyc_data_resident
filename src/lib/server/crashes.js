/*
 * NYC Crash Hotspots as an ETL dataset (etl.js): when the crash table changes
 * on NYC Open Data (at least daily, since the window ends today), the data
 * refresh rebuilds the hotspots from a fresh fetch of the year
 * (crash-hotspots.js hotspotsJob) and writes them to KV.
 */
import { dailyValue } from "./cache.js";
import { datasetMetadata } from "./socrata.js";
import { hotspotsJob } from "./crash-hotspots.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { DATASETS } from "../crashes/config.js";

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
  metadataJob,
  jobs: [hotspotsJob]
};

export const getMetadata = () => dailyValue(metadataJob);
