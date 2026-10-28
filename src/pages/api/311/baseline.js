/*
 * GET /api/311/baseline?window=12m&boro=BROOKLYN
 * Citywide counts (and one borough's, if asked) by complaint type, location
 * type, status and month. Computed once a day and kept in KV (daily-jobs.js);
 * the first request after a deploy waits about a minute while it's built.
 */
import { baseline, BASELINE_TTL } from "../../../lib/server/complaints311.js";
import { WINDOWS, BOROUGHS } from "../../../lib/complaints311/config.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET({ url }) {
  const window = url.searchParams.get("window") ?? "12m";
  const boro = url.searchParams.get("boro");
  if (!WINDOWS[window]) return json({ error: "Unknown time period." }, { status: 400 });
  if (boro && !BOROUGHS.some((b) => b.value === boro)) return json({ error: "Unknown borough." }, { status: 400 });
  try {
    return json(await baseline(window, boro), { maxAge: BASELINE_TTL });
  } catch (err) {
    return upstreamError(err);
  }
}
