/*
 * Builds src/data/water-sites.json, the map of drinking water sampling
 * stations, from the spreadsheet DEP attaches to the "Drinking Water Quality
 * Distribution Monitoring Data" dataset (bkwf-xfky).
 *
 *   npm run data:water-sites
 *
 * The spreadsheet (last updated June 2021) has a site code, a description and
 * X/Y in New York State Plane, Long Island zone, US feet (EPSG:2263). There's
 * no borough column, so each station's borough comes from point-in-polygon
 * against "Borough Boundaries (water areas included)" (wh2p-dxnf); stations
 * outside the five boroughs (upstate reservoirs, Yonkers) get borough null.
 *
 * An .xlsx is a zip of XML files. We only need the first sheet and the shared
 * strings, so this reads the zip directly (node:zlib) instead of adding a
 * spreadsheet dependency.
 *
 * Also prints sample_site codes in the dataset that aren't in the spreadsheet.
 *
 * And src/data/zip-centroids.json, a point for each NYC ZIP, for "nearest
 * stations to a ZIP" (GeoSearch only finds addresses and places, not ZIPs).
 * Each point is the centroid of the largest piece of the ZIP's MODZCTA
 * polygon (pri4-ifjk), so ZIPs with islands don't land in the water. A MODZCTA
 * can cover several ZIPs ("10001, 10119, 10199"); each gets the same point.
 */
import { writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { statePlaneToLatLon } from "../src/lib/water/state-plane.js";

const DOMAIN = "https://data.cityofnewyork.us";
const DATASET_ID = "bkwf-xfky";
const XLSX_URL = `${DOMAIN}/api/views/${DATASET_ID}/files/e93e4856-95f7-48d4-b4c0-fa54989cdbfc` +
  "?download=true&filename=OpenData_Distribution_Water_Quality_Sampling_Sites_Updated_2021-0618.xlsx";
const BOROUGHS_URL = `${DOMAIN}/resource/wh2p-dxnf.geojson`;
const ZCTA_URL = `${DOMAIN}/resource/pri4-ifjk.geojson?$limit=1000`;
const OUT_FILE = new URL("../src/data/water-sites.json", import.meta.url);
const ZIP_OUT_FILE = new URL("../src/data/zip-centroids.json", import.meta.url);

const BOROUGH_VALUES = {
  Manhattan: "MANHATTAN", Bronx: "BRONX", Brooklyn: "BROOKLYN", Queens: "QUEENS", "Staten Island": "STATEN ISLAND"
};

async function fetchOk(url) {
  const headers = process.env.SOCRATA_APP_TOKEN ? { "X-App-Token": process.env.SOCRATA_APP_TOKEN } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res;
}

// ---------- Reading the .xlsx ----------

// { "xl/worksheets/sheet1.xml": Buffer, ... } from the zip's central directory.
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Not a zip file");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < entries; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files[name] = method === 8 ? inflateRawSync(raw) : raw;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// First sheet as an array of rows (arrays of strings).
function readSheet(files) {
  const shared = [...(files["xl/sharedStrings.xml"]?.toString() ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(([, si]) => decode([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  const xml = files["xl/worksheets/sheet1.xml"].toString();
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(([, row]) => {
    const out = [];
    for (const [, attrs, body] of row.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attrs.match(/r="([A-Z]+\d+)"/)[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const v = body?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = body?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      out[colIndex(ref)] = type === "s" ? shared[Number(v)] : type === "inlineStr" ? decode(inline ?? "") : v != null ? decode(v) : null;
    }
    return out;
  });
}

// ---------- Boroughs ----------

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function boroughAt(lat, lon, features) {
  for (const f of features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    // A point is in a polygon when it's in the outer ring and in none of the holes.
    if (polys.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)))) {
      return BOROUGH_VALUES[f.properties.boroname] ?? null;
    }
  }
  return null;
}

// ---------- ZIP points ----------

// Area-weighted centroid of a ring ([lon, lat] pairs) and its (planar) area.
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  return { area: Math.abs(a / 2), lon: cx / (3 * a), lat: cy / (3 * a) };
}

function zipCentroids(geojson) {
  const zips = {};
  for (const f of geojson.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const largest = polys.map(([outer]) => ringCentroid(outer)).sort((a, b) => b.area - a.area)[0];
    if (!largest) continue;
    const point = [Math.round(largest.lat * 1e5) / 1e5, Math.round(largest.lon * 1e5) / 1e5];
    for (const zip of String(f.properties.zcta ?? f.properties.modzcta).split(/,\s*/)) {
      if (/^\d{5}$/.test(zip)) zips[zip] = point;
    }
  }
  return Object.fromEntries(Object.entries(zips).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------- Main ----------

const [xlsx, boroughs, dataSites, zctas] = await Promise.all([
  fetchOk(XLSX_URL).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b)),
  fetchOk(BOROUGHS_URL).then((r) => r.json()),
  fetchOk(`${DOMAIN}/resource/${DATASET_ID}.json?$select=sample_site,count(*) AS n,max(sample_date) AS last&$group=sample_site&$limit=5000`)
    .then((r) => r.json()),
  fetchOk(ZCTA_URL).then((r) => r.json())
]);

const [header, ...rows] = readSheet(unzip(xlsx)).filter((r) => r.some(Boolean));
const expected = ["Sample Site", "Sample Station (SS) - Location Description", "X - Coordinate", "Y - Coordinate"];
if (expected.some((h, i) => header[i]?.trim() !== h)) {
  throw new Error(`Spreadsheet columns changed: ${JSON.stringify(header)}`);
}

const sites = [];
const problems = [];
for (const [code, description, x, y] of rows) {
  const site = String(code ?? "").trim();
  if (!site) continue;
  const X = Number(x), Y = Number(y);
  if (!Number.isFinite(X) || !Number.isFinite(Y) || X <= 0 || Y <= 0) {
    problems.push(`${site}: no usable coordinates (${x}, ${y})`);
    sites.push({ site, description: description?.trim() ?? "", borough: null, lat: null, lon: null });
    continue;
  }
  const { lat, lon } = statePlaneToLatLon(X, Y);
  sites.push({
    site,
    description: description?.trim() ?? "",
    borough: boroughAt(lat, lon, boroughs.features),
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5
  });
}
// The spreadsheet lists 39550 twice, identically; keep the first row for each code.
const dupes = sites.filter((s, i) => sites.findIndex((t) => t.site === s.site) !== i).map((s) => s.site);
sites.splice(0, sites.length, ...sites.filter((s, i) => sites.findIndex((t) => t.site === s.site) === i));
sites.sort((a, b) => a.site.localeCompare(b.site));
const known = new Set(sites.map((s) => s.site));
const unmatched = dataSites.filter((r) => !known.has(r.sample_site)).map((r) => ({
  site: r.sample_site ?? null, samples: Number(r.n), lastSample: r.last?.slice(0, 10) ?? null
}));
const inData = new Set(dataSites.map((r) => r.sample_site));
const neverSampled = sites.filter((s) => !inData.has(s.site)).map((s) => s.site);

const out = {
  source: {
    datasetId: DATASET_ID,
    file: "OpenData_Distribution_Water_Quality_Sampling_Sites_Updated_2021-0618.xlsx",
    url: XLSX_URL,
    boroughs: `${DOMAIN}/d/wh2p-dxnf`,
    projection: "EPSG:2263 (NY State Plane Long Island, US ft) → WGS84"
  },
  builtAt: new Date().toISOString().slice(0, 10),
  // sample_site codes in the dataset with no row in the spreadsheet (no location for them).
  unmatchedDataSites: unmatched,
  sites
};
await writeFile(OUT_FILE, JSON.stringify(out, null, 1) + "\n");

const zips = zipCentroids(zctas);
await writeFile(ZIP_OUT_FILE, JSON.stringify({
  source: `${DOMAIN}/d/pri4-ifjk`,
  builtAt: out.builtAt,
  // ZIP → [lat, lon]
  zips
}) + "\n");

console.log(`Wrote ${sites.length} sites to ${OUT_FILE.pathname}`);
console.log(`Wrote ${Object.keys(zips).length} ZIP points to ${ZIP_OUT_FILE.pathname}`);
const byBorough = {};
for (const s of sites) byBorough[s.borough ?? "outside NYC / no coordinates"] = (byBorough[s.borough ?? "outside NYC / no coordinates"] ?? 0) + 1;
console.log("By borough:", byBorough);
if (problems.length) console.log("Problems:\n  " + problems.join("\n  "));
if (dupes.length) console.log("Duplicate site codes (kept once):", dupes.join(", "));
console.log(`Dataset site codes not in the spreadsheet (${unmatched.length}):`, unmatched);
console.log(`Spreadsheet sites never sampled in the dataset (${neverSampled.length}):`, neverSampled.join(", "));
const outside = sites.filter((s) => s.lat != null && !s.borough);
if (outside.length) console.log("Outside the five boroughs:", outside.map((s) => `${s.site} (${s.description.slice(0, 60)})`));
