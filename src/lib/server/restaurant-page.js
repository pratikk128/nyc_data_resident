/*
 * Cached restaurant lookup and search, shared by the API routes and the page
 * (which renders a deep link like ?camis=50066715, and a search like
 * ?name=joe submitted without JavaScript, on the server). Lookups that miss
 * the cache are rate limited per client (DETAIL_RATE_LIMITER and
 * SEARCH_RATE_LIMITER in wrangler.jsonc).
 */
import { edgeCached } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { restaurantDetail, searchRestaurants, DETAIL_TTL, SEARCH_TTL } from "./restaurants.js";

export function isCamis(value) {
  return /^\d{5,10}$/.test(String(value ?? ""));
}

// null when the camis doesn't exist (also cached, as { missing: true }).
// Throws RateLimited when this client has made too many uncached lookups.
export async function loadRestaurant(camis, requestUrl, ctx, clientAddress) {
  const data = await edgeCached(
    requestUrl,
    `restaurants/detail/${camis}`,
    DETAIL_TTL,
    async () => {
      await checkRateLimit("DETAIL_RATE_LIMITER", clientAddress);
      return (await restaurantDetail(camis)) ?? { missing: true };
    },
    ctx
  );
  return data.missing ? null : data;
}

// `query` comes from normalizeSearch(). The cache key is the normalized query,
// so "joe " and "JOE" share an entry. Throws RateLimited like loadRestaurant().
export function loadSearch(query, requestUrl, ctx, clientAddress) {
  return edgeCached(
    requestUrl,
    `restaurants/search/${encodeURIComponent(JSON.stringify(query))}`,
    SEARCH_TTL,
    async () => {
      await checkRateLimit("SEARCH_RATE_LIMITER", clientAddress);
      return searchRestaurants(query);
    },
    ctx
  );
}
