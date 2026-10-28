/*
 * GET /api/311/area?lat=40.748&lon=-73.986&area=immediate|neighborhood&window=3m|12m
 * 311 requests within a radius: total, by complaint type, by location type,
 * open vs closed. → { total, types, locations, status, ... } or { error }
 *
 * Cached at the edge by rounded lat/lon (3 decimals) + radius + window. Lookups
 * that miss the cache go to Socrata on our app token, so they're rate limited
 * per client (AREA_RATE_LIMITER in wrangler.jsonc).
 */
import { radiusSummary, roundCoord, AREA_TTL } from "../../../lib/server/complaints311.js";
import { windowStart } from "../../../lib/complaints311/soql.js";
import { inNyc } from "../../../lib/complaints311/location-input.js";
import { AREAS, WINDOWS } from "../../../lib/complaints311/config.js";
import { edgeCached } from "../../../lib/server/cache.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { checkRateLimit, RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const p = url.searchParams;
  const lat = roundCoord(p.get("lat")), lon = roundCoord(p.get("lon"));
  const area = p.get("area");
  const window = p.get("window") ?? "12m";
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inNyc(lat, lon)) {
    return json({ error: "That spot isn’t in New York City." }, { status: 400 });
  }
  if (!AREAS[area] || !WINDOWS[window]) return json({ error: "Unknown area or time period." }, { status: 400 });

  // windowStart() in the key makes entries roll over with the date.
  const key = `311/area/${window}/${windowStart(window)}/${lat},${lon}/${AREAS[area].radius}`;
  try {
    const data = await edgeCached(url, key, AREA_TTL, async () => {
      await checkRateLimit("AREA_RATE_LIMITER", clientAddress);
      return radiusSummary(lat, lon, area, window);
    }, locals.cfContext);
    return json(data, { maxAge: AREA_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
