/*
 * Builds src/data/nyc-outline.json, the city's outline for the site's
 * "is this spot in NYC?" check (src/lib/in-city.js), from
 * "Borough Boundaries (water areas included)" (wh2p-dxnf).
 *
 *   npm run data:nyc-outline
 *
 * The water-included version runs out to the state line in the rivers and
 * the harbor, so a spot on a pier, a ferry or Roosevelt Island counts as in
 * the city while Jersey City, Hoboken and Fort Lee don't. Each ring is
 * simplified (Douglas–Peucker, about 20 m) and rounded to 4 decimals so the
 * file stays small enough to ship to the browser.
 */
import { writeFile } from "node:fs/promises";
import { recordSnapshot } from "./lib/snapshot-manifest.mjs";

const startedAt = new Date();

const DOMAIN = "https://data.cityofnewyork.us";
const DATASET_ID = "wh2p-dxnf";
const OUT_FILE = new URL("../src/data/nyc-outline.json", import.meta.url);
// In degrees; 0.0002° is about 20 m.
const TOLERANCE = 0.0002;

async function fetchOk(url) {
  const headers = process.env.SOCRATA_APP_TOKEN ? { "X-App-Token": process.env.SOCRATA_APP_TOKEN } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res;
}

// Douglas–Peucker on an open line of [lon, lat] points.
function simplifyLine(pts) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const dist = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
    if (dist > max) { max = dist; idx = i; }
  }
  if (max <= TOLERANCE) return [pts[0], pts[pts.length - 1]];
  return [...simplifyLine(pts.slice(0, idx + 1)).slice(0, -1), ...simplifyLine(pts.slice(idx))];
}

// A closed ring is split at the point farthest from its start, so each half is an open line.
function simplifyRing(ring) {
  const open = ring.slice(0, -1);
  let far = 0, farDist = 0;
  open.forEach(([x, y], i) => {
    const d = Math.hypot(x - open[0][0], y - open[0][1]);
    if (d > farDist) { farDist = d; far = i; }
  });
  const a = simplifyLine(open.slice(0, far + 1)), b = simplifyLine([...open.slice(far), open[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)].map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
}

const geojson = await fetchOk(`${DOMAIN}/resource/${DATASET_ID}.geojson`).then((r) => r.json());
if (geojson.features?.length !== 5) throw new Error(`Expected 5 boroughs, got ${geojson.features?.length}`);

const rings = [];
for (const f of geojson.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  // No borough has holes today; the check in in-city.js only reads outer rings.
  if (polys.some((p) => p.length > 1)) throw new Error(`${f.properties.boroname} has holes; in-city.js would need to handle them`);
  for (const [outer] of polys) rings.push(simplifyRing(outer));
}

await writeFile(OUT_FILE, JSON.stringify({
  source: `${DOMAIN}/d/${DATASET_ID}`,
  builtAt: startedAt.toISOString().slice(0, 10),
  // Outer rings of [lon, lat], one or more per borough
  rings
}) + "\n");
await recordSnapshot("nyc-outline", startedAt);

console.log(`Wrote ${rings.length} rings, ${rings.reduce((n, r) => n + r.length, 0)} points to ${OUT_FILE.pathname}`);
