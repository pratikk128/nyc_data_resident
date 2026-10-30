/*
 * GET /api/street-closures/search?street=WEST+8+STREET&boro=B | ?boro=Q | ?lat=&lon=&r=0.5 | (nothing: all of NYC)
 * Every closed block for the place with its upcoming permits (ended ones
 * left out), nearest first for a spot. Parameters are described in
 * src/lib/street-closures/filter.js.
 * → { today, computedAt, postedThrough, blocks: [{ seg, on, from, to, boro, onKey, lines, permits, meters? }] } or { error }
 *
 * Reads the block index in KV, so requests don't reach Socrata. Misses on the
 * edge cache are rate limited per client (CLOSURES_RATE_LIMITER).
 */
import { normalizeQuery } from "../../../lib/street-closures/filter.js";
import { loadSearch, SEARCH_TTL } from "../../../lib/server/street-closures.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const query = normalizeQuery(url.searchParams);
  try {
    return json(await loadSearch(query, url, locals.cfContext, clientAddress), { maxAge: SEARCH_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
