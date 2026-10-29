/*
 * GET /api/payroll/agencies
 * Every agency's payroll by fiscal year, for the City Payroll agency picker
 * (src/components/city-payroll/WorkforceSection.astro), which loads it only
 * once someone picks an agency. → { refreshedAt, agencies: [{ id, name, label, years }] }
 *
 * Reads the payroll data the cron keeps in KV (src/lib/server/payroll.js),
 * so requests don't reach Socrata and need no rate limit.
 */
import { getPayroll } from "../../../lib/server/payroll.js";
import { json } from "../../../lib/server/json.js";

export const prerender = false;

const MAX_AGE = 3600;

export async function GET() {
  const { byAgency } = await getPayroll();
  return json({ refreshedAt: byAgency.refreshedAt, agencies: byAgency.agencies }, { maxAge: MAX_AGE });
}
