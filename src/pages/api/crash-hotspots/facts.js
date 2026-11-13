/*
 * GET /api/crash-hotspots/facts
 * A year of crashes, packed small (packFacts() in src/lib/crashes/hotspot-compute.js),
 * for the page to count a ZIP, street, intersection or spot itself.
 *
 * Reads one KV value and passes it through; cached at the edge per build.
 */
import { factsResponse, NoDatabase, NOT_LOADED_TEXT } from "../../../lib/server/crash-hotspots.js";
import { NotBuilt } from "../../../lib/server/cache.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET({ url, locals }) {
  try {
    return await factsResponse(url, locals.cfContext);
  } catch (err) {
    if (err instanceof NoDatabase || err instanceof NotBuilt) return json({ error: NOT_LOADED_TEXT }, { status: 503 });
    return upstreamError(err);
  }
}
