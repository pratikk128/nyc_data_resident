/*
 * NYC Crash Hotspots' static snapshot on disk: public/data/crash-hotspots/,
 * written by scripts/build-hotspots.mjs and served from ./dist as static
 * assets. Shared with tests/crash-hotspots.test.js, which checks that the
 * committed files match src/data/snapshots.json.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HOTSPOTS_PATH } from "../../src/lib/crashes/hotspot-query.js";

export const OUT_DIR = fileURLToPath(new URL(`../../public${HOTSPOTS_PATH}/`, import.meta.url));

// { [file name]: text } of every file there now; {} when there's no snapshot yet.
export async function readSnapshotFiles() {
  let names;
  try {
    names = (await readdir(OUT_DIR)).filter((n) => n.endsWith(".json"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(OUT_DIR + n, "utf8")])));
}

/*
 * A short hash of every file's name and contents. The page puts it in each
 * URL it fetches (hotspot-client.js), and the files are served with a
 * year-long immutable Cache-Control (public/_headers), so a deploy with new
 * files is a new URL and browsers never keep an old snapshot.
 */
export function versionOf(files) {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) hash.update(`${name}\0${files[name]}\0`);
  return hash.digest("hex").slice(0, 12);
}

// Replaces the snapshot: writes every file and deletes any left over from an older build.
export async function writeSnapshotFiles(files) {
  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(OUT_DIR + name, text);
  for (const name of await readdir(OUT_DIR)) {
    if (!(name in files)) await rm(OUT_DIR + name, { recursive: true, force: true });
  }
}
