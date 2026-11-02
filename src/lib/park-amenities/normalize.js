/*
 * Turning each amenity dataset's rows into one shape. Pure and browser-safe,
 * so the tests run it on real sample rows; the ETL job
 * (src/lib/server/park-amenities.js) fetches the rows and the park names.
 *
 *   { id, category, name, parkName, borough, lat, lon, details,
 *     sourceDataset, sourceLastUpdated }
 *
 * Every row becomes one point: a point as it is, a polygon or multipolygon
 * (playgrounds, dog runs, pools) at its centroid. details is the category's
 * own (config.js map()). Missing values stay null; nothing is filled in.
 */
import { CATEGORIES, boroughName } from "./config.js";
import { inCityLimits } from "../in-city.js";

const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim() || null;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Signed area and area-weighted centroid sums of one ring of [lon, lat] (shoelace).
function ringSums(ring) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  return { a: a / 2, x, y };
}

/*
 * A GeoJSON Point, Polygon or MultiPolygon → { lat, lon }, or null.
 * Polygons: the area-weighted centroid of their outer rings less their holes
 * (by size, so ring direction doesn't matter). At a park's scale lon/lat are
 * flat enough. A shape with no area (a sliver) falls back to its vertices' mean.
 */
export function centroid(geometry) {
  if (!geometry?.coordinates) return null;
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: round6(lat), lon: round6(lon) } : null;
  }
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : null;
  if (!polygons?.length) return null;
  let area = 0, sx = 0, sy = 0;
  for (const rings of polygons) {
    rings.forEach((ring, i) => {
      const s = ringSums(ring);
      // Outer ring adds, holes subtract, whichever way each is wound.
      const sign = (i === 0 ? 1 : -1) * Math.sign(s.a);
      area += sign * s.a;
      sx += sign * s.x;
      sy += sign * s.y;
    });
  }
  let lon, lat;
  if (Math.abs(area) > 1e-14) {
    lon = sx / (6 * area);
    lat = sy / (6 * area);
  } else {
    const pts = polygons.flatMap((rings) => rings[0] ?? []);
    if (!pts.length) return null;
    lon = pts.reduce((t, p) => t + p[0], 0) / pts.length;
    lat = pts.reduce((t, p) => t + p[1], 0) / pts.length;
  }
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: round6(lat), lon: round6(lon) } : null;
}

/*
 * One dataset's rows → its amenities. category: a CATEGORIES entry.
 *   parkNames  { [gispropnum]: "Joyce Kilmer Park" }, from Parks Properties
 *   updatedAt  the dataset's rowsUpdatedAt ("2026-10-07")
 * Rows the category's map() drops (fountain sinks), with no usable
 * geometry, or outside the city are left out; a repeated id keeps its first row.
 */
export function normalizeRows(category, rows, { parkNames = {}, updatedAt = null } = {}) {
  const out = new Map();
  for (const row of rows) {
    const m = category.map(row);
    if (!m) continue;
    const point = centroid(m.geometry);
    if (!point || !inCityLimits(point.lat, point.lon)) continue;
    const id = `${category.key}:${text(m.id) ?? `${point.lat},${point.lon}`}`;
    if (out.has(id)) continue;
    const parkName = text(m.parkName) ?? text(parkNames[text(m.parkId)]) ?? null;
    out.set(id, {
      id,
      category: category.key,
      name: text(m.name) ?? parkName ?? category.one,
      parkName,
      borough: boroughName(m.borough),
      lat: point.lat,
      lon: point.lon,
      details: m.details ?? {},
      sourceDataset: category.datasetId,
      sourceLastUpdated: updatedAt
    });
  }
  return [...out.values()];
}

// Parks Properties rows ({ gispropnum, signname }) → { [gispropnum]: signname }.
export function parkNameIndex(rows) {
  const out = {};
  for (const r of rows) {
    const id = text(r.gispropnum), name = text(r.signname);
    if (id && name) out[id] = name;
  }
  return out;
}

export const categoryByDataset = (id) => CATEGORIES.find((c) => c.datasetId === id) ?? null;
