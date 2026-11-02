/*
 * GET /api/park-amenities/search?lat=40.75&lon=-73.98
 * Park amenities near a spot in NYC: every playground, dog run, drinking
 * fountain and pool within 1 mile, plus the nearest one of any kind with none
 * that close, nearest first. The radius and categories are picked in the
 * browser without another request.
 * → { point, amenities: [{ id, category, name, parkName, borough, lat, lon, details,
 *     sourceDataset, sourceLastUpdated, miles }], sources: [{ key, datasetId, name, url, updatedAt, error }] }
 *   or { error }
 *
 * Reads the amenities in KV, so requests don't reach Socrata once the ETL has
 * built them. Misses on the edge cache are rate limited per client (PARKS_RATE_LIMITER).
 */
import { loadSearch, SEARCH_TTL } from "../../../lib/server/park-amenities.js";
import { inCityLimits } from "../../../lib/in-city.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!url.searchParams.has("lat") || !url.searchParams.has("lon") || !Number.isFinite(lat) || !Number.isFinite(lon) || !inCityLimits(lat, lon)) {
    return json({ error: "Pick a spot in New York City." }, { status: 400 });
  }
  try {
    const body = await loadSearch({ lat, lon }, url, locals.cfContext, clientAddress);
    // A dataset that failed shouldn't stay missing in the browser's cache once it's back.
    return json(body, { maxAge: body.sources.some((s) => s.error) ? 0 : SEARCH_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
