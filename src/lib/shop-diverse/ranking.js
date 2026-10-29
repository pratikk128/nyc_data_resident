/*
 * The "Recommended" order for Shop Diverse NYC, plus the A–Z and
 * establishment-date sorts. Pure functions; tests in tests/shop-diverse.test.js.
 *
 * A business's score is the sum of the points below (the README and the
 * page's "Why this order?" note describe the same rules in plain words).
 * Ethnicity, gender and certification type are filters only: they never add
 * or take away points. The one exception is a small bonus for holding both
 * MBE and WBE, and only when the visitor asked for both: such a firm fits
 * both of their intents. (Most firms max out the other points, so a bonus
 * that applied all the time would decide nearly every tie in their favor.)
 *
 * Certification currency: a firm whose renewal dates have all passed loses
 * 100 points, which puts it below every current firm (and it's hidden unless
 * the visitor asks for lapsed certifications). A firm with no renewal date
 * gets the same 0 as a firm with a future one: every WBE-only firm in the
 * dataset has no renewal date, so treating "no date" as worse would bury
 * women-owned businesses.
 *
 * Ties are broken by a hash of the vendor's id and today's date, so the order
 * is stable all day and the same firms don't win every tie forever.
 */
import { searchText } from "./clean.js";

export const POINTS = {
  lapsed: -100,
  // What the visitor picked: every result shares these, so they only matter
  // next to the keyword points.
  subcategory: 30,
  category: 20,
  // Where the keyword was found (the best place that holds every word)
  keywordIndustry: 20,
  keywordName: 15,
  keywordDescription: 8,
  website: 6,
  description: 5,
  phone: 2,
  minDescriptionLength: 40,
  bothMbeWbe: 3,
  perYearInBusiness: 0.5,
  maxYearsCounted: 10,
  sameZip: 12,
  sameBorough: 6
};

// "current" (a renewal date today or later), "lapsed" (every renewal date has
// passed) or "undated" (no renewal date in the data).
export function certStatus(record, today) {
  const dates = record.renewals ?? [];
  if (!dates.length) return "undated";
  return dates[dates.length - 1] >= today ? "current" : "lapsed";
}

// Whole years from the establishment date to today, or null.
export function yearsInBusiness(established, today) {
  if (!established || established > today) return null;
  const [y1, m1, d1] = established.split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

// The text keyword search looks in, as searchText() strings.
export function haystack(record) {
  return {
    name: searchText(`${record.name} ${record.dba ?? ""}`),
    industry: searchText(`${record.sector ?? ""} ${record.subsector ?? ""} ${record.title ?? ""}`),
    description: searchText(record.description)
  };
}

// Each word must start a word somewhere ("plumb" finds "PLUMBING"). Returns
// the best single place that holds every word — "industry", "name",
// "description" — "mixed" when the words are spread across places, or null
// when some word isn't found at all.
export function keywordMatch(words, hay) {
  if (!words.length) return null;
  const has = (field) => words.every((w) => hay[field].includes(` ${w}`));
  if (has("industry")) return "industry";
  if (has("name")) return "name";
  if (has("description")) return "description";
  const all = `${hay.name}${hay.industry}${hay.description}`;
  return words.every((w) => all.includes(` ${w}`)) ? "mixed" : null;
}

const KEYWORD_POINTS = {
  industry: POINTS.keywordIndustry,
  name: POINTS.keywordName,
  description: POINTS.keywordDescription,
  mixed: POINTS.keywordDescription
};

/*
 * record: a cleaned vendor (clean.js). ctx: {
 *   today:      "YYYY-MM-DD"
 *   query:      { who, cat, sub, zip } from the filters (filter.js)
 *   zipBorough: the borough of query.zip, if it's a NYC ZIP
 *   match:      keywordMatch() for this record, or null with no keyword
 * }
 * Returns { score, parts } where parts names every rule that added points.
 */
export function scoreBusiness(record, { today, query = {}, zipBorough = null, match = null }) {
  const parts = {};
  if (certStatus(record, today) === "lapsed") parts.lapsed = POINTS.lapsed;
  if (query.sub) parts.subcategory = POINTS.subcategory;
  else if (query.cat) parts.category = POINTS.category;
  if (match) parts.keyword = KEYWORD_POINTS[match];
  if (record.website) parts.website = POINTS.website;
  if ((record.description ?? "").length >= POINTS.minDescriptionLength) parts.description = POINTS.description;
  if (record.phone?.tel) parts.phone = POINTS.phone;
  const certs = record.certs ?? [];
  const wantsBoth = query.who?.includes("MBE") && query.who?.includes("WBE");
  if (wantsBoth && certs.includes("MBE") && certs.includes("WBE")) parts.bothMbeWbe = POINTS.bothMbeWbe;
  const years = yearsInBusiness(record.established, today);
  if (years > 0) parts.experience = Math.min(years, POINTS.maxYearsCounted) * POINTS.perYearInBusiness;
  if (query.zip && record.zip === query.zip) parts.sameZip = POINTS.sameZip;
  else if (zipBorough && record.borough === zipBorough) parts.sameBorough = POINTS.sameBorough;
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  return { score, parts };
}

// FNV-1a over "id|seed": a stable pseudo-random number per vendor per day.
export function tieBreak(id, seed) {
  const s = `${id}|${seed}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export const displayName = (record) => record.dba || record.name;

const byName = (a, b) =>
  displayName(a.record).localeCompare(displayName(b.record), "en", { sensitivity: "base", numeric: true }) ||
  a.record.id.localeCompare(b.record.id);

// Missing dates sort last either way.
const byDate = (dir) => (a, b) => {
  const x = a.record.established, y = b.record.established;
  if (x === y) return byName(a, b);
  if (!x) return 1;
  if (!y) return -1;
  return dir * (x < y ? -1 : 1);
};

/*
 * items: [{ record, match }] (match from keywordMatch, or null). Returns a new
 * array, sorted. Lapsed certifications sort last in every order.
 *   sort: "recommended" | "az" | "newest" | "oldest"
 *   ctx:  as for scoreBusiness, plus seed (today's date) for ties
 */
export function rankBusinesses(items, { sort = "recommended", today, query = {}, zipBorough = null, seed = today }) {
  const rows = items.map((item) => ({
    ...item,
    lapsed: certStatus(item.record, today) === "lapsed",
    score: sort === "recommended" ? scoreBusiness(item.record, { today, query, zipBorough, match: item.match }).score : 0,
    tie: sort === "recommended" ? tieBreak(item.record.id, seed) : 0
  }));
  const compare = {
    recommended: (a, b) => b.score - a.score || a.tie - b.tie || a.record.id.localeCompare(b.record.id),
    az: byName,
    newest: byDate(-1),
    oldest: byDate(1)
  }[sort] ?? byName;
  return rows.sort((a, b) => (a.lapsed - b.lapsed) || compare(a, b));
}
