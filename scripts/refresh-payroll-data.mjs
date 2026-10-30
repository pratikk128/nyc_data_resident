/*
 * Refreshes the bundled copy of the City Payroll Spending data:
 * src/data/payroll-by-year.json (citywide, with NYC-area CPI),
 * src/data/payroll-by-agency.json (same totals split by agency),
 * src/data/payroll-jobs.json (median pay by job title) and
 * src/data/payroll-overtime.json (who earns the overtime), from NYC Open Data
 * and the Bureau of Labor Statistics.
 *
 *   npm run data:payroll
 *
 * The site doesn't need this to stay current: the hourly cron rebuilds the
 * same data into KV when the source changes (src/lib/server/payroll.js). The
 * pages fall back to these files only while KV is empty (local dev, or a new
 * deployment before its first cron run), and the script is handy for
 * reviewing a change as a diff. The queries and checks are in
 * src/lib/payroll/build.js.
 *
 * Optional: set SOCRATA_APP_TOKEN to avoid anonymous rate limits.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { buildPayroll, DATASET_ID, SPOT_CHECK_TITLES } from "../src/lib/payroll/build.js";

const DOMAIN = "https://data.cityofnewyork.us";
const RESOURCE = `${DOMAIN}/resource/${DATASET_ID}.json`;
const METADATA = `${DOMAIN}/api/views/${DATASET_ID}.json`;
const OUT_FILE = new URL("../src/data/payroll-by-year.json", import.meta.url);
const AGENCY_OUT_FILE = new URL("../src/data/payroll-by-agency.json", import.meta.url);
const JOBS_OUT_FILE = new URL("../src/data/payroll-jobs.json", import.meta.url);
const OVERTIME_OUT_FILE = new URL("../src/data/payroll-overtime.json", import.meta.url);

async function getJSON(url) {
  const headers = { Accept: "application/json" };
  if (process.env.SOCRATA_APP_TOKEN) headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}\n${await res.text()}`);
  return res.json();
}

function query(params) {
  const url = `${RESOURCE}?${new URLSearchParams(params)}`;
  console.log(`Querying ${url}`);
  return getJSON(url);
}

// One line per agency or title keeps the files reviewable in diffs without bloating them.
const lines = (items) => `[\n${items.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`;

async function main() {
  const meta = await getJSON(METADATA);
  const source = {
    name: meta.name,
    rowsUpdatedAt: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null
  };
  console.log("(the job title medians are slow; allow a couple of minutes)");
  const { byYear, byAgency, jobs, overtime } = await buildPayroll(query, source, new Date().toLocaleDateString("en-CA")); // local YYYY-MM-DD

  await mkdir(new URL(".", OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(byYear, null, 2) + "\n");
  await writeFile(
    AGENCY_OUT_FILE,
    `{\n  "refreshedAt": ${JSON.stringify(byAgency.refreshedAt)},\n  "query": ${JSON.stringify(byAgency.query)},\n` +
    `  "agencies": ${lines(byAgency.agencies)}\n}\n`
  );
  await writeFile(
    JOBS_OUT_FILE,
    `{\n  "refreshedAt": ${JSON.stringify(jobs.refreshedAt)},\n  "query": ${JSON.stringify(jobs.query)},\n` +
    `  "headcountQuery": ${JSON.stringify(jobs.headcountQuery)},\n` +
    `  "latestFiscalYear": ${jobs.latestFiscalYear},\n  "compareFiscalYear": ${jobs.compareFiscalYear},\n  "minEmployees": ${jobs.minEmployees},\n` +
    `  "checks": ${JSON.stringify(jobs.checks)},\n` +
    `  "chips": ${lines(jobs.chips)},\n` +
    `  "jobs": ${lines(jobs.jobs)}\n}\n`
  );
  await writeFile(
    OVERTIME_OUT_FILE,
    `{\n  "refreshedAt": ${JSON.stringify(overtime.refreshedAt)},\n  "query": ${JSON.stringify(overtime.query)},\n` +
    `  "topQuery": ${JSON.stringify(overtime.topQuery)},\n  "highThreshold": ${overtime.highThreshold},\n` +
    `  "years": ${lines(overtime.years)},\n` +
    `  "topByTitle": ${lines(overtime.topByTitle)}\n}\n`
  );

  const { years, checks } = byYear;
  console.log(`\nWrote ${years.length} fiscal years (FY${years[0].fiscalYear}–FY${years[years.length - 1].fiscalYear}) to src/data/payroll-by-year.json\n`);
  for (const y of years) {
    console.log(
      `  FY${y.fiscalYear}  $${(y.total / 1e9).toFixed(2)}B  ${y.peoplePaid.toLocaleString("en-US")} people paid, ` +
      `${y.activeJune30.toLocaleString("en-US")} active on June 30`
    );
  }
  const { cpi } = byYear;
  console.log(`\nNYC-area CPI (${cpi.series}), fiscal-year averages:`);
  for (const [fy, index] of Object.entries(cpi.index)) console.log(`  FY${fy}  ${index}`);
  console.log(`\nWrote ${overtime.years.length} years of overtime spread to src/data/payroll-overtime.json`);
  for (const t of overtime.topByTitle) {
    console.log(`  ${t.label} (${t.agency}): $${t.overtime.toLocaleString("en-US")} overtime, ${t.overtimeHours} hours`);
  }
  console.log(`\nWrote ${byAgency.agencies.length} agencies to src/data/payroll-by-agency.json`);
  console.log(`\nWrote ${jobs.jobs.length} job titles (FY${jobs.latestFiscalYear}, ${jobs.minEmployees}+ full-year employees) to src/data/payroll-jobs.json`);
  for (const title of SPOT_CHECK_TITLES) {
    const j = jobs.jobs.find((x) => x.title === title);
    if (j) console.log(`  ${j.label}: median base $${j.base.toLocaleString("en-US")}, median OT & other $${j.extra.toLocaleString("en-US")}`);
  }

  if (checks.warnings.length) {
    console.warn("\nHeads up:");
    for (const w of checks.warnings) console.warn(`  - ${w}`);
  } else {
    console.log("\nSanity checks passed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
