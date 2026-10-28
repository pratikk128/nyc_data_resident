/*
 * GET /api/restaurants/:camis
 * One restaurant: latest grade and inspection, and
 * violations by category vs citywide and similar-restaurant means.
 */
import { loadRestaurant, isCamis } from "../../../lib/server/restaurant-page.js";
import { DETAIL_TTL } from "../../../lib/server/restaurants.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ params, url, locals, clientAddress }) {
  if (!isCamis(params.camis)) return json({ error: "not-found" }, { status: 404 });
  try {
    const data = await loadRestaurant(params.camis, url, locals.cfContext, clientAddress);
    if (!data) return json({ error: "not-found" }, { status: 404, maxAge: DETAIL_TTL });
    return json(data, { maxAge: DETAIL_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
