/*
 * Cached restaurant lookup shared by the API route and the page (which
 * renders a deep link like ?camis=50066715 on the server).
 */
import { edgeCached } from "./cache.js";
import { restaurantDetail, DETAIL_TTL } from "./restaurants.js";

export function isCamis(value) {
  return /^\d{5,10}$/.test(String(value ?? ""));
}

// null when the camis doesn't exist (also cached, as { missing: true }).
export async function loadRestaurant(camis, requestUrl, ctx) {
  const data = await edgeCached(
    requestUrl,
    `restaurants/detail/${camis}`,
    DETAIL_TTL,
    async () => (await restaurantDetail(camis)) ?? { missing: true },
    ctx
  );
  return data.missing ? null : data;
}
