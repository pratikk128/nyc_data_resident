/*
 * City Payroll Spending (Citywide Payroll Data (Fiscal Year), k397-673e).
 * The queries and checks are in src/lib/payroll/build.js.
 *
 * The source changes about once a year. When it does, the scheduled refresh
 * (etl.js) rebuilds the whole dashboard's data, about 30 seconds of Socrata
 * queries plus NYC-area CPI from BLS, into one KV entry that both pages and /api/payroll/agencies read.
 * Requests never run those queries: until the refresh has built it (local dev,
 * or before the first refresh after a deploy), the pages show the bundled copy in
 * src/data/, refreshed by `npm run data:payroll`.
 */
import { soql, datasetMetadata } from "./socrata.js";
import { storedValue } from "./cache.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { buildPayroll, DATASET_ID } from "../payroll/build.js";
import bundledByYear from "../../data/payroll-by-year.json";
import bundledByAgency from "../../data/payroll-by-agency.json";
import bundledJobs from "../../data/payroll-jobs.json";
import bundledOvertime from "../../data/payroll-overtime.json";

const CADENCE = "yearly";
const MAX_AGE_HOURS = requestMaxAgeHours(CADENCE);
// The job title medians take Socrata a minute or two on a slow day.
const QUERY_TIMEOUT_MS = 5 * 60e3;

export const metadataJob = {
  key: `payroll:metadata:${DATASET_ID}`,
  maxAgeHours: MAX_AGE_HOURS,
  run: () => datasetMetadata(DATASET_ID)
};

// value: { byYear, byAgency, jobs, overtime }, the same shapes as the four
// bundled files. v2 added byYear.cpi and overtime; a v1 copy lacks them.
export const payrollJob = {
  key: "payroll:data:v2",
  maxAgeHours: MAX_AGE_HOURS,
  async run() {
    const meta = await datasetMetadata(DATASET_ID);
    const data = await buildPayroll(
      (params) => soql(DATASET_ID, params, { timeoutMs: QUERY_TIMEOUT_MS }),
      meta,
      new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    );
    for (const w of data.byYear.checks.warnings) console.warn(`Payroll: ${w}`);
    return data;
  }
};

export const payrollDataset = {
  id: "payroll",
  dashboard: "city-payroll",
  datasetId: DATASET_ID,
  cadence: CADENCE,
  metadataJob,
  jobs: [payrollJob]
};

const bundled = { byYear: bundledByYear, byAgency: bundledByAgency, jobs: bundledJobs, overtime: bundledOvertime };

// The refresh's copy, or the bundled one until there is one (or KV can't be read).
export async function getPayroll() {
  try {
    return (await storedValue(payrollJob)) ?? bundled;
  } catch (err) {
    console.error(`Payroll: serving the bundled copy (${err.message})`);
    return bundled;
  }
}
