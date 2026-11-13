/*
 * Builds NYC Crash Hotspots' static snapshot (src/lib/server/crash-hotspots.js):
 * fetches a year of crashes and vehicles from NYC Open Data and writes the
 * packed facts, the summary and the 24 prebuilt views to
 * public/data/crash-hotspots/, then records the build in
 * src/data/snapshots.json (builtAt, dataThrough, dateFrom, version).
 *
 *   npm run data:hotspots
 *
 * .github/workflows/hotspots.yml runs it on the 1st of each month and
 * commits the result (npm run data:check flags it after 35 days,
 * src/lib/etl/snapshots.js). Run by hand, review the diff, commit, and deploy. It
 * usually takes a few minutes, longer when Socrata is slow.
 * SOCRATA_APP_TOKEN (optional, also read from .dev.vars) raises Socrata's
 * rate limits. Nothing is written if the fetch fails or comes back short.
 */
import "./lib/workers-env.mjs"; // "cloudflare:workers" → process.env, for socrata.js's SOCRATA_APP_TOKEN
import { gzipSync } from "node:zlib";
import { readSnapshotFiles, versionOf, writeSnapshotFiles, OUT_DIR } from "./lib/hotspot-files.mjs";
import { recordSnapshot } from "./lib/snapshot-manifest.mjs";

const { fetchYear, buildHotspots } = await import("../src/lib/server/crash-hotspots.js");
const { dateRange } = await import("../src/lib/crashes/config.js");
const { SUMMARY_FILE } = await import("../src/lib/crashes/hotspot-query.js");

const startedAt = new Date();
const last = await readSnapshotFiles();
const lastCrashes = last[SUMMARY_FILE] ? JSON.parse(last[SUMMARY_FILE]).crashes : 0;

const range = dateRange();
const source = await fetchYear(range);
const { summary, files } = buildHotspots(source, { range, builtAt: startedAt.toISOString(), lastCrashes });
await writeSnapshotFiles(files);
const version = versionOf(files);
await recordSnapshot("crash-hotspots", startedAt, { dataThrough: summary.dataThrough, dateFrom: summary.dateFrom, version });

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
const sizes = Object.entries(files).map(([name, text]) => ({ name, raw: Buffer.byteLength(text), gz: gzipSync(text).length }));
const views = sizes.filter((s) => s.name.startsWith("view-"));
const facts = sizes.find((s) => s.name === "facts.json");
console.log(`Built NYC Crash Hotspots: ${summary.crashes.toLocaleString()} crashes, ${summary.dateFrom} through ${summary.dataThrough}, ` +
  `in ${Math.round((Date.now() - startedAt) / 1000)} s (version ${version})`);
console.log(`  facts.json  ${mb(facts.raw)} (${mb(facts.gz)} gzipped)`);
console.log(`  ${views.length} views   ${mb(views.reduce((a, s) => a + s.raw, 0))} in all (largest ${mb(Math.max(...views.map((s) => s.gz)))} gzipped)`);
console.log(`Wrote ${OUT_DIR}. Review the diff, commit it with src/data/snapshots.json, and deploy.`);
