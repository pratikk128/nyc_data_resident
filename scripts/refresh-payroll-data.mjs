/*
 * Refreshes src/data/payroll-by-year.json (citywide),
 * src/data/payroll-by-agency.json (same totals split by agency) and
 * src/data/payroll-jobs.json (median pay by job title) from NYC Open Data.
 *
 *   npm run data:payroll
 *
 * Source: "Citywide Payroll Data (Fiscal Year)", dataset k397-673e.
 * The dataset has millions of rows (one per employee per fiscal year), so
 * we never download rows: Socrata aggregates by fiscal year server-side and
 * we save the ~dozen resulting rows as a small JSON snapshot that the site
 * reads at build time. The data updates about once a year. Job title medians
 * are computed server-side too, with SoQL median().
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
const AGENCY_OUT_FILE = new URL("../src/data/payroll-by-agency.json", import.meta.url);
const JOBS_OUT_FILE = new URL("../src/data/payroll-jobs.json", import.meta.url);

// Negative values (refunds, retro adjustments) are kept in the sums on purpose.
const QUERY = {
  $select: "fiscal_year, count(*) AS employees, sum(regular_gross_paid) AS regular, " +
    "sum(total_ot_paid) AS overtime, sum(total_other_pay) AS other",
  $group: "fiscal_year",
  $order: "fiscal_year",
  $limit: "1000"
};

const AGENCY_QUERY = {
  ...QUERY,
  $select: `agency_name, ${QUERY.$select}`,
  $group: "agency_name, fiscal_year",
  $order: "agency_name, fiscal_year",
  $limit: "50000"
};

// "What do city jobs actually pay?": full-time annual salaries of active
// employees, one row per (fiscal year, job title). Exact values checked
// against the data by checkFilterValues() before each run.
const PAY_BASIS = "per Annum";
const LEAVE_STATUS = "ACTIVE";
const MIN_EMPLOYEES = 25;  // titles smaller than this in the latest year are left out
const CHANGE_YEARS = 5;    // "5-yr change in median base salary"

const JOBS_QUERY = {
  $select: "fiscal_year, upper(trim(title_description)) AS title, count(*) AS employees, " +
    "median(base_salary) AS median_base, " +
    "median(coalesce(regular_gross_paid, 0) + coalesce(total_ot_paid, 0) + coalesce(total_other_pay, 0)) AS median_total",
  $where: `pay_basis = '${PAY_BASIS}' AND leave_status_as_of_june_30 = '${LEAVE_STATUS}' ` +
    "AND base_salary > 0 AND title_description IS NOT NULL",
  $group: "fiscal_year, title",
  $order: "fiscal_year, title",
  $limit: "100000"
};

// Quick-filter chips → exact (normalized) title_description values. A chip
// with no matching title in the latest year is dropped from the snapshot.
// There is no bus operator title: MTA bus operators aren't on city payroll.
const JOB_CHIPS = [
  { id: "teacher", label: "Teacher", titles: ["TEACHER", "TEACHER SPECIAL EDUCATION"] },
  { id: "firefighter", label: "Firefighter", titles: ["FIREFIGHTER"] },
  { id: "police-officer", label: "Police Officer", titles: ["POLICE OFFICER"] },
  { id: "sanitation-worker", label: "Sanitation Worker", titles: ["SANITATION WORKER"] },
  { id: "correction-officer", label: "Correction Officer", titles: ["CORRECTION OFFICER"] },
  { id: "staff-nurse", label: "Staff Nurse", titles: ["STAFF NURSE", "STAFF NURSE ASSIGNMENT LEVEL 3"] },
  { id: "emt", label: "EMT", titles: ["EMERGENCY MEDICAL SPECIALIST-EMT"] },
  { id: "traffic-enforcement-agent", label: "Traffic Enforcement Agent", titles: ["TRAFFIC ENFORCEMENT AGENT"] },
  { id: "motor-vehicle-operator", label: "Bus Operator / Motor Vehicle Operator", titles: ["BUS OPERATOR", "MOTOR VEHICLE OPERATOR"] },
  { id: "caseworker", label: "Caseworker", titles: ["CASEWORKER"] },
  { id: "city-planner", label: "City Planner", titles: ["CITY PLANNER"] },
  { id: "civil-engineer", label: "Civil Engineer", titles: ["CIVIL ENGINEER", "ASSISTANT CIVIL ENGINEER"] }
];

// Medians a sane person would expect for a few well-known titles
const PLAUSIBLE_MEDIAN_BASE = { TEACHER: [50e3, 200e3], FIREFIGHTER: [50e3, 200e3], "POLICE OFFICER": [50e3, 200e3] };

// FY2014 spells a few agencies differently; fold them into the later name.
const AGENCY_ALIASES = {
  "Police Department": "POLICE DEPARTMENT",
  "Bronx DA": "BRONX DISTRICT ATTORNEY",
  "Kings DA": "DISTRICT ATTORNEY KINGS COUNTY",
  "Manhattan DA": "DISTRICT ATTORNEY-MANHATTAN",
  "Queens DA": "DISTRICT ATTORNEY QNS COUNTY",
  "Richmond DA": "DISTRICT ATTORNEY RICHMOND COU",
  "Spec Narcs-DA": "DISTRICT ATTORNEY-SPECIAL NARC",
  "BOARD OF CORRECTIONS": "BOARD OF CORRECTION"
};

// Readable names for source names that are truncated or cryptic. Anything
// not listed here is title-cased by agencyLabel().
const AGENCY_LABELS = {
  "ADMIN FOR CHILDREN'S SVCS": "Administration for Children's Services",
  "ADMIN TRIALS AND HEARINGS": "Office of Administrative Trials and Hearings",
  "BOARD OF ELECTION": "Board of Elections",
  "BOARD OF ELECTION POLL WORKERS": "Board of Elections (poll workers)",
  "CIVILIAN COMPLAINT REVIEW BD": "Civilian Complaint Review Board",
  "COMMUNITY COLLEGE (LAGUARDIA)": "Community College (LaGuardia)",
  "DEPARTMENT OF BUSINESS SERV.": "Department of Small Business Services",
  "DEPARTMENT OF EDUCATION ADMIN": "Dept. of Education (administration)",
  "DEPT OF CITYWIDE ADMIN SVCS": "Dept. of Citywide Administrative Services",
  "DEPT. OF DESIGN & CONSTRUCTION": "Dept. of Design and Construction",
  "DEPT OF ED HRLY SUPPORT STAFF": "Dept. of Education (hourly support staff)",
  "DEPT OF ED PARA PROFESSIONALS": "Dept. of Education (paraprofessionals)",
  "DEPT OF ED PEDAGOGICAL": "Dept. of Education (teachers and pedagogical staff)",
  "DEPT OF ED PER DIEM TEACHERS": "Dept. of Education (per diem teachers)",
  "DEPT OF ED PER SESSION TEACHER": "Dept. of Education (per session teachers)",
  "DEPT OF ENVIRONMENT PROTECTION": "Dept. of Environmental Protection",
  "DEPT OF HEALTH/MENTAL HYGIENE": "Dept. of Health and Mental Hygiene",
  "DEPT. OF HOMELESS SERVICES": "Dept. of Homeless Services",
  "DEPT OF INFO TECH & TELECOMM": "Dept. of Information Technology and Telecommunications",
  "DEPT OF PARKS & RECREATION": "Dept. of Parks and Recreation",
  "DEPT OF RECORDS & INFO SERVICE": "Dept. of Records and Information Services",
  "DEPT OF YOUTH & COMM DEV SRVS": "Dept. of Youth and Community Development",
  "DISTRICT ATTORNEY KINGS COUNTY": "District Attorney, Brooklyn",
  "DISTRICT ATTORNEY-MANHATTAN": "District Attorney, Manhattan",
  "DISTRICT ATTORNEY QNS COUNTY": "District Attorney, Queens",
  "DISTRICT ATTORNEY RICHMOND COU": "District Attorney, Staten Island",
  "DISTRICT ATTORNEY-SPECIAL NARC": "Special Narcotics Prosecutor",
  "BRONX DISTRICT ATTORNEY": "District Attorney, Bronx",
  "DOE CUSTODIAL PAYROL": "Dept. of Education (custodial payroll)",
  "EQUAL EMPLOY PRACTICES COMM": "Equal Employment Practices Commission",
  "FINANCIAL INFO SVCS AGENCY": "Financial Information Services Agency",
  "HOUSING PRESERVATION & DVLPMNT": "Dept. of Housing Preservation and Development",
  "HRA/DEPT OF SOCIAL SERVICES": "HRA / Dept. of Social Services",
  "LANDMARKS PRESERVATION COMM": "Landmarks Preservation Commission",
  "MAYORS OFFICE OF CONTRACT SVCS": "Mayor's Office of Contract Services",
  "MUNICIPAL WATER FIN AUTHORITY": "Municipal Water Finance Authority",
  "NYC DEPT OF VETERANS' SERVICES": "Dept. of Veterans' Services",
  "NYC EMPLOYEES RETIREMENT SYS": "NYC Employees' Retirement System",
  "OFFICE OF COLLECTIVE BARGAININ": "Office of Collective Bargaining",
  "OFF OF PAYROLL ADMINISTRATION": "Office of Payroll Administration",
  "PRESIDENT BOROUGH OF MANHATTAN": "Borough President, Manhattan",
  "BOROUGH PRESIDENT-STATEN IS": "Borough President, Staten Island",
  "STATEN ISLAND COMMUNITY BD #1": "Staten Island Community Board #1",
  "STATEN ISLAND COMMUNITY BD #2": "Staten Island Community Board #2",
  "STATEN ISLAND COMMUNITY BD #3": "Staten Island Community Board #3",
  "TAXI & LIMOUSINE COMMISSION": "Taxi and Limousine Commission",
  "TECHNOLOGY & INNOVATION": "Office of Technology and Innovation"
};

const UPPER_WORDS = new Set(["NYC", "CUNY", "HRA", "DA"]);
const LOWER_WORDS = new Set(["of", "and", "for", "the", "on"]);

function agencyLabel(name) {
  if (AGENCY_LABELS[name]) return AGENCY_LABELS[name];
  return name
    .toLowerCase()
    .replace(/[a-z][a-z'.]*/g, (w, i) => {
      if (UPPER_WORDS.has(w.toUpperCase())) return w.toUpperCase();
      if (i > 0 && LOWER_WORDS.has(w)) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .replace(/-/g, ", ")
    .replace(/ & /g, " and ");
}

