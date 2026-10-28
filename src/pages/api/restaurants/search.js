/*
 * GET /api/restaurants/search?name=joe&boro=Manhattan&place=123+Broadway&lat=&lng=
 * Up to 25 restaurants (one per camis) with their latest grade.
 * → { results: [...], more: boolean } or { error }
 */
import { normalizeSearch } from "../../../lib/restaurants/soql.js";
import { searchRestaurants, SEARCH_TTL } from "../../../lib/server/restaurants.js";
import { edgeCached } from "../../../lib/server/cache.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET({ url, locals }) {
  const p = url.searchParams;
  const { error, query } = normalizeSearch({
    name: p.get("name"), boro: p.get("boro"), where: p.get("place"), lat: p.get("lat"), lng: p.get("lng")
  });
  if (error) return json({ error }, { status: 400 });

  // The cache key is the normalized query, so "joe " and "JOE" share an entry.
  const key = `restaurants/search/${encodeURIComponent(JSON.stringify(query))}`;
  try {
    const data = await edgeCached(url, key, SEARCH_TTL, () => searchRestaurants(query), locals.cfContext);
    return json(data, { maxAge: SEARCH_TTL });
  } catch (err) {
    return upstreamError(err);
  }
}
