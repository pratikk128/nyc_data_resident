/*
 * GET /api/help-near-me/search?lat=40.85&lon=-73.89
 * Help sites near a spot in NYC: every site within 2 miles, plus the nearest
 * few of any category with none that close, nearest first. The radius and
 * categories are picked in the browser without another request.
 * GET /api/help-near-me/search?boro=bronx
 * Every site in a borough, A to Z, with no miles.
 * → { point, borough, sites: [{ id, category, name, address, borough, zip, lat, lon, phone, hours, services,
 *     provider, note, closed, sourceDatasetId, miles }], sources: [{ key, datasetId, name, url, updatedAt, error }] }
 *   or { error }
 *
 * Reads the sites in KV, so requests don't reach Socrata. Misses on the edge
 * cache are rate limited per client (HELP_RATE_LIMITER).
 */
import { loadSearch, SEARCH_TTL } from "../../../lib/server/help-near-me.js";
import { inCityLimits } from "../../../lib/help-near-me/in-city.js";
import { boroughOf } from "../../../lib/help-near-me/config.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const borough = boroughOf(url.searchParams.get("boro"));
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (url.searchParams.has("boro") && !borough) return json({ error: "Pick one of the five boroughs." }, { status: 400 });
  if (!borough && (!Number.isFinite(lat) || !Number.isFinite(lon) || !inCityLimits(lat, lon))) {
    return json({ error: "Pick a spot in New York City." }, { status: 400 });
  }
  try {
    const body = await loadSearch(borough ? { borough } : { lat, lon }, url, locals.cfContext, clientAddress);
    // A directory that failed shouldn't stay missing in the browser's cache once it's back.
    return json(body, { maxAge: body.sources.some((s) => s.error) ? 0 : SEARCH_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
