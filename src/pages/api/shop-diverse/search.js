/*
 * GET /api/shop-diverse/search?who=wbe,mbe&cat=Construction&q=&boro=&zip=&sort=&page=
 * One page of certified businesses, ranked, with the counts for every filter
 * option and the summary numbers. Parameters are described in
 * src/lib/shop-diverse/filter.js.
 * → { total, page, pages, pageSize, results, facets, kpis } or { error }
 *
 * Reads the daily vendor list in KV, so requests don't reach Socrata. Misses
 * on the edge cache are rate limited per client (SHOP_SEARCH_RATE_LIMITER).
 */
import { normalizeQuery } from "../../../lib/shop-diverse/filter.js";
import { loadSearch, SEARCH_TTL } from "../../../lib/server/shop-diverse.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const { error, query } = normalizeQuery(url.searchParams);
  if (error) return json({ error }, { status: 400 });
  try {
    return json(await loadSearch(query, url, locals.cfContext, clientAddress), { maxAge: SEARCH_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
