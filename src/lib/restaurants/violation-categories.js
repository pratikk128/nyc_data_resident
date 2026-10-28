/*
 * Violation categories for the restaurant inspection dashboard. This is the one
 * place the mapping lives: the daily benchmark job, the API and the page all
 * read it.
 *
 * DOHMH violation codes look like "02G" or "15-27"; the first two characters
 * are the family. Families were grouped from the distinct violation_code /
 * violation_description values in dataset 43nn-pn8j (Oct 2026, 239 pairs).
 * Any family not listed here, including new ones, counts as "Other".
 */

// How far back "violations in each category" looks, for the restaurant and the
// benchmarks alike.
export const LOOKBACK_YEARS = 3;

// "Similar restaurants" (same cuisine and borough) needs at least this many
// restaurants inspected in the window; smaller groups fall back to citywide.
export const MIN_SIMILAR_RESTAURANTS = 20;

export const OTHER = "other";

export const CATEGORIES = [
  {
    id: "temperature",
    label: "Food temperature",
    families: ["02"],
    blurb: "Hot food not hot enough, cold food not cold enough, or food cooled or reheated the wrong way."
  },
  {
    id: "source",
    label: "Food source",
    families: ["03"],
    blurb: "Food, shellfish, eggs or water from an unapproved or unknown source, or missing labels."
  },
  {
    id: "contamination-pests",
    label: "Contamination and pests",
    families: ["04"],
    blurb: "Signs of mice, rats, roaches or flies; contaminated food; no certified food protection supervisor."
  },
  {
    id: "facility-design",
    label: "Facility design and equipment",
    families: ["05"],
    blurb: "Missing hand-wash sinks, not enough hot or cold holding equipment, sewage or ventilation problems."
  },
  {
    id: "hygiene",
    label: "Hygiene and cross-contamination",
    families: ["06"],
    blurb: "Surfaces not washed and sanitized, food not protected from contamination, wiping cloths, worker hygiene."
  },
  {
    id: "pest-prevention",
    label: "Pest prevention and facility",
    families: ["08"],
    blurb: "Conditions that attract pests, garbage not covered, pesticides stored or used improperly."
  },
  {
    id: "food-protection",
    label: "Food protection",
    families: ["09"],
    blurb: "Damaged cans, improper thawing, worn food contact surfaces, missing hand-wash signs."
  },
  {
    id: "maintenance",
    label: "Facility maintenance",
    families: ["10"],
    blurb: "Dirty or damaged non-food surfaces, plumbing and back-flow devices, dishwashing, thermometers, lighting."
  },
  {
    id: "signs-permits",
    label: "Signs, permits and local laws",
    families: ["15", "16", "18", "19", "20"],
    blurb: "Smoke-free rules, calorie and sodium labels, permits and documents, plastic straws, posting the letter grade."
  },
  {
    id: OTHER,
    label: "Other",
    families: [], // 07, 22, 28, 99 and anything new
    blurb: "Everything else, such as obstructing an inspector or not having a pest control contract."
  }
];

const BY_FAMILY = new Map(CATEGORIES.flatMap((c) => c.families.map((f) => [f, c.id])));

export function violationFamily(code) {
  return String(code ?? "").trim().slice(0, 2);
}

// Category id for a violation code, or null when there is no code (an
// inspection with no violations recorded).
export function categoryFor(code) {
  const family = violationFamily(code);
  if (!family) return null;
  return BY_FAMILY.get(family) ?? OTHER;
}

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}
