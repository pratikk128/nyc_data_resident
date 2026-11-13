/*
 * src/data/snapshots.json: when each build-time snapshot was last built
 * (src/lib/etl/snapshots.js). The refresh scripts call recordSnapshot() after
 * writing their files; the scheduled refresh and `npm run data:check` compare
 * it with the sources' last update, or with the snapshot's maxAgeDays.
 */
import { readFile, writeFile } from "node:fs/promises";

export const MANIFEST = new URL("../../src/data/snapshots.json", import.meta.url);

export async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

// startedAt: when the script began reading its sources, so an update that
// lands while it runs still counts as newer than the snapshot. extra: more
// fields the site reads at build time (crash-hotspots: dataThrough, dateFrom, version).
export async function recordSnapshot(id, startedAt, extra = {}) {
  const manifest = await readManifest();
  manifest[id] = { builtAt: startedAt.toISOString(), ...extra };
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MANIFEST, JSON.stringify(sorted, null, 2) + "\n");
}
