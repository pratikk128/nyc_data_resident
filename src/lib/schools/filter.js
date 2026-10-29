/*
 * Browse page search for the NYC School Quality Explorer: URL state, name /
 * DBN / address matching, the type and borough counts, sorting and pages.
 * Runs in the Worker over the daily school index (src/lib/server/schools.js)
 * and in the browser for the URL round-trip.
 *
 * URL state:
 *   q      school name (typo-tolerant, word starts) or a DBN (02M475, 2M475, M475)
 *   type   a TYPES slug (elementary, middle, k-8, high-school, transfer, ...)
 *   boro   manhattan, brooklyn, queens, bronx, staten-island
 *   where  street, ZIP, neighborhood or borough words
 *   all    1: include schools whose latest report is older than the newest year
 *   sort   "" (best match when there's a name, else A–Z), district, ela, math, grad, absent
 *   page   1-based
 */
import { TYPES, TYPE_BY_SLUG, BOROUGHS, PAGE_SIZE, MAX_QUERY_LENGTH } from "./config.js";
import { METRIC_SORTS } from "./metrics.js";

export const SORTS = [
  { value: "", label: "Name (A–Z)" },
  { value: "district", label: "District" },
  ...METRIC_SORTS.map(({ value, label }) => ({ value, label }))
];
const SORT_VALUES = new Set(SORTS.map((s) => s.value));
const BOROUGH_SLUGS = new Set(BOROUGHS.map((b) => b.slug));

export const QUERY_TOO_LONG = `Keep searches under ${MAX_QUERY_LENGTH} characters.`;

export function normalizeQuery(params) {
  const get = (k) => String(params.get(k) ?? "").trim();
  const q = get("q").replace(/\s+/g, " ");
  const where = get("where").replace(/\s+/g, " ");
  if (q.length > MAX_QUERY_LENGTH || where.length > MAX_QUERY_LENGTH) return { error: QUERY_TOO_LONG, query: null };
  const type = TYPE_BY_SLUG[get("type")] ? get("type") : "";
  const boro = BOROUGH_SLUGS.has(get("boro")) ? get("boro") : "";
  const sort = SORT_VALUES.has(get("sort")) ? get("sort") : "";
  const page = Math.max(1, Math.min(1000, Number.parseInt(get("page"), 10) || 1));
  return { error: null, query: { q, type, boro, where, all: get("all") === "1", sort, page } };
}

// Only what differs from the defaults, in a fixed order (cache keys, URLs).
export function queryToParams(query) {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.type) p.set("type", query.type);
  if (query.boro) p.set("boro", query.boro);
  if (query.where) p.set("where", query.where);
  if (query.all) p.set("all", "1");
  if (query.sort) p.set("sort", query.sort);
  if (query.page > 1) p.set("page", String(query.page));
  return p;
}

// ---------- Text matching ----------

/*
 * Lower case, periods dropped so "P.S." and "I.S" become ps / is, other
 * punctuation to spaces, apostrophes dropped, leading zeros and ordinal
 * endings off numbers ("015" → "15", "4th" → "4").
 */
