/*
 * GET /api/restaurants/leads
 * Every restaurant with a critical violation in a business group's codes over
 * the last 30 days of the data, for the leads page to filter and rank.
 * → { referenceDate, since, days, descriptions, restaurants: [...] } or { error }
 *
 * Computed once a day and kept in KV (daily-jobs.js), so requests don't go
 * to Socrata and aren't rate limited.
 */
import { getLeads, LEADS_TTL } from "../../../lib/server/restaurants.js";
import { json, upstreamError } from "../../../lib/server/json.js";

export const prerender = false;

export async function GET() {
  try {
    return json(await getLeads(), { maxAge: LEADS_TTL });
  } catch (err) {
    return upstreamError(err);
  }
}
