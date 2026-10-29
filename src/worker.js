/*
 * Cloudflare Worker entry (wrangler.jsonc → main). Astro handles every HTTP
 * request; the hourly cron trigger refreshes the aggregates in KV whose
 * source datasets changed (src/lib/server/etl.js).
 */
import { handle } from "@astrojs/cloudflare/handler";
import { runEtl } from "./lib/server/etl.js";

export default {
  fetch: handle,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runEtl(controller.scheduledTime));
  }
};
