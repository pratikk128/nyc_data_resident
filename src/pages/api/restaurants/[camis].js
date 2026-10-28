/*
 * GET /api/restaurants/:camis
 * One restaurant: latest grade and inspection, and
 * violations by category vs citywide and similar-restaurant means.
 */
import { loadRestaurant, isCamis } from "../../../lib/server/restaurant-page.js";
import { DETAIL_TTL } from "../../../lib/server/restaurants.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET({ params, url, locals }) {
  if (!isCamis(params.camis)) return json({ error: "not-found" }, { status: 404 });
  try {
    const data = await loadRestaurant(params.camis, url, locals.cfContext);
    if (!data) return json({ error: "not-found" }, { status: 404, maxAge: DETAIL_TTL });
    return json(data, { maxAge: DETAIL_TTL });
  } catch (err) {
    return upstreamError(err);
  }
}
