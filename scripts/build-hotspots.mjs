/*
 * Builds NYC Crash Hotspots into KV now, without waiting for the data
 * refresh (src/lib/server/crash-hotspots.js hotspotsJob): fetches a year of
 * crashes from NYC Open Data and writes the packed facts and views.
 *
 *   npm run data:hotspots -- --remote   production KV
 *   npm run data:hotspots -- --local    the local state `astro dev` reads
 *
 * Needs wrangler to be logged in, like the refresh (scripts/run-etl.mjs).
 * SOCRATA_APP_TOKEN (optional, also read from .dev.vars) raises Socrata's
 * rate limits.
 */
import { connect, flush } from "./lib/workers-env.mjs";

const args = new Set(process.argv.slice(2));
const target = args.has("--remote") ? "--remote" : args.has("--local") ? "--local" : null;
if (!target) {
  console.error("Say where: npm run data:hotspots -- --remote (production) or --local (astro dev)");
  process.exit(2);
}
connect(target);

const { hotspotsJob } = await import("../src/lib/server/crash-hotspots.js");
const { refreshDaily } = await import("../src/lib/server/cache.js");

const started = Date.now();
const built = await refreshDaily(hotspotsJob);
const { keys } = await flush();
console.log(`Built NYC Crash Hotspots: ${built.crashes.toLocaleString()} crashes through ${built.dataThrough}, ` +
  `${(built.factsBytes / 1e6).toFixed(1)} MB of facts and ${built.views} views; wrote ${keys} KV key(s) in ${Math.round((Date.now() - started) / 1000)} s`);
