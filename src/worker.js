/*
 * Cloudflare Worker entry (wrangler.jsonc → main). Astro handles every HTTP
 * request; the cron trigger refreshes the daily aggregates in KV.
 */
import { handle } from "@astrojs/cloudflare/handler";
import { runDailyJobs } from "./lib/server/daily-jobs.js";

export default {
  fetch: handle,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runDailyJobs());
  }
};
