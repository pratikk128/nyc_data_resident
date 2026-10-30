/*
 * GET /api/address/nearest?lat=40.748&lon=-73.986
 * The address report's nearest water station, help and schools, picked on
 * the server (src/lib/server/address-report.js), so the page gets a few
 * items instead of every station, help site and school.
 * → { water: { station, data }, help: { sites }, schools: { schools } }, any of them
 *   { failed: true, error } on its own; or { error }
 *
 * Reads KV through each dashboard's own cached, rate-limited loader.
 */
import { loadNearest, NEAREST_TTL } from "../../../lib/server/address-report.js";
import { spotFromParams } from "../../../lib/address-report/report.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET({ url, locals, clientAddress }) {
  const spot = spotFromParams(url.searchParams);
  if (!spot) return json({ error: "Pick a spot in New York City." }, { status: 400 });
  try {
    const body = await loadNearest(spot, url, locals.cfContext, clientAddress);
    // A part that failed shouldn't stay missing in the browser's cache once it's back.
    return json(body, { maxAge: Object.values(body).some((p) => p.failed) ? 0 : NEAREST_TTL });
  } catch (err) {
    return upstreamError(err);
  }
}
