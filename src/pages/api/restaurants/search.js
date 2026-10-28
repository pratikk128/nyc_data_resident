/*
 * GET /api/restaurants/search?name=joe&boro=Manhattan&place=123+Broadway&lat=&lng=
 * Up to 25 restaurants (one per camis) with their latest grade.
 * → { results: [...], more: boolean } or { error }
 *
 * Queries that miss the edge cache go to Socrata on our app token, so those
 * are rate limited per client (SEARCH_RATE_LIMITER in wrangler.jsonc).
 */
import { normalizeSearch } from "../../../lib/restaurants/soql.js";
import { SEARCH_TTL } from "../../../lib/server/restaurants.js";
import { loadSearch } from "../../../lib/server/restaurant-page.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const p = url.searchParams;
  const { error, query } = normalizeSearch({
    name: p.get("name"), boro: p.get("boro"), where: p.get("place"), lat: p.get("lat"), lng: p.get("lng")
  });
  if (error) return json({ error }, { status: 400 });

  try {
    const data = await loadSearch(query, url, locals.cfContext, clientAddress);
    return json(data, { maxAge: SEARCH_TTL });
  } catch (err) {
    if (err instanceof RateLimited) {
      return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    }
    return upstreamError(err);
  }
}