export function words(text) {
  return String(text ?? "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b0+(\d)/g, "$1")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .trim().split(" ").filter(Boolean);
}

const FILLER = new Set(["the", "of", "and", "for", "at", "a"]);

// Street words people abbreviate. A query word matches its own spelling or this one.
const ABBREVIATIONS = {
  st: "street", ave: "avenue", av: "avenue", blvd: "boulevard", pl: "place", rd: "road", pkwy: "parkway",
  hwy: "highway", ln: "lane", dr: "drive", ct: "court", tpke: "turnpike", sq: "square",
  e: "east", w: "west", n: "north", s: "south"
};

// Edit distance, stopping early once it's over max (we only care about ≤ 1).
export function editDistance(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/*
 * How well one typed word matches a name's words: 3 exact, 2 the start of a
 * word (so results update while typing), 1 a one-letter typo in a word of 4+
 * letters (whole word or the start of a longer one), 0 no match. Numbers
 * match exactly or as a start ("32" while typing "321").
 */
export function wordScore(typed, nameWords) {
  let best = 0;
  for (const w of nameWords) {
    if (w === typed) return 3;
    if (w.startsWith(typed)) best = Math.max(best, 2);
    else if (best < 1 && typed.length >= 4 && !/\d/.test(typed) &&
      (editDistance(typed, w) <= 1 || (w.length > typed.length && editDistance(typed, w.slice(0, typed.length)) <= 1))) best = 1;
  }
  return best;
}

// Name match score (0 = no match). Every typed word has to match.
export function nameScore(queryWords, nameWords) {
  const typed = queryWords.filter((w) => !FILLER.has(w));
  if (!typed.length) return 1;
  let total = 0;
  for (const w of typed) {
    const s = wordScore(w, nameWords);
    if (!s) return 0;
    total += s;
  }
  // Names that start with what was typed come first: "ps 9" → P.S. 9 before M.S. 9 ... P.S. 9,
  // more so when every typed word lines up ("brooklyn tech" → Brooklyn Technical High School).
  if (nameWords[0] === typed[0]) total += 1;
  if (typed.every((w, i) => nameWords[i]?.startsWith(w))) total += 2;
  return total;
}

// "02M475", "2m475", "M475" → { district, borough, number }; null if it isn't a DBN.
export function parseDbn(text) {
  const m = /^(\d{1,2})?([mxkqr])(\d{1,3})$/i.exec(String(text ?? "").replace(/\s+/g, ""));
  if (!m) return null;
  return { district: m[1] ? m[1].padStart(2, "0") : null, letter: m[2].toUpperCase(), number: m[3].padStart(3, "0") };
}

export function dbnMatches(dbn, parsed) {
  return dbn.slice(2, 3) === parsed.letter && dbn.slice(3) === parsed.number &&
    (!parsed.district || dbn.slice(0, 2) === parsed.district);
}

// Every typed address word is the start of a word in the address, ZIP, neighborhood or borough.
export function addressMatches(queryWords, haystackWords) {
  return queryWords.every((w) => {
    if (FILLER.has(w)) return true;
    const forms = ABBREVIATIONS[w] ? [w, ABBREVIATIONS[w]] : [w];
    // Numbers (house numbers, ZIPs, "4" in 4 Street) match whole words only
    return haystackWords.some((h) => forms.some((f) => (/^\d+$/.test(f) ? h === f : h.startsWith(f))));
  });
}

// The words searched for a school, cached on the record (search runs over the same index all day).
function searchWords(school) {
  school._nameWords ??= words(school.name);
  school._placeWords ??= words([school.loc?.address, school.loc?.zip, school.loc?.neighborhood, school.boro].filter(Boolean).join(" "));
  return school;
}

// ---------- Sorting ----------

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
// Sort past leading quotes and punctuation: “Brooklyn ...” sorts under B.
export const sortName = (name) => String(name ?? "").replace(/^[^A-Za-z0-9]+/, "");
export const byName = (a, b) => collator.compare(sortName(a.name), sortName(b.name)) || a.dbn.localeCompare(b.dbn);

// The sort's metrics, the one for the school's card report first (a 6–12
// school sorts by its high school absenteeism, the report its card shows).
function sortMetrics(school, sortKey) {
  const sort = METRIC_SORTS.find((s) => s.value === sortKey);
  if (!sort) return [];
  const card = school.reports?.[0]?.report;
  return [...sort.metrics].sort((a, b) => b.reports.includes(card) - a.reports.includes(card));
}

// The metric a school is sorted by: { metric, v } for the first of the sort's metrics it has, or null.
export function sortMetric(school, sortKey) {
  for (const m of sortMetrics(school, sortKey)) {
    const v = school.values?.[m.id]?.v;
    if (v != null) return { metric: m, v };
  }
  return null;
}

// A school's value for a metric sort.
export function sortValue(school, sortKey) {
  const found = sortMetric(school, sortKey);
  return found && { v: found.v, higherIsBetter: found.metric.higherIsBetter };
}

function sortSchools(rows, query) {
  const sorted = [...rows];
  if (METRIC_SORTS.some((s) => s.value === query.sort)) {
    sorted.sort((a, b) => {
      const va = sortValue(a.school, query.sort), vb = sortValue(b.school, query.sort);
      if (va && !vb) return -1;
      if (vb && !va) return 1;
      if (va && vb && va.v !== vb.v) return va.higherIsBetter === false ? va.v - vb.v : vb.v - va.v;
      return byName(a.school, b.school);
    });
  } else if (query.sort === "district") {
    sorted.sort((a, b) => a.school.dbn.slice(0, 2).localeCompare(b.school.dbn.slice(0, 2)) || byName(a.school, b.school));
  } else if (query.q) {
    sorted.sort((a, b) => b.score - a.score || byName(a.school, b.school));
  } else {
    sorted.sort((a, b) => byName(a.school, b.school));
  }
  return sorted;
}

// ---------- Search ----------

// The school's types now (from its newest year's reports).
export const schoolTypeSlugs = (school) => school.types;

/*
 * index: { latestYear, schools } from the daily job. Returns the schools that
 * pass every filter (with their name score), and the type and borough counts
 * (each ignoring its own filter, so the other options show what they'd give).
 */
export function matchSchools(index, query) {
  const qWords = words(query.q);
  const dbn = parseDbn(query.q);
  const whereWords = words(query.where);
  const boroLabel = BOROUGHS.find((b) => b.slug === query.boro)?.label;

  const textMatched = [];
  for (const school of index.schools) {
    searchWords(school);
    let score = 1;
    if (dbn && dbnMatches(school.dbn, dbn)) score = 10;
    else if (qWords.length) score = nameScore(qWords, school._nameWords);
    if (!score) continue;
    if (whereWords.length && !addressMatches(whereWords, school._placeWords)) continue;
    textMatched.push({ school, score });
  }
  // Something DBN-shaped that matches a DBN shows only that school; otherwise it was searched as a name.
  const byDbn = dbn ? textMatched.filter((r) => r.score === 10) : [];
  const pool = byDbn.length ? byDbn : textMatched;

  const isCurrent = (s) => query.all || s.current;
  const facets = {
    types: Object.fromEntries(TYPES.map((t) => [t.slug, 0])),
    boros: Object.fromEntries(BOROUGHS.map((b) => [b.slug, 0])),
    older: 0
  };
  const matched = [];
  for (const row of pool) {
    const s = row.school;
    const typeOk = !query.type || schoolTypeSlugs(s).includes(query.type);
    const boroOk = !boroLabel || s.boro === boroLabel;
    if (!s.current && !query.all && typeOk && boroOk) facets.older++;
    if (!isCurrent(s)) continue;
    if (boroOk) for (const t of new Set(schoolTypeSlugs(s))) facets.types[t]++;
    if (typeOk) {
      const slug = BOROUGHS.find((b) => b.label === s.boro)?.slug;
      if (slug) facets.boros[slug]++;
    }
    if (typeOk && boroOk) matched.push(row);
  }
  return { matched, facets };
}

export function searchSchools(index, query, { pageSize = PAGE_SIZE } = {}) {
  const { matched, facets } = matchSchools(index, query);
  const total = matched.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pages);
  const sorted = sortSchools(matched, query);
  const results = sorted.slice((page - 1) * pageSize, page * pageSize).map((r) => resultRecord(r.school, index, query.sort));
  return { total, page, pages, pageSize, results, facets, latestYear: index.latestYear, sort: query.sort, q: query.q };
}

// Every match as a map point: [lat, lon, dbn, name, type slug]. Schools without a location are counted.
export function searchPoints(index, query) {
  const { matched } = matchSchools(index, query);
  const points = [];
  let missing = 0;
  for (const { school: s } of matched) {
    if (s.loc?.lat == null || s.loc?.lon == null) { missing++; continue; }
    points.push([s.loc.lat, s.loc.lon, s.dbn, s.name, s.types[0] ?? null]);
  }
  return { total: matched.length, missing, points };
}

/*
 * What a result card needs: identity, place, the card report's values and NYC
 * averages, and under a metric sort, the measure the school was sorted by
 * (sorted: { id, city }), so the card can show it when it isn't a card measure.
 */
export function resultRecord(s, index, sortKey = "") {
  const report = s.reports[0];
  const found = sortMetric(s, sortKey);
  const sortedBy = found?.metric ?? sortMetrics(s, sortKey).find((m) => m.reports.includes(report?.report));
  // The NYC average for the report and year the sorted value came from.
  const sortedReport = sortedBy && s.reports.find((r) => sortedBy.reports.includes(r.report));
  const sortedYear = s.values?.[sortedBy?.id]?.y ?? sortedReport?.year;
  return {
    dbn: s.dbn,
    name: s.name,
    types: schoolTypeSlugs(s),
    boro: s.boro,
    district: s.district,
    loc: s.loc ? { address: s.loc.address, zip: s.loc.zip, neighborhood: s.loc.neighborhood } : null,
    current: s.current,
    report: report?.report ?? null,
    year: report?.year ?? null,
    values: s.values,
    city: index.cityAvg?.[report?.report] ? cityFor(index, report.report, report.year) : {},
    sorted: sortedBy ? { id: sortedBy.id, city: index.cityAvg?.[sortedReport?.report]?.[sortedBy.id]?.[sortedYear] ?? null } : null
  };
}

// { [metric id]: NYC average } for one report type and year.
export function cityFor(index, report, year) {
  const out = {};
  for (const [id, years] of Object.entries(index.cityAvg?.[report] ?? {})) {
    if (years[year] != null) out[id] = years[year];
  }
  return out;
}
