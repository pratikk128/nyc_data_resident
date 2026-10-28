/*
 * Refreshes src/data/payroll-by-year.json from NYC Open Data.
 *
 *   npm run data:payroll
 *
 * Source: "Citywide Payroll Data (Fiscal Year)", dataset k397-673e.
 * The dataset has millions of rows (one per employee per fiscal year), so
 * we never download rows: Socrata aggregates by fiscal year server-side and
 * we save the ~dozen resulting rows as a small JSON snapshot that the site
 * reads at build time. The data updates about once a year.
 *
 * Optional: set SOCRATA_APP_TOKEN to avoid anonymous rate limits.
 */
import { writeFile, mkdir } from "node:fs/promises";

const DATASET_ID = "k397-673e";
const DOMAIN = "https://data.cityofnewyork.us";
const RESOURCE = `${DOMAIN}/resource/${DATASET_ID}.json`;
const METADATA = `${DOMAIN}/api/views/${DATASET_ID}.json`;
const DATASET_PAGE = `${DOMAIN}/City-Government/Citywide-Payroll-Data-Fiscal-Year-/${DATASET_ID}`;
const OUT_FILE = new URL("../src/data/payroll-by-year.json", import.meta.url);

// Negative values (refunds, retro adjustments) are kept in the sums on purpose.
const QUERY = {
  $select: "fiscal_year, count(*) AS employees, sum(regular_gross_paid) AS regular, " +
    "sum(total_ot_paid) AS overtime, sum(total_other_pay) AS other",
  $group: "fiscal_year",
  $order: "fiscal_year",
  $limit: "1000"
};

// Sanity-check thresholds
const MIN_PLAUSIBLE_TOTAL = 5e9;    // NYC payroll is tens of billions a year
const MAX_PLAUSIBLE_TOTAL = 100e9;
const PARTIAL_YEAR_RATIO = 0.85;    // latest year vs. median of the 3 before it

async function getJSON(url) {
  const headers = { Accept: "application/json" };
  if (process.env.SOCRATA_APP_TOKEN) headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}\n${await res.text()}`);
  return res.json();
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function checkYears(years) {
  const warnings = [];

  for (const y of years) {
    if (y.total < MIN_PLAUSIBLE_TOTAL || y.total > MAX_PLAUSIBLE_TOTAL) {
      warnings.push(`FY${y.fiscalYear} total ($${(y.total / 1e9).toFixed(1)}B) is outside the plausible range.`);
    }
  }

  for (let i = 1; i < years.length; i++) {
    if (years[i].fiscalYear !== years[i - 1].fiscalYear + 1) {
      warnings.push(`No data between FY${years[i - 1].fiscalYear} and FY${years[i].fiscalYear}.`);
    }
  }

  let latestYearLooksComplete = true;
  if (years.length >= 4) {
    const latest = years[years.length - 1];
    const prior = years.slice(-4, -1);
    const peopleRatio = latest.peoplePaid / median(prior.map((y) => y.peoplePaid));
    const totalRatio = latest.total / median(prior.map((y) => y.total));
    if (peopleRatio < PARTIAL_YEAR_RATIO || totalRatio < PARTIAL_YEAR_RATIO) {
      latestYearLooksComplete = false;
      warnings.push(
        `FY${latest.fiscalYear} may be a partial load: people paid is ${Math.round(peopleRatio * 100)}% ` +
        `and total pay ${Math.round(totalRatio * 100)}% of the prior 3-year median.`
      );
    }
  }

  return { latestYearLooksComplete, warnings };
}

async function main() {
  const url = `${RESOURCE}?${new URLSearchParams(QUERY)}`;
  console.log(`Querying ${url}`);
  const [rows, meta] = await Promise.all([getJSON(url), getJSON(METADATA)]);

  const years = rows
    .filter((r) => r.fiscal_year != null)
    .map((r) => {
      const regular = Math.round(Number(r.regular) || 0);
      const overtime = Math.round(Number(r.overtime) || 0);
      const other = Math.round(Number(r.other) || 0);
      return {
        fiscalYear: Number(r.fiscal_year),
        peoplePaid: Number(r.employees),
        regular,
        overtime,
        other,
        total: regular + overtime + other
      };
    })
    .sort((a, b) => a.fiscalYear - b.fiscalYear);

  if (years.length === 0) throw new Error("Query returned no fiscal years; not overwriting the snapshot.");

  const checks = checkYears(years);
  const snapshot = {
    dataset: {
      id: DATASET_ID,
      name: meta.name,
      url: DATASET_PAGE,
      sourceUpdatedAt: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null
    },
    refreshedAt: new Date().toLocaleDateString("en-CA"), // local YYYY-MM-DD
    query: Object.fromEntries(Object.entries(QUERY).filter(([k]) => k !== "$limit")),
    checks,
    years
  };

  await mkdir(new URL(".", OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(snapshot, null, 2) + "\n");

  console.log(`\nWrote ${years.length} fiscal years (FY${years[0].fiscalYear}–FY${years[years.length - 1].fiscalYear}) to src/data/payroll-by-year.json\n`);
  for (const y of years) {
    console.log(`  FY${y.fiscalYear}  $${(y.total / 1e9).toFixed(2)}B  ${y.peoplePaid.toLocaleString("en-US")} people paid`);
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
