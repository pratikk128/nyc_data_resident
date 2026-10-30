/*
 * GET /api/311/outcomes?lat=40.748&lon=-73.986&window=3m|12m
 * For the most common closed complaint types within ½ mile: median days to close
 * and how many the city fixed or ticketed, found nothing, or gave no clear answer.
 * → { types: [{ key, closed, days, acted, none, unclear }], ... } or { error }
 *
 * Cached at the edge and rate limited like /api/311/area.
 */
import { outcomeSummary, roundCoord, AREA_TTL } from "../../../lib/server/complaints311.js";
import { windowStart } from "../../../lib/complaints311/soql.js";
import { inNyc } from "../../../lib/complaints311/location-input.js";
import { WINDOWS, RADII } from "../../../lib/complaints311/config.js";
import { edgeCached } from "../../../lib/server/cache.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { checkRateLimit, RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const p = url.searchParams;
  const lat = roundCoord(p.get("lat")), lon = roundCoord(p.get("lon"));
  const window = p.get("window") ?? "12m";
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inNyc(lat, lon)) {
    return json({ error: "That spot isn’t in New York City." }, { status: 400 });
  }
  if (!WINDOWS[window]) return json({ error: "Unknown time period." }, { status: 400 });

  const key = `311/outcomes/${window}/${windowStart(window)}/${lat},${lon}/${RADII.neighborhood}`;
  try {
    const data = await edgeCached(url, key, AREA_TTL, async () => {
      await checkRateLimit("AREA_RATE_LIMITER", clientAddress);
      return outcomeSummary(lat, lon, window);
    }, locals.cfContext);
    return json(data, { maxAge: AREA_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
