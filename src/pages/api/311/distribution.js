/*
 * GET /api/311/distribution?window=12m
 * How many requests fall within ¼ and ½ mile of locations across NYC, as
 * sorted quantiles, so the page can rank a spot against the rest of the city.
 * Computed once a day and kept in KV (src/lib/server/etl.js); the first request after
 * a deploy waits about a minute while it's built.
 */
import { distribution, BASELINE_TTL } from "../../../lib/server/complaints311.js";
import { WINDOWS } from "../../../lib/complaints311/config.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET({ url }) {
  const window = url.searchParams.get("window") ?? "12m";
  if (!WINDOWS[window]) return json({ error: "Unknown time period." }, { status: 400 });
  try {
    return json(await distribution(window), { maxAge: BASELINE_TTL });
  } catch (err) {
    return upstreamError(err);
  }
}
