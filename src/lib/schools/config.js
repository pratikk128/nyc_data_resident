/*
 * NYC School Quality Explorer: datasets, school types, years and the DOE's
 * target rating bands, shared by the server, the pages, the scripts and the
 * tests. The curated metrics live in metrics.js.
 *
 * "School Quality Reports Data" (dnpx-dfnc) is long: one row per school ×
 * school year × metric. A school can have more than one report (a 6–12
 * school gets an elementary/middle report and a high school report), each
 * with its own report_type.
 */

export const DATASET_ID = "dnpx-dfnc";
export const DATASET_NAME = "School Quality Reports Data";
export const DATASET_URL = `https://data.cityofnewyork.us/d/${DATASET_ID}`;

// Address snapshot (scripts/refresh-school-locations.mjs → src/data/school-locations.json)
export const LOCATION_SOURCES = {
  "wg9x-4ke6": { name: "2019 - 2020 School Locations", url: "https://data.cityofnewyork.us/d/wg9x-4ke6" },
  "ji82-xba5": { name: "Facilities Database", url: "https://data.cityofnewyork.us/d/ji82-xba5" }
};

export const LINKS = {
  sqrHome: "https://infohub.nyced.org/reports/students-and-schools/school-quality/school-quality-reports-and-resources",
  educatorGuide: "https://infohub.nyced.org/reports/students-and-schools/school-quality/school-quality-reports-and-resources/educator-guide-to-school-quality-guide",
  schoolsSearch: "https://schoolsearch.schools.nyc/",
  nysedTests: "https://www.nysed.gov/state-assessment"
};

export const BASE_PATH = "/school-quality/";
export const schoolPath = (dbn) => `${BASE_PATH}${encodeURIComponent(dbn)}/`;

export const PAGE_SIZE = 24;
export const MAX_QUERY_LENGTH = 80;

// The report types in the data, with what to call each one (label starts a
// heading; noun goes mid-sentence, keeping proper names capitalized).
export const REPORTS = {
  EMS: { label: "Elementary and middle school", noun: "elementary and middle school", plural: "elementary and middle schools" },
  HS: { label: "High school", noun: "high school", plural: "high schools" },
  HST: { label: "Transfer high school", noun: "transfer high school", plural: "transfer high schools" },
  EC: { label: "Early childhood", noun: "early childhood", plural: "early childhood schools" },
  D75: { label: "District 75", noun: "District 75", plural: "District 75 schools" },
  YABC: { label: "Young Adult Borough Center", noun: "Young Adult Borough Center", plural: "Young Adult Borough Centers" }
};
// When a school has several reports, its card shows the first of these.
export const REPORT_ORDER = ["HS", "EMS", "HST", "EC", "D75", "YABC"];

// School type filter. Each is a report_type, narrowed by school_type for the
// elementary/middle report (its school_type is Elementary, Middle or K-8).
// Early childhood school_type is the grade span (K-1, K-2, K-3).
export const TYPES = [
  { slug: "elementary", label: "Elementary", plural: "elementary schools", report: "EMS", schoolType: "Elementary", tone: "yellow" },
  { slug: "k-8", label: "K–8", plural: "K–8 schools", report: "EMS", schoolType: "K-8", tone: "lime" },
  { slug: "middle", label: "Middle", plural: "middle schools", report: "EMS", schoolType: "Middle", tone: "green" },
  { slug: "high-school", label: "High school", plural: "high schools", report: "HS", tone: "blue" },
  { slug: "transfer", label: "Transfer high school", plural: "transfer high schools", report: "HST", tone: "teal" },
  { slug: "early-childhood", label: "Early childhood (K–3)", plural: "early childhood schools", report: "EC", tone: "pink" },
  { slug: "d75", label: "District 75 (special education)", plural: "District 75 schools", report: "D75", tone: "purple" },
  { slug: "yabc", label: "Young Adult Borough Center", plural: "Young Adult Borough Centers", report: "YABC", tone: "orange" }
];
export const TYPE_BY_SLUG = Object.fromEntries(TYPES.map((t) => [t.slug, t]));

export function typeSlug(report, schoolType) {
  if (report === "EMS") return TYPES.find((t) => t.report === "EMS" && t.schoolType === schoolType)?.slug ?? "elementary";
  return TYPES.find((t) => t.report === report)?.slug ?? null;
}

// "02M475", "2m475", "2M5" → "02M475", "02M475", "02M005"; null if it isn't a full DBN.
export const normalizeDbn = (value) => {
  const m = /^(\d{1,2})([MXKQR])(\d{1,3})$/.exec(String(value ?? "").trim().toUpperCase());
  return m ? `${m[1].padStart(2, "0")}${m[2]}${m[3].padStart(3, "0")}` : null;
};

// The DBN's third character is the borough: 02M475 → Manhattan.
const BOROUGH_LETTERS = { M: "Manhattan", X: "Bronx", K: "Brooklyn", Q: "Queens", R: "Staten Island" };
export const BOROUGHS = [
  { slug: "manhattan", label: "Manhattan", bullet: "M" },
  { slug: "brooklyn", label: "Brooklyn", bullet: "Bk" },
  { slug: "queens", label: "Queens", bullet: "Q" },
  { slug: "bronx", label: "Bronx", bullet: "Bx" },
  { slug: "staten-island", label: "Staten Island", bullet: "SI" }
];
export const boroughFromDbn = (dbn) => BOROUGH_LETTERS[String(dbn ?? "").charAt(2).toUpperCase()] ?? null;

// The first two characters: a geographic district (1–32), or 75 (special
// education), 79 (alternative schools) or 84 (charter schools).
export function districtFromDbn(dbn) {
  const d = Number(String(dbn ?? "").slice(0, 2));
  if (!Number.isFinite(d) || d === 0) return null;
  if (d === 84) return { code: d, label: "Charter school" };
  if (d === 79) return { code: d, label: "District 79 (alternative schools)" };
  if (d === 75) return { code: d, label: "District 75 (citywide special education)" };
  return { code: d, label: `District ${d}` };
}

// school_year is the fall the school year started: 2024 → "2024–25".
export const yearLabel = (y) => `${y}–${String(Number(y) + 1).slice(-2)}`;

// Why a year can be missing from a chart. Tests weren't given (or reported)
// in the two COVID-19 school years; everything else just says it wasn't reported.
export const GAP_REASONS = {
  2019: "Schools closed in March 2020 for COVID-19, and New York cancelled that spring’s state tests.",
  2020: "State tests were optional in spring 2021, so the city didn’t report results."
};

/*
 * Each metric DOE rates on a report gets a score from 1.00 to 4.99
 * (metric_score), comparing the school with targets set from similar
 * schools. The bands are DOE's (School Quality Guide educator guide).
 */
export const TARGET_BANDS = [
  { min: 4, label: "Exceeding target", short: "Exceeding", tone: "green" },
  { min: 3, label: "Meeting target", short: "Meeting", tone: "blue" },
  { min: 2, label: "Approaching target", short: "Approaching", tone: "yellow" },
  { min: 1, label: "Not meeting target", short: "Not meeting", tone: "orange" }
];
