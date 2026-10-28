/*
 * GET /api/water/stations?sites=31650,45050,1S03B
 * Last 12 complete months for up to 3 sampling stations: monthly median
 * chlorine and turbidity, bacteria counts and detections, plus the citywide
 * medians for comparison. → { months, completeMonth, city, stations } or { error }
 *
 * Read from the daily stations job in KV (water.js), so requests don't reach
 * Socrata and need no rate limit.
 */
import { stationDetails } from "../../../lib/server/water.js";
import { MAX_SELECTED } from "../../../lib/water/config.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

const MAX_AGE = 3600;
const SITE_CODE = /^[A-Za-z0-9]{1,10}$/;

export async function GET({ url }) {
  const sites = [...new Set((url.searchParams.get("sites") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!sites.length || sites.length > MAX_SELECTED || !sites.every((s) => SITE_CODE.test(s))) {
    return json({ error: `Pick between 1 and ${MAX_SELECTED} sampling stations.` }, { status: 400 });
  }
  try {
    return json(await stationDetails(sites), { maxAge: MAX_AGE });
  } catch (err) {
    return upstreamError(err);
  }
}
