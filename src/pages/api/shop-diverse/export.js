/*
 * GET /api/shop-diverse/export?ids=357418,12345
 * GET /api/shop-diverse/export?code=238210&bond=1m&boro=brooklyn …
 * A CSV of certified businesses for a contractor's or buyer's shortlist:
 * the ids given (up to MAX_EXPORT, in that order), or else the first
 * MAX_EXPORT results of the search the other parameters describe (see
 * src/lib/shop-diverse/filter.js). Columns are in src/lib/shop-diverse/export.js.
 * → text/csv, or 400/429/502 { error }
 *
 * Reads the vendors live from Socrata; rate limited per client
 * (SHOP_DETAIL_RATE_LIMITER).
 */
import { normalizeQuery } from "../../../lib/shop-diverse/filter.js";
import { parseIds } from "../../../lib/shop-diverse/export.js";
import { MAX_EXPORT } from "../../../lib/shop-diverse/config.js";
import { loadExport } from "../../../lib/server/shop-diverse.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";
import { nycToday } from "../../../lib/format.js";

export const prerender = false;

export async function GET({ url, clientAddress }) {
  let source;
  if (url.searchParams.has("ids")) {
    const ids = parseIds(url.searchParams.get("ids"), MAX_EXPORT);
    if (!ids.length) return json({ error: "Add businesses to your shortlist first." }, { status: 400 });
    source = { ids };
  } else {
    const { error, query } = normalizeQuery(url.searchParams);
    if (error) return json({ error }, { status: 400 });
    source = { query };
  }
  try {
    const csv = await loadExport(source, clientAddress);
    const name = `${source.ids ? "mwbe-shortlist" : "mwbe-search"}-${nycToday()}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
