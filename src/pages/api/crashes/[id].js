/*
 * GET /api/crashes/:collision_id
 * One crash's deep dive: the crash, its vehicles with the people in each,
 * pedestrians and cyclists, and who else is on the report
 * (src/lib/crashes/detail.js).
 * → { dataThrough, collisionId, recognize, details, vehicles, outside, unplaced, notInvolved, sources }
 *   or 404 / 429 / 502 / 503 { error }
 */
import { loadDetail, NoDatabase, DETAIL_TTL, NOT_LOADED_TEXT } from "../../../lib/server/crashes.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

// The tables' ids are 32 hex characters.
const ID = /^[0-9a-f]{32}$/;

export async function GET({ params, url, locals, clientAddress }) {
  const id = String(params.id ?? "").toLowerCase();
  if (!ID.test(id)) return json({ error: "That isn’t a crash ID from this lookup." }, { status: 404 });
  try {
    const detail = await loadDetail(id, url, locals.cfContext, clientAddress);
    if (!detail) return json({ error: "No crash with that ID in this lookup’s data." }, { status: 404 });
    return json(detail, { maxAge: DETAIL_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    if (err instanceof NoDatabase) return json({ error: NOT_LOADED_TEXT }, { status: 503 });
    return upstreamError(err);
  }
}
