/*
 * POST /api/crashes/search  { location?, date?, time?, vehicle?, person? }
 * Possible matches for what someone remembers about a crash, best first.
 * The body is described in src/lib/crashes/query.js.
 * → { dataThrough, total, broad, dateOnly, results: [card] } (cards: src/lib/crashes/search.js)
 *   or 400 { problems: [sentence] }, 429 / 502 / 503 { error }
 *
 * Reads D1 only. Cached at the edge per query; misses are rate limited
 * per client (CRASHES_RATE_LIMITER).
 */
import { normalizeSearch } from "../../../lib/crashes/query.js";
import { loadSearch, dataStatus, NoDatabase, NOT_LOADED_TEXT } from "../../../lib/server/crashes.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

const MAX_BODY = 4096;

export async function POST({ request, url, locals, clientAddress }) {
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ problems: ["That’s more than a lookup needs. Trim it down and try again."] }, { status: 400 });
    body = JSON.parse(text || "{}");
  } catch {
    return json({ problems: ["We couldn’t read that search. Reload the page and try again."] }, { status: 400 });
  }
  try {
    const { dataThrough } = await dataStatus();
    const { criteria, problems } = normalizeSearch(body, { dataThrough });
    if (problems.length) return json({ problems }, { status: 400 });
    return json(await loadSearch(criteria, url, locals.cfContext, clientAddress));
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    if (err instanceof NoDatabase) return json({ error: NOT_LOADED_TEXT }, { status: 503 });
    return upstreamError(err);
  }
}
