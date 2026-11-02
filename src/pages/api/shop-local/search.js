/*
 * GET /api/shop-local/search?what=eat&own=women,black&q=&near=11216&boro=&outside=1&page=
 * One page of resident-facing certified businesses, nearest first when a ZIP
 * is given, with the counts for every tile and chip. Parameters are
 * described in src/lib/shop-local/filter.js.
 * → { total, page, pages, pageSize, results, facets, all } or { error }
 *
 * Reads the daily vendor list in KV, so requests don't reach Socrata. Misses
 * on the edge cache are rate limited per client (SHOP_SEARCH_RATE_LIMITER).
 */
import { normalizeQuery } from "../../../lib/shop-local/filter.js";
import { loadLocalSearch, SEARCH_TTL } from "../../../lib/server/shop-local.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const { error, query } = normalizeQuery(url.searchParams);
  if (error) return json({ error }, { status: 400 });
  try {
    return json(await loadLocalSearch(query, url, locals.cfContext, clientAddress), { maxAge: SEARCH_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
