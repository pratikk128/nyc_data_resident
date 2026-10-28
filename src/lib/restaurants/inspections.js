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

// The newest scored inspection, from groupInspections() output (newest first).
// Administrative, calorie posting, smoke-free and similar visits aren't scored
// and never cite critical violations, so they'd hide the last real inspection.
// Falls back to the newest one when none is scored.
export function latestScored(inspections) {
  return inspections.find((insp) => insp.score != null) ?? inspections[0] ?? null;
}

// "Establishment Closed by DOHMH. ..." and "Establishment re-closed by DOHMH."
export function isClosedAction(action) {
  return /\b(re-)?closed by DOHMH/i.test(String(action ?? ""));
}

// An inspection's actions closed (or re-closed) the restaurant and didn't also
// reopen it. Any visit type can close or reopen, administrative ones included,
// so callers pass the newest inspection, scored or not.
export function closesRestaurant(actions = []) {
  return actions.some(isClosedAction) && !actions.some((a) => /re-opened/i.test(a));
}

// ---------- Categories vs the mean ----------

// "YYYY-MM-DD" exactly `years` before `today` (an ISO string, or a Date read
// as UTC). Callers pass nycToday(), since inspection dates are New York days.
export function cutoffDate(today, years) {
  const d = new Date(typeof today === "string" ? `${day(today)}T00:00:00Z` : today);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export function emptyCounts() {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
}

// Cited violations per category on or after `since`, from one
// restaurant's grouped inspections.
export function countByCategory(inspections, since) {
  const counts = emptyCounts();
  for (const insp of inspections) {
    if (insp.date < since) continue;
    for (const v of insp.violations) counts[v.category] += 1;
  }
  return counts;
}

// Inspections on or after `since` that cited each category at least once.
export function inspectionsByCategory(inspections, since) {
  const counts = emptyCounts();
  for (const insp of inspections) {
    if (insp.date < since) continue;
    for (const cat of new Set(insp.violations.map((v) => v.category))) counts[cat] += 1;
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

// Cited violations per inspection. For the benchmarks the denominator is every
// inspection in the window, including the ones with zero violations in a
// category, so it comes from a separate count of distinct camis + date, not
// from the violation rows.
export function perInspection(totals, inspections) {
  return Object.fromEntries(
    Object.entries(totals).map(([cat, n]) => [cat, inspections > 0 ? n / inspections : 0])
  );
}

// How many times the mean a restaurant's rate has to be for a category to
// count as worse than the rest.
export const ABOVE_FACTOR = 2;

// ...and how many separate inspections have to have cited it, so one bad day
// isn't a pattern. The ratio alone flagged about 7 in 10 restaurants (rare
// categories have tiny means), and repeats alone flagged as many (common ones
// are cited at most inspections); together, about 1 in 7.
export const MIN_REPEAT_INSPECTIONS = 3;

// rates: the restaurant's violations per inspection by category. citedAt: how
// many of its inspections cited each category (inspectionsByCategory()).
// One entry per category: the rate, the mean, and whether it's at least
// ABOVE_FACTOR times the mean and cited at MIN_REPEAT_INSPECTIONS or more
// inspections. Those come first (furthest above first), then the rest in
// config order.
export function compareToMeans(rates, means, citedAt) {
  const rows = CATEGORIES.map((c, i) => {
    const value = rates[c.id] ?? 0;
    const mean = means[c.id] ?? 0;
    const inspections = citedAt[c.id] ?? 0;
    const above = value > 0 && value >= mean * ABOVE_FACTOR && inspections >= MIN_REPEAT_INSPECTIONS;
    return { id: c.id, label: c.label, blurb: c.blurb, value, mean, inspections, above, order: i };
  });
  return rows.sort((a, b) =>
    (b.above - a.above) ||
    (a.above ? (b.value - b.mean) - (a.value - a.mean) : 0) ||
    a.order - b.order
  );
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
