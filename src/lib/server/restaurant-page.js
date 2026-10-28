/*
 * Cached restaurant lookup shared by the API route and the page (which
 * renders a deep link like ?camis=50066715 on the server). Lookups that miss
 * the cache are rate limited per client (DETAIL_RATE_LIMITER in wrangler.jsonc).
 */
import { edgeCached } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { restaurantDetail, DETAIL_TTL } from "./restaurants.js";

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
