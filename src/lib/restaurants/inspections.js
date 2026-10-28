/*
 * Pure logic for the restaurant inspection dashboard (dataset 43nn-pn8j),
 * shared by the server data module, the page script and the tests. Nothing in
 * here fetches.
 *
 * The data has one row per violation, not per inspection. An inspection is
 * (camis + inspection_date). camis is the restaurant id; names repeat.
 * inspection_date 1900-01-01 marks a new establishment that hasn't been
 * inspected yet: those rows carry no score, grade or violations.
 */
import { CATEGORIES, categoryFor } from "./violation-categories.js";

export const NOT_INSPECTED_DATE = "1900-01-01";

export const BOROUGHS = ["Manhattan", "Bronx", "Brooklyn", "Queens", "Staten Island"];

// "2026-10-24T00:00:00.000" → "2026-10-24"
export function day(iso) {
  return iso ? String(iso).slice(0, 10) : null;
}

export function isInspected(row) {
  const d = day(row.inspection_date);
  return Boolean(d) && d !== NOT_INSPECTED_DATE;
}

// ---------- Grades ----------

// N, Z and P are not letter grades; show them in words.
const GRADES = {
  A: { label: "Grade A", short: "A", tone: "a" },
  B: { label: "Grade B", short: "B", tone: "b" },
  C: { label: "Grade C", short: "C", tone: "c" },
  N: { label: "Not yet graded", short: null, tone: "pending" },
  Z: { label: "Grade pending", short: null, tone: "pending" },
  P: { label: "Grade pending (reopened)", short: null, tone: "pending" }
};

export function gradeInfo(grade) {
  return GRADES[String(grade ?? "").trim().toUpperCase()] ?? { label: "No grade yet", short: null, tone: "none" };
}

// Lower is better. Bands used for letter grades on graded inspections.
export const SCORE_BANDS = [
  { grade: "A", min: 0, max: 13 },
  { grade: "B", min: 14, max: 27 },
  { grade: "C", min: 28, max: Infinity }
];

export function scoreBand(score) {
  if (score == null || score === "" || Number.isNaN(Number(score))) return null;
  return SCORE_BANDS.find((b) => Number(score) <= b.max).grade;
}

// The most recent row with a grade, by grade date. grade_date is blank on
// almost every "N" (not yet graded) row; when it is filled in it always equals
// inspection_date, so the inspection date stands in for it.
// Returns { grade, date } or null.
export function latestGrade(rows) {
  let best = null;
  for (const row of rows) {
    const grade = String(row.grade ?? "").trim().toUpperCase();
    if (!grade || !isInspected(row)) continue;
    const date = day(row.grade_date) ?? day(row.inspection_date);
    if (!best || date > best.date) best = { grade, date };
  }
  return best;
}

// ---------- Inspections ----------

const CRITICAL_ORDER = { Critical: 0, "Not Critical": 1, "Not Applicable": 2 };

export function sortViolations(violations) {
  return violations.slice().sort((a, b) =>
    (CRITICAL_ORDER[a.critical] ?? 3) - (CRITICAL_ORDER[b.critical] ?? 3) || a.code.localeCompare(b.code)
  );
}

