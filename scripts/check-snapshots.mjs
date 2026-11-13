/*
 * Which build-time snapshots (src/lib/etl/snapshots.js) are out of date with
 * NYC Open Data (or too old, for a snapshot with maxAgeDays), and the
 * command that refreshes each. The scheduled refresh runs the same check and
 * reports it at /api/etl/status; this is the local copy.
 *
 *   npm run data:check                 lists stale snapshots; exits 1 if any
 *   npm run data:check -- --refresh    also runs each stale snapshot's script
 *   node scripts/check-snapshots.mjs --warn-only   never fails (used by deploy)
 *
 * After a refresh, review the diff in src/data/ and public/data/, commit it, and deploy.
 */
import { spawnSync } from "node:child_process";
import { SNAPSHOTS, snapshotSourceIds } from "../src/lib/etl/snapshots.js";
import { snapshotChanges, changeText } from "../src/lib/etl/cadence.js";
import { readManifest } from "./lib/snapshot-manifest.mjs";

const DOMAIN = "https://data.cityofnewyork.us";
const args = new Set(process.argv.slice(2));
const refresh = args.has("--refresh");
const warnOnly = args.has("--warn-only");

async function sourceInfo(id) {
  const headers = process.env.SOCRATA_APP_TOKEN ? { "X-App-Token": process.env.SOCRATA_APP_TOKEN } : {};
  const res = await fetch(`${DOMAIN}/api/views/${id}.json`, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${id} metadata returned ${res.status}`);
  const meta = await res.json();
  return {
    rowsUpdatedAt: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString() : null,
    attachments: (meta.metadata?.attachments ?? []).map((a) => ({ name: a.name ?? a.filename, assetId: a.assetId }))
  };
}

const manifest = await readManifest();
const sources = {};
const unreachable = [];
await Promise.all(snapshotSourceIds().map(async (id) => {
  try {
    sources[id] = await sourceInfo(id);
  } catch (err) {
    unreachable.push(`${id}: ${err.message}`);
  }
}));
for (const u of unreachable) console.warn(`Couldn't check ${u}`);

const stale = [];
for (const snap of SNAPSHOTS) {
  const builtAt = manifest[snap.id]?.builtAt;
  const changes = snapshotChanges(snap, builtAt, sources);
  const built = builtAt ? `built ${builtAt.slice(0, 16).replace("T", " ")} UTC` : "never recorded";
  if (!changes.length) {
    console.log(`✓ ${snap.id}: current (${built})`);
    continue;
  }
  stale.push(snap);
  console.log(`✗ ${snap.id}: stale (${built})`);
  for (const c of changes) console.log(`    ${changeText(c)}`);
  console.log(`    refresh: ${snap.command}`);
}

if (refresh) {
  for (const snap of stale) {
    console.log(`\n$ ${snap.command}`);
    const [cmd, ...rest] = snap.command.split(" ");
    const run = spawnSync(cmd, rest, { stdio: "inherit" });
    if (run.status !== 0) {
      console.error(`${snap.id} refresh failed`);
      process.exit(1);
    }
  }
  if (stale.length) console.log("\nReview the changes in src/data/ and public/data/, commit them, then deploy (npm run deploy).");
} else if (stale.length && !warnOnly) {
  process.exit(1);
}
