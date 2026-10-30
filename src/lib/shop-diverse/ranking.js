/*
 * The "Recommended" order for Shop Diverse NYC, plus the A–Z,
 * establishment-date, bonding-limit and largest-contract sorts. Pure functions; tests in tests/shop-diverse.test.js.
 *
 * A business's score is the sum of the points below (the README and the
 * page's "Why this order?" note describe the same rules in plain words).
 * Ethnicity, gender and certification type are filters only: they never add
 * or take away points. The one exception is a small bonus for holding both
 * MBE and WBE, and only when the visitor asked for both: such a firm fits
 * both of their intents. (Most firms max out the other points, so a bonus
 * that applied all the time would decide nearly every tie in their favor.)
 *
 * Certification currency doesn't score. A firm whose renewal dates have all
 * passed is hidden unless the visitor asks for lapsed certifications, and
 * then rankBusinesses() sorts it last in every order. A firm with no renewal
 * date is treated like a current one: every WBE-only firm in the dataset has
 * no renewal date, so treating "no date" as worse would bury women-owned
 * businesses.
 *
 * A business in one of the five boroughs gets a bonus, so with no keyword
 * (when most firms tie on the other points) New York City firms come first,
 * not the third of the list based elsewhere. It's smaller than the gap
 * between a keyword in the industry and one only in the description, so a
 * firm outside NYC that does what was asked still beats one that only
 * mentions it.
 *
 * A keyword in the specific industry title (NAICS title) scores above one
 * only in the broader sector or subsector: "plumber" finds plumbing
 * contractors by title, but also hardware and HVAC wholesalers whose
 * subsector reads "Hardware, and Plumbing and Heating Equipment and Supplies
 * Merchant Wholesalers". The gap is smaller than the NYC bonus, so it orders
 * firms within NYC and within the rest, not one against the other.
 *
 * Ties are broken by a hash of the vendor's id and today's date, so the order
 * is stable all day and the same firms don't win every tie forever.
 */
import { searchText, descriptionHaystack } from "./clean.js";

export const POINTS = {
  // What the visitor picked: every result shares these, so they only matter
  // next to the keyword points.
  subcategory: 30,
  category: 20,
  // Where the keyword was found (the best place that holds every word)
  keywordTitle: 25,
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
  inNyc: 10,
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

// The text keyword search looks in, as searchText() strings. The index has
// only the description's excerpt and other words (indexRecord).
export function haystack(record) {
  return {
    name: searchText(`${record.name} ${record.dba ?? ""}`),
    title: searchText(record.title ?? ""),
    industry: searchText(`${record.sector ?? ""} ${record.subsector ?? ""} ${record.title ?? ""}`),
    description: descriptionHaystack(record)
  };
}

// Words of one or two letters ("IT", "AV") have to be whole words, or they'd
// match the start of nearly everything ("ITEMS", "AVENUE").
const found = (text, word) => text.includes(word.length <= 2 ? ` ${word} ` : ` ${word}`);

// Each word must start a word somewhere ("plumb" finds "PLUMBING"). Returns
// the best single place that holds every word — "title" (the industry
// title alone), "industry" (sector, subsector and title), "name",
// "description" — "mixed" when the words are spread across places, or null
// when some word isn't found at all.
export function keywordMatch(words, hay) {
  if (!words.length) return null;
  const has = (field) => words.every((w) => found(hay[field], w));
  if (has("title")) return "title";
  if (has("industry")) return "industry";
  if (has("name")) return "name";
  if (has("description")) return "description";
  const all = `${hay.name}${hay.industry}${hay.description}`;
  return words.every((w) => found(all, w)) ? "mixed" : null;
}

const KEYWORD_POINTS = {
  title: POINTS.keywordTitle,
  industry: POINTS.keywordIndustry,
  name: POINTS.keywordName,
  description: POINTS.keywordDescription,
  mixed: POINTS.keywordDescription
};

/*
 * record: an index record (indexRecord in clean.js). ctx: {
 *   today:      "YYYY-MM-DD"
 *   query:      { who, cat, sub, zip } from the filters (filter.js)
 *   zipBorough: the borough of query.zip, if it's a NYC ZIP
 *   match:      keywordMatch() for this record, or null with no keyword
 * }
 * Returns { score, parts } where parts names every rule that added points.
 */
export function scoreBusiness(record, { today, query = {}, zipBorough = null, match = null }) {
  const parts = {};
  if (query.sub) parts.subcategory = POINTS.subcategory;
  else if (query.cat) parts.category = POINTS.category;
  if (match) parts.keyword = KEYWORD_POINTS[match];
  if (record.website) parts.website = POINTS.website;
  if ((record.excerpt ?? "").length >= POINTS.minDescriptionLength) parts.description = POINTS.description;
  if (record.phone?.tel) parts.phone = POINTS.phone;
  const certs = record.certs ?? [];
  const wantsBoth = query.who?.includes("MBE") && query.who?.includes("WBE");
  if (wantsBoth && certs.includes("MBE") && certs.includes("WBE")) parts.bothMbeWbe = POINTS.bothMbeWbe;
  const years = yearsInBusiness(record.established, today);
  if (years > 0) parts.experience = Math.min(years, POINTS.maxYearsCounted) * POINTS.perYearInBusiness;
  if (record.borough) parts.inNyc = POINTS.inNyc;
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

// One collator for every comparison: localeCompare with options builds one per call.
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const byName = (a, b) =>
  collator.compare(displayName(a.record), displayName(b.record)) || a.record.id.localeCompare(b.record.id);

// Missing dates sort last either way.
const byDate = (dir) => (a, b) => {
  const x = a.record.established, y = b.record.established;
  if (x === y) return byName(a, b);
  if (!x) return 1;
  if (!y) return -1;
  return dir * (x < y ? -1 : 1);
};

// Largest first; firms that give no amount sort last.
const byAmount = (field) => (a, b) => {
  const x = a.record[field] ?? 0, y = b.record[field] ?? 0;
  return y - x || byName(a, b);
};

/*
 * items: [{ record, match }] (match from keywordMatch, or null). Returns a new
 * array, sorted. Lapsed certifications sort last in every order.
 *   sort: "recommended" | "az" | "newest" | "oldest" | "bonding" | "contract"
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
    oldest: byDate(1),
    bonding: byAmount("bonding"),
    contract: byAmount("largestContract")
  }[sort] ?? byName;
  return rows.sort((a, b) => (a.lapsed - b.lapsed) || compare(a, b));
}
