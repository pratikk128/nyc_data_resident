/*
 * GET /api/building-report/:section?bbl=2031070036
 * One section of the Building Report Card (SECTIONS in config.js) for one
 * tax lot, from src/lib/server/building-report.js. A page asks for each
 * section it shows at once, so each loads and fails on its own.
 * → { section, ...summary, sources: [{ id, name, url, updatedAt }] }, or { error }
 */
import { loadLot, loadSection } from "../../../lib/server/building-report.js";
import { bblProblem, SECTION_KEYS, SECTION_TTL } from "../../../lib/building-report/config.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ params, url, locals, clientAddress }) {
  if (!SECTION_KEYS.includes(params.section)) return json({ error: "not-found" }, { status: 404 });
  const bbl = url.searchParams.get("bbl");
  const problem = bblProblem(bbl);
  if (problem) return json({ error: problem }, { status: 400 });
  try {
    const lot = await loadLot(bbl, url, locals.cfContext, clientAddress);
    if (!lot) return json({ error: "not-found" }, { status: 404, maxAge: SECTION_TTL });
    return json(await loadSection(params.section, lot, url, locals.cfContext, clientAddress), { maxAge: SECTION_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
