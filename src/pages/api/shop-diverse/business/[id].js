/*
 * GET /api/shop-diverse/business/357418
 * One certified business, cleaned (contact, certifications, industry codes,
 * capacity and past jobs). → the vendor, 404 { error } or 429 { error }
 *
 * Read live from Socrata by account number; misses on the edge cache are rate
 * limited per client (DETAIL_RATE_LIMITER in wrangler.jsonc).
 */
import { isAccount, loadBusiness, DETAIL_TTL } from "../../../../lib/server/shop-diverse.js";
import { json, upstreamError } from "../../../../lib/server/json.js";
import { RateLimited, RATE_LIMITED_TEXT } from "../../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ params, url, locals, clientAddress }) {
  if (!isAccount(params.id)) return json({ error: "That isn’t a business ID from the list." }, { status: 400 });
  try {
    const data = await loadBusiness(params.id, url, locals.cfContext, clientAddress);
    if (!data) return json({ error: "not-found" }, { status: 404 });
    return json(data, { maxAge: DETAIL_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
