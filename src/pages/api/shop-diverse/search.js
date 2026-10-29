/*
 * GET /api/shop-diverse/search?who=wbe,mbe&cat=Construction&q=&boro=&zip=&sort=&page=
 * One page of certified businesses, ranked, with the counts for every filter
 * option and the summary numbers. Parameters are described in
 * src/lib/shop-diverse/filter.js.
 * → { total, page, pages, pageSize, results, facets, kpis } or { error }
 *
 * Reads the daily vendor list in KV, so requests don't reach Socrata.
 */
import { normalizeQuery } from "../../../lib/shop-diverse/filter.js";
import { loadSearch, SEARCH_TTL } from "../../../lib/server/shop-diverse.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET({ url, locals }) {
  const { error, query } = normalizeQuery(url.searchParams);
  if (error) return json({ error }, { status: 400 });
  try {
    return json(await loadSearch(query, url, locals.cfContext), { maxAge: SEARCH_TTL });
  } catch (err) {
    return upstreamError(err);
  }
}
