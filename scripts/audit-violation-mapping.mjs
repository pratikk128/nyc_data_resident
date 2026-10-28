/*
 * Checks the restaurant leads mapping (src/lib/restaurants/business-groups.js)
 * against the data: prints every critical violation code cited in the last
 * 24 months with its count and business group(s), then lists any code that's
 * in neither a group nor IGNORED_CODES. Exits 1 when something is unmapped.
 *
 *   npm run audit:violations
 *
 * Source: DOHMH New York City Restaurant Inspection Results, dataset 43nn-pn8j.
 * Optional: set SOCRATA_APP_TOKEN to avoid anonymous rate limits.
 */
import {
  BUSINESS_GROUPS, IGNORED_CODES, LEADS_CONFIG, MAPPED_CODES, groupsFor
} from "../src/lib/restaurants/business-groups.js";
import { NOT_INSPECTED_DATE } from "../src/lib/restaurants/inspections.js";

const RESOURCE = "https://data.cityofnewyork.us/resource/43nn-pn8j.json";
const MONTHS = 24;

async function soql(params) {
  const url = new URL(RESOURCE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Accept: "application/json" };
  if (process.env.SOCRATA_APP_TOKEN) headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`NYC Open Data returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  const [{ latest }] = await soql({ $select: "max(inspection_date) AS latest" });
  const since = new Date(latest.slice(0, 10) + "T00:00:00Z");
  since.setUTCMonth(since.getUTCMonth() - MONTHS);
  const sinceDay = since.toISOString().slice(0, 10);

  // One row per code: the most common spelling of its description, and the total.
  const rows = await soql({
    $select: "trim(violation_code) AS code, violation_description AS description, count(*) AS n",
    $where: `critical_flag = 'Critical' AND violation_code IS NOT NULL ` +
      `AND inspection_date >= '${sinceDay}T00:00:00' AND inspection_date > '${NOT_INSPECTED_DATE}T00:00:00'`,
    $group: "code, description",
    $limit: "5000"
  });
  const codes = new Map();
  for (const r of rows) {
    const c = codes.get(r.code) ?? { code: r.code, n: 0, description: "", top: 0 };
    c.n += Number(r.n);
    if (Number(r.n) > c.top) { c.top = Number(r.n); c.description = r.description.replace(/\s+/g, " ").trim(); }
    codes.set(r.code, c);
  }
  const seen = [...codes.values()].sort((a, b) => a.code.localeCompare(b.code));
  const label = (id) => BUSINESS_GROUPS.find((g) => g.id === id).label;

  console.log(`Critical violation codes, ${sinceDay} to ${latest.slice(0, 10)} (${seen.length} codes)\n`);
  console.log(["Code", "Rows", "Group(s)", "Description"].join("\t"));
  for (const c of seen) {
    const groups = groupsFor(c.code);
    const where = groups.length ? groups.map(label).join(" + ")
      : IGNORED_CODES[c.code] ? `(ignored: ${IGNORED_CODES[c.code]})` : "UNMAPPED";
    console.log([c.code, c.n, where, c.description.slice(0, 90)].join("\t"));
  }

  const unmapped = seen.filter((c) => !groupsFor(c.code).length && !IGNORED_CODES[c.code]);
  const unseen = MAPPED_CODES.filter((code) => !codes.has(code) && !LEADS_CONFIG.includeNonCriticalCodes.includes(code));
  const loose = LEADS_CONFIG.includeNonCriticalCodes.filter((code) => !groupsFor(code).length);

  console.log("\nCodes and critical rows per group (a code in two groups counts in both):");
  for (const g of BUSINESS_GROUPS) {
    const n = g.codes.reduce((sum, code) => sum + (codes.get(code)?.n ?? 0), 0);
    console.log(`  ${g.label}: ${g.codes.length} codes, ${n} critical rows`);
  }
  console.log(`\nUnmapped critical codes: ${unmapped.length ? unmapped.map((c) => c.code).join(", ") : "none"}`);
  if (unseen.length) console.log(`Mapped but not cited as critical in the window: ${unseen.join(", ")}`);
  if (loose.length) console.log(`In includeNonCriticalCodes but in no group (they won't show up): ${loose.join(", ")}`);
  if (unmapped.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