function slugify(name) {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const TITLE_UPPER_WORDS = new Set(["NYC", "EMT", "EMS", "IT", "HRA", "DOE", "CUNY", "HVAC", "MIS", "EEO", "DA", "ACS", "DOT", "OT", "II", "III", "IV", "VI"]);
const TITLE_LOWER_WORDS = new Set(["of", "and", "for", "the", "to", "in", "on", "a", "at"]);

// "EMERGENCY MEDICAL SPECIALIST-EMT" → "Emergency Medical Specialist-EMT".
// Stray markers in the source ("*COOK", "PROJECT MANAGER INTERN#") are dropped.
function titleLabel(title) {
  return title
    .replace(/^[^A-Z0-9]+|[^A-Z0-9.)]+$/g, "")
    .toLowerCase()
    .replace(/[a-z0-9][a-z0-9'.]*/g, (w, i) => {
      if (TITLE_UPPER_WORDS.has(w.toUpperCase())) return w.toUpperCase();
      if (i > 0 && TITLE_LOWER_WORDS.has(w)) return w;
      return w[0].toUpperCase() + w.slice(1);
    });
}

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

function toYear(r) {
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
}

// Groups agency rows by (aliased) agency and merges any years that now collide.
function buildAgencies(rows) {
  const byName = new Map();
  for (const r of rows) {
    if (r.fiscal_year == null || !r.agency_name) continue;
    const name = AGENCY_ALIASES[r.agency_name] ?? r.agency_name;
    if (!byName.has(name)) byName.set(name, new Map());
    const years = byName.get(name);
    const y = toYear(r);
    const prev = years.get(y.fiscalYear);
    if (prev) for (const k of ["peoplePaid", "regular", "overtime", "other", "total"]) prev[k] += y[k];
    else years.set(y.fiscalYear, y);
  }

  const agencies = [...byName].map(([name, years]) => ({
    id: slugify(name),
    name,
    label: agencyLabel(name),
    years: [...years.values()].sort((a, b) => a.fiscalYear - b.fiscalYear)
  }));
  agencies.sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })); // Board #2 before #10

  const ids = new Set();
  for (const a of agencies) {
    if (ids.has(a.id)) throw new Error(`Two agencies share the id "${a.id}"; adjust slugify().`);
    ids.add(a.id);
  }
  return agencies;
}

