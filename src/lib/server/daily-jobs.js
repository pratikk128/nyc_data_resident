/*
 * Every aggregate refreshed once a day by the Worker's cron trigger
 * (wrangler.jsonc → triggers.crons; handler in src/worker.js). To add a
 * dataset, export its jobs ({ key, maxAgeHours, run }) from its server module
 * and spread them in here. Jobs run in parallel; one failing doesn't stop the
 * others, and the last good value stays in KV.
 */
import { refreshDaily } from "./cache.js";
import { restaurantDailyJobs } from "./restaurants.js";
import { complaints311DailyJobs } from "./complaints311.js";
import { waterDailyJobs } from "./water.js";

export const DAILY_JOBS = [...restaurantDailyJobs, ...complaints311DailyJobs, ...waterDailyJobs];

export async function runDailyJobs() {
  const results = await Promise.allSettled(DAILY_JOBS.map(async (job) => {
    const started = Date.now();
    await refreshDaily(job);
    return `${job.key} (${Date.now() - started} ms)`;
  }));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") console.log(`Refreshed ${r.value}`);
    else console.error(`Daily job ${DAILY_JOBS[i].key} failed: ${r.reason?.message ?? r.reason}`);
  });
  if (results.some((r) => r.status === "rejected")) throw new Error("One or more daily jobs failed");
}
