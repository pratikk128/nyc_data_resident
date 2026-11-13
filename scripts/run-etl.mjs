/*
 * The data refresh, run outside the Worker: checks every dataset on NYC Open
 * Data, rebuilds the summaries that are due (src/lib/server/etl.js decides
 * which), and writes them to KV, plus the crash sync's rows to D1.
 *
 *   npm run etl -- --remote   production KV and D1
 *   npm run etl -- --local    the local state `astro dev` reads
 *
 * Scheduled by .github/workflows/etl.yml. It used to be the Worker's hourly
 * cron, but parsing the larger sources takes seconds of CPU and the metadata
 * checks alone use most of a run's 50 subrequests on the Workers free plan.
 *
 * Needs wrangler to be logged in (`npx wrangler login`), or
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
 * SOCRATA_APP_TOKEN (optional, also read from .dev.vars) raises Socrata's
 * rate limits. KV_NAMESPACE_ID (optional) names the KV namespace when
 * wrangler.jsonc doesn't have its id.
 *
 * Exits 1 if any step failed; what did succeed is still written.
 */
import { connect, flush } from "./lib/workers-env.mjs";

const args = new Set(process.argv.slice(2));
const target = args.has("--remote") ? "--remote" : args.has("--local") ? "--local" : null;
if (!target) {
  console.error("Say where to write: npm run etl -- --remote (production) or --local (astro dev)");
  process.exit(2);
}
connect(target);

// The Workers runtime logs a promise rejection nobody handled; Node would exit.
// The job it came from still fails (or succeeds) on its own.
process.on("unhandledRejection", (err) => console.warn(`Unhandled rejection: ${err?.message ?? err}`));

const { runEtl } = await import("../src/lib/server/etl.js");

const started = Date.now();
let failed = null;
try {
  await runEtl(started);
} catch (err) {
  failed = err;
}
const { statements, keys } = await flush();
console.log(`Wrote ${keys} KV key(s) and ${statements} D1 statement(s) in ${Math.round((Date.now() - started) / 1000)} s`);
if (failed) {
  console.error(failed.message);
  process.exit(1);
}
