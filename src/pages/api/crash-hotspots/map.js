/*
 * GET /api/crash-hotspots/map?{place and filters}
 * The map: crashes per ~165 m square, and each crash that seriously hurt or
 * killed someone. Parameters are described in src/lib/crashes/hotspot-query.js.
 * → loadMap() in src/lib/server/crash-hotspots.js, or { error }
 *
 * Reads D1 only. Cached at the edge per view; misses are rate limited per
 * client (HOTSPOTS_RATE_LIMITER).
 */
import { readQuery } from "../../../lib/crashes/hotspot-query.js";
import { loadMap } from "../../../lib/server/crash-hotspots.js";
import { NoDatabase, NOT_LOADED_TEXT } from "../../../lib/server/crashes.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  try {
    return json(await loadMap(readQuery(url.searchParams), url, locals.cfContext, clientAddress), { maxAge: 300 });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    if (err instanceof NoDatabase) return json({ error: NOT_LOADED_TEXT }, { status: 503 });
    return upstreamError(err);
  }
}