// Fails fast if the source renames the pay basis or leave status values we filter on.
async function checkFilterValues() {
  const distinct = async (field) => {
    const url = `${RESOURCE}?${new URLSearchParams({ $select: field, $group: field, $limit: "100" })}`;
    return (await getJSON(url)).map((r) => r[field]);
  };
  const [bases, statuses] = await Promise.all([distinct("pay_basis"), distinct("leave_status_as_of_june_30")]);
  if (!bases.includes(PAY_BASIS)) throw new Error(`pay_basis has no "${PAY_BASIS}" (found: ${bases.join(", ")}).`);
  if (!statuses.includes(LEAVE_STATUS)) {
    throw new Error(`leave_status_as_of_june_30 has no "${LEAVE_STATUS}" (found: ${statuses.join(", ")}).`);
  }
}

// One entry per title with >= MIN_EMPLOYEES in the latest year: latest-year
// medians, the change since CHANGE_YEARS earlier, and every year's median base.
function buildJobs(rows) {
  const byTitle = new Map();
  for (const r of rows) {
    if (!r.title || r.fiscal_year == null) continue;
    if (!byTitle.has(r.title)) byTitle.set(r.title, []);
    byTitle.get(r.title).push({
      fiscalYear: Number(r.fiscal_year),
      employees: Number(r.employees),
      base: Math.round(Number(r.median_base)),
      total: Math.round(Number(r.median_total))
    });
  }

  const latestFY = Math.max(...rows.map((r) => Number(r.fiscal_year)));
  const compareFY = latestFY - CHANGE_YEARS;
  const jobs = [];
  for (const [title, years] of byTitle) {
    years.sort((a, b) => a.fiscalYear - b.fiscalYear);
    const latest = years.find((y) => y.fiscalYear === latestFY);
    if (!latest || latest.employees < MIN_EMPLOYEES) continue;
    const then = years.find((y) => y.fiscalYear === compareFY);
    jobs.push({
      title,
      label: titleLabel(title),
      employees: latest.employees,
      base: latest.base,
      total: latest.total,
      extra: latest.total - latest.base,
      change: then && then.employees >= MIN_EMPLOYEES ? Number((latest.base / then.base - 1).toFixed(4)) : null,
      // [fiscal year, median base salary, employees]
      series: years.map((y) => [y.fiscalYear, y.base, y.employees])
    });
  }
  jobs.sort((a, b) => b.employees - a.employees || a.label.localeCompare(b.label));

  const titles = new Set(jobs.map((j) => j.title));
  const chips = JOB_CHIPS
    .map((c) => ({ ...c, titles: c.titles.filter((t) => titles.has(t)) }))
    .filter((c) => c.titles.length);

  const warnings = [];
  for (const c of JOB_CHIPS) {
    const missing = c.titles.filter((t) => !titles.has(t));
    if (missing.length === c.titles.length) warnings.push(`Chip "${c.label}" matched no titles; it is hidden.`);
  }
  for (const [title, [lo, hi]] of Object.entries(PLAUSIBLE_MEDIAN_BASE)) {
    const job = jobs.find((j) => j.title === title);
    if (!job) warnings.push(`No "${title}" title in FY${latestFY}.`);
    else if (job.base < lo || job.base > hi) warnings.push(`${title} median base salary ($${job.base}) looks implausible.`);
  }
  if (jobs.some((j) => j.employees < MIN_EMPLOYEES)) throw new Error("A title with too few employees slipped through.");

  return { latestFY, compareFY, jobs, chips, warnings };
}

