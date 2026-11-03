/*
 * GET /api/building-report/lot?bbl=2031070036
 * The lot a report page shows in its header (summarizeLot()), for a page the
 * server sent before the lot came back (lotForPage() in
 * src/lib/server/building-report.js). The page asks for its sections once
 * it has this, so they find the lot cached.
 * → { lot }, or { error }
 */
import { loadLot } from "../../../lib/server/building-report.js";
import { bblProblem, BUILDING_TTL } from "../../../lib/building-report/config.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const bbl = url.searchParams.get("bbl");
  const problem = bblProblem(bbl);
  if (problem) return json({ error: problem }, { status: 400 });
  try {
    const lot = await loadLot(bbl, url, locals.cfContext, clientAddress);
    if (!lot) return json({ error: "not-found" }, { status: 404, maxAge: BUILDING_TTL });
    return json({ lot }, { maxAge: BUILDING_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
