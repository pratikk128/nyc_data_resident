/*
 * GET /api/311/heatmap?lat=40.748&lon=-73.986&window=3m|12m[&types=NOISE - RESIDENTIAL|ILLEGAL PARKING]
 * Requests within ½ mile per ~50 m grid cell, for the heat map.
 * `types` is a |-separated list of typeKey() values; empty means every type.
 * → { total, cells: [[lat, lon, n], ...], ... } or { error }
 *
 * Cached at the edge and rate limited like /api/311/area.
 */
import { heatmapCells, roundCoord, AREA_TTL } from "../../../lib/server/complaints311.js";
import { windowStart } from "../../../lib/complaints311/soql.js";
import { typeKey } from "../../../lib/complaints311/labels.js";
import { inCityLimits } from "../../../lib/in-city.js";
import { WINDOWS, MAX_HEATMAP_TYPES, RADII } from "../../../lib/complaints311/config.js";
import { edgeCached } from "../../../lib/server/cache.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { checkRateLimit, RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const p = url.searchParams;
  const lat = roundCoord(p.get("lat")), lon = roundCoord(p.get("lon"));
  const window = p.get("window") ?? "12m";
  const types = [...new Set((p.get("types") ?? "").split("|").map(typeKey).filter(Boolean))].sort();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inCityLimits(lat, lon)) {
    return json({ error: "That spot isn’t in New York City." }, { status: 400 });
  }
  if (!WINDOWS[window]) return json({ error: "Unknown time period." }, { status: 400 });
  if (types.length > MAX_HEATMAP_TYPES || types.some((t) => t.length > 80)) {
    return json({ error: "Too many complaint types." }, { status: 400 });
  }

  const key = `311/heatmap/${window}/${windowStart(window)}/${lat},${lon}/${RADII.neighborhood}/${encodeURIComponent(types.join("|"))}`;
  try {
    const data = await edgeCached(url, key, AREA_TTL, async () => {
      await checkRateLimit("AREA_RATE_LIMITER", clientAddress);
      return heatmapCells(lat, lon, window, types);
    }, locals.cfContext);
    return json(data, { maxAge: AREA_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
