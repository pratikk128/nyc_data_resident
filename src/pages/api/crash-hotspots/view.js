/*
 * GET /api/crash-hotspots/view?[boro=…][&mode=…]
 * All of NYC or one borough, with or without a mode: { summary, map }, as
 * the data refresh built them (viewResponse() in src/lib/server/crash-hotspots.js).
 * Any other place is counted in the browser from /api/crash-hotspots/facts.
 * Parameters are described in src/lib/crashes/hotspot-query.js.
 *
 * Reads one KV value and passes it through; cached at the edge per build.
 */
import { readQuery } from "../../../lib/crashes/hotspot-query.js";
import { viewResponse, isPrebuilt, NoDatabase, NOT_LOADED_TEXT } from "../../../lib/server/crash-hotspots.js";
import { NotBuilt } from "../../../lib/server/cache.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET({ url, locals }) {
  const query = readQuery(url.searchParams);
  if (!isPrebuilt(query)) return json({ error: "Only all of NYC or a borough; the page counts other places itself." }, { status: 400 });
  try {
    return await viewResponse(query, url, locals.cfContext);
  } catch (err) {
    if (err instanceof NoDatabase || err instanceof NotBuilt) return json({ error: NOT_LOADED_TEXT }, { status: 503 });
    return upstreamError(err);
  }
}