async function main() {
  const url = `${RESOURCE}?${new URLSearchParams(QUERY)}`;
  const agencyUrl = `${RESOURCE}?${new URLSearchParams(AGENCY_QUERY)}`;
  const jobsUrl = `${RESOURCE}?${new URLSearchParams(JOBS_QUERY)}`;
  await checkFilterValues();
  console.log(`Querying ${url}`);
  console.log(`Querying ${agencyUrl}`);
  console.log(`Querying ${jobsUrl} (medians are slow; allow a couple of minutes)`);
  const [rows, agencyRows, jobRows, meta] = await Promise.all([
    getJSON(url), getJSON(agencyUrl), getJSON(jobsUrl), getJSON(METADATA)
  ]);

  const years = rows
    .filter((r) => r.fiscal_year != null)
    .map(toYear)
    .sort((a, b) => a.fiscalYear - b.fiscalYear);

  if (years.length === 0) throw new Error("Query returned no fiscal years; not overwriting the snapshot.");

  const agencies = buildAgencies(agencyRows);
  if (agencies.length === 0) throw new Error("Agency query returned no rows; not overwriting the snapshot.");

  const checks = checkYears(years);

  const jobs = buildJobs(jobRows);
  if (jobs.jobs.length === 0) throw new Error("Job title query returned no titles; not overwriting the snapshot.");
  if (jobs.latestFY !== years[years.length - 1].fiscalYear) {
    checks.warnings.push(`Job titles end in FY${jobs.latestFY} but payroll totals end in FY${years[years.length - 1].fiscalYear}.`);
  }

  // The per-agency split should add back up to the citywide total.
  const latestFY = years[years.length - 1].fiscalYear;
  const agencySum = agencies.reduce((sum, a) => sum + (a.years.find((y) => y.fiscalYear === latestFY)?.total ?? 0), 0);
  const gap = Math.abs(agencySum - years[years.length - 1].total);
  if (gap > 1e6) checks.warnings.push(`FY${latestFY} agency totals differ from the citywide total by $${(gap / 1e6).toFixed(1)}M.`);

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

  // One line per agency keeps the file reviewable in diffs without bloating it.
  const agencyQuery = Object.fromEntries(Object.entries(AGENCY_QUERY).filter(([k]) => k !== "$limit"));
  await writeFile(
    AGENCY_OUT_FILE,
    `{\n  "refreshedAt": ${JSON.stringify(snapshot.refreshedAt)},\n  "query": ${JSON.stringify(agencyQuery)},\n` +
    `  "agencies": [\n${agencies.map((a) => `    ${JSON.stringify(a)}`).join(",\n")}\n  ]\n}\n`
  );

  // One line per title, like the agency file
  const jobsQuery = Object.fromEntries(Object.entries(JOBS_QUERY).filter(([k]) => k !== "$limit"));
  await writeFile(
    JOBS_OUT_FILE,
    `{\n  "refreshedAt": ${JSON.stringify(snapshot.refreshedAt)},\n  "query": ${JSON.stringify(jobsQuery)},\n` +
    `  "latestFiscalYear": ${jobs.latestFY},\n  "compareFiscalYear": ${jobs.compareFY},\n  "minEmployees": ${MIN_EMPLOYEES},\n` +
    `  "checks": ${JSON.stringify({ latestYearLooksComplete: checks.latestYearLooksComplete, warnings: jobs.warnings })},\n` +
    `  "chips": [\n${jobs.chips.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ],\n` +
    `  "jobs": [\n${jobs.jobs.map((j) => `    ${JSON.stringify(j)}`).join(",\n")}\n  ]\n}\n`
  );
  checks.warnings.push(...jobs.warnings);

  console.log(`\nWrote ${years.length} fiscal years (FY${years[0].fiscalYear}–FY${years[years.length - 1].fiscalYear}) to src/data/payroll-by-year.json\n`);
  for (const y of years) {
    console.log(`  FY${y.fiscalYear}  $${(y.total / 1e9).toFixed(2)}B  ${y.peoplePaid.toLocaleString("en-US")} people paid`);
  }
  console.log(`\nWrote ${agencies.length} agencies to src/data/payroll-by-agency.json`);
  console.log(`\nWrote ${jobs.jobs.length} job titles (FY${jobs.latestFY}, ${MIN_EMPLOYEES}+ employees) to src/data/payroll-jobs.json`);
  for (const title of Object.keys(PLAUSIBLE_MEDIAN_BASE)) {
    const j = jobs.jobs.find((x) => x.title === title);
    if (j) console.log(`  ${j.label}: median base $${j.base.toLocaleString("en-US")}, median total $${j.total.toLocaleString("en-US")}`);
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