// Rows → one entry per inspection (camis + date), newest first, without the
// 1900-01-01 placeholder. A day with more than one inspection type lists them
// all; the score is the first one reported that day.
export function groupInspections(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!isInspected(row)) continue;
    const date = day(row.inspection_date);
    const key = `${row.camis}|${date}`;
    let insp = byKey.get(key);
    if (!insp) {
      insp = { camis: row.camis, date, types: [], actions: [], score: null, grade: null, violations: [] };
      byKey.set(key, insp);
    }
    if (row.inspection_type && !insp.types.includes(row.inspection_type)) insp.types.push(row.inspection_type);
    if (row.action && !insp.actions.includes(row.action)) insp.actions.push(row.action);
    if (insp.score == null && row.score != null && row.score !== "") insp.score = Number(row.score);
    if (!insp.grade && row.grade) insp.grade = row.grade.trim().toUpperCase();
    if (row.violation_code) {
      const code = row.violation_code.trim();
      // Exact duplicate rows (same code and text) are one citation.
      if (!insp.violations.some((v) => v.code === code && v.description === row.violation_description)) {
        insp.violations.push({
          code,
          description: row.violation_description ?? "",
          critical: row.critical_flag ?? "Not Applicable",
          category: categoryFor(code)
        });
      }
    }
  }
  return [...byKey.values()]
    .map((insp) => ({ ...insp, violations: sortViolations(insp.violations) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- Categories vs the mean ----------

// "YYYY-MM-DD" exactly `years` before `today` (a Date or ISO string).
export function cutoffDate(today, years) {
  const d = new Date(typeof today === "string" ? `${day(today)}T00:00:00Z` : today);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export function emptyCounts() {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
}

// Cited critical violations per category on or after `since`, from one
// restaurant's grouped inspections.
export function countByCategory(inspections, since) {
  const counts = emptyCounts();
  for (const insp of inspections) {
    if (insp.date < since) continue;
    for (const v of insp.violations) if (v.critical === "Critical") counts[v.category] += 1;
  }
  return counts;
}

// Add Socrata rows of { fam, n } (violation code family → cited count) into
// per-category totals.
export function totalsFromFamilies(rows) {
  const totals = emptyCounts();
  for (const row of rows) {
    const cat = categoryFor(row.fam);
    if (cat) totals[cat] += Number(row.n) || 0;
  }
  return totals;
}

// Mean cited violations per restaurant. The denominator is every restaurant
// inspected in the window, including the ones with zero violations in a
// category, so it comes from a separate count(distinct camis), not from the
// violation rows.
export function meanPerRestaurant(totals, restaurants) {
  return Object.fromEntries(
    Object.entries(totals).map(([cat, n]) => [cat, restaurants > 0 ? n / restaurants : 0])
  );
}

// One entry per category: the restaurant's count, the mean, and whether it's
// above. Above-mean categories come first (biggest ratio first), then the
// rest in config order.
export function compareToMeans(counts, means) {
  const rows = CATEGORIES.map((c, i) => {
    const value = counts[c.id] ?? 0;
    const mean = means[c.id] ?? 0;
    const above = value > mean;
    const ratio = mean > 0 ? value / mean : null;
    return { id: c.id, label: c.label, blurb: c.blurb, value, mean, above, ratio, order: i };
  });
  return rows.sort((a, b) =>
    (b.above - a.above) ||
    (a.above ? (b.ratio ?? Infinity) - (a.ratio ?? Infinity) : 0) ||
    a.order - b.order
  );
}

// "2.3× city average"; a plain label when the mean is zero.
export function ratioLabel(row, benchmark = "city") {
  const what = benchmark === "city" ? "city average" : "average for similar restaurants";
  if (!row.above) return null;
  if (row.ratio == null) return `Above the ${what} (which is 0)`;
  return `${row.ratio >= 10 ? Math.round(row.ratio) : row.ratio.toFixed(1)}× ${what}`;
}

// ---------- Display ----------

// "JOE'S PIZZA & GRILL" → "Joe's Pizza & Grill". Short all-letter words
// that are probably acronyms are kept as they are.
const KEEP_UPPER = new Set(["NYC", "BBQ", "USA", "II", "III", "IV", "LLC", "NY", "DBA"]);
export function titleCase(text) {
  if (!text) return "";
  return String(text).toLowerCase().replace(/[a-z0-9][a-z0-9'’]*/g, (word, offset, str) => {
    const upper = word.toUpperCase();
    if (KEEP_UPPER.has(upper)) return upper;
    // "41st", "2nd": leave ordinals lowercase
    if (/^\d/.test(word)) return word;
    // "o'brien" → "O'Brien", but "joe's" → "Joe's"
    const cap = word[0].toUpperCase() + word.slice(1);
    return cap.replace(/(['’])([a-z]{2,})/g, (m, q, rest) => q + rest[0].toUpperCase() + rest.slice(1));
  });
}

export function addressLine(r) {
  return [r.building, titleCase(r.street)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function boroLabel(boro) {
  return BOROUGHS.includes(boro) ? boro : "Borough unknown";
}
