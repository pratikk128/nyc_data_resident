/*
 * GET /api/schools/search?q=&type=&boro=&where=&all=&sort=&page=[&view=map]
 * One page of schools for the NYC School Quality Explorer browse page, with
 * the type and borough counts. Parameters are described in
 * src/lib/schools/filter.js.
 * → { total, page, pages, pageSize, results, facets, latestYear } or { error }
 * view=map → { total, missing, points: [[lat, lon, dbn, name, type], ...] } for every match
 *
 * Reads the daily school index in KV, so requests don't reach Socrata. Misses
 * on the edge cache are rate limited per client (SCHOOL_SEARCH_RATE_LIMITER).
 */
import { normalizeQuery } from "../../../lib/schools/filter.js";
import { loadSearch, SEARCH_TTL } from "../../../lib/server/schools.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const { error, query } = normalizeQuery(url.searchParams);
  if (error) return json({ error }, { status: 400 });
  const view = url.searchParams.get("view") === "map" ? "map" : "list";
  try {
    return json(await loadSearch(query, { view }, url, locals.cfContext, clientAddress), { maxAge: SEARCH_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
