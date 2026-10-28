/*
 * GET /api/311/zip?zip=11211&window=12m
 * Requests that name a ZIP, plus a centre point and borough for the radius views.
 * → { zip, total, borough, center: { lat, lon } } or { error } (404 when no request names it)
 */
import { zipSummary, AREA_TTL } from "../../../lib/server/complaints311.js";
import { windowStart } from "../../../lib/complaints311/soql.js";
import { isNycZip } from "../../../lib/complaints311/location-input.js";
import { WINDOWS } from "../../../lib/complaints311/config.js";
import { edgeCached } from "../../../lib/server/cache.js";
import { json, upstreamError } from "../../../lib/server/json.js";
import { checkRateLimit, RateLimited, RATE_LIMITED_TEXT } from "../../../lib/server/rate-limit.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const zip = url.searchParams.get("zip") ?? "";
  const window = url.searchParams.get("window") ?? "12m";
  if (!/^\d{5}$/.test(zip) || !isNycZip(zip)) return json({ error: "That isn’t a New York City ZIP code." }, { status: 400 });
  if (!WINDOWS[window]) return json({ error: "Unknown time period." }, { status: 400 });

  const key = `311/zip/${window}/${windowStart(window)}/${zip}`;
  try {
    const data = await edgeCached(url, key, AREA_TTL, async () => {
      await checkRateLimit("AREA_RATE_LIMITER", clientAddress);
      return (await zipSummary(zip, window)) ?? { missing: true };
    }, locals.cfContext);
    if (data.missing) return json({ error: "not-found" }, { status: 404, maxAge: AREA_TTL });
    return json(data, { maxAge: AREA_TTL });
  } catch (err) {
    if (err instanceof RateLimited) return json({ error: RATE_LIMITED_TEXT }, { status: 429 });
    return upstreamError(err);
  }
}
