/*
 * Shop Local filters: the URL query, the filtering, the counts on each tile
 * and chip, and one page of results. Pure functions; the server runs them
 * over the Shop Diverse daily vendor list (src/lib/server/shop-local.js).
 *
 * URL parameters (all optional):
 *   what     a category key from CATEGORIES ("eat")
 *   own      owner keys, any of ("women,black")
 *   q        keyword (name, description, what they do)
 *   near     a NYC ZIP: nearest first, with distances
 *   boro     a borough slug, when there's no ZIP
 *   outside=1  include businesses based outside the five boroughs
 *   page     1-based
 *
 * Only businesses whose industry maps to a category in config.js are
 * searched, and certifications whose renewal dates have all passed are left
 * out.
 */
import { KINDS, CATEGORIES, CATEGORY_KEYS, OWNERS, OWNER_KEYS, BOROUGHS, PAGE_SIZE, MAX_KEYWORD_LENGTH } from "./config.js";
import { keywordWords, boroughFromZip } from "../shop-diverse/clean.js";
import { haystack, keywordMatch, certStatus, tieBreak, displayName, yearsInBusiness } from "../shop-diverse/ranking.js";
import { haversineMiles } from "../help-near-me/distance.js";

const MAX_PAGE = 500;
const BOROUGH_BY_SLUG = Object.fromEntries(BOROUGHS.map((b) => [b.slug, b.label]));
const OWNER_BY_KEY = Object.fromEntries(OWNERS.map((o) => [o.key, o]));

// "women,black", or the same name repeated (a plain form GET sends own=women&own=black).
const list = (params, key) =>
  [...new Set(params.getAll(key).join(",").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean))];

// URLSearchParams → { query } or { error }. Unknown values are dropped, so an
// old link still opens. A ZIP outside NYC is kept off (nothing to measure from).
export function normalizeQuery(params) {
  const get = (k) => params.get(k) ?? "";
  const near = get("near").trim();
  const query = {
    what: CATEGORY_KEYS.includes(get("what")) ? get("what") : "",
    own: OWNER_KEYS.filter((k) => list(params, "own").includes(k)),
    q: get("q").replace(/\s+/g, " ").trim(),
    near: /^\d{5}$/.test(near) && boroughFromZip(near) ? near : "",
    boro: BOROUGH_BY_SLUG[get("boro")] ? get("boro") : "",
    outside: get("outside") === "1",
    page: Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(get("page"))) || 1))
  };
  if (query.q.length > MAX_KEYWORD_LENGTH) return { error: `Keep the keyword under ${MAX_KEYWORD_LENGTH} characters.` };
  // A ZIP picks the place; a borough on top would only hide nearby businesses across the line.
  if (query.near) query.boro = "";
  // Outside NYC can't be in a borough.
  if (query.boro) query.outside = false;
  return { query };
}

export const defaultQuery = () => normalizeQuery(new URLSearchParams()).query;

// The inverse: only non-default values, in a fixed order, so equal queries
// make equal URLs (and share a cache entry).
export function queryToParams(query, { page = true } = {}) {
  const p = new URLSearchParams();
  if (query.what) p.set("what", query.what);
  if (query.own?.length) p.set("own", query.own.join(","));
  if (query.q) p.set("q", query.q);
  if (query.near) p.set("near", query.near);
  if (query.boro) p.set("boro", query.boro);
  if (query.outside) p.set("outside", "1");
  if (page && query.page > 1) p.set("page", String(query.page));
  return p;
}

// What a business is to a resident, or null when it isn't one they'd use.
export const kindOf = (record) => KINDS.get(record.title) ?? null;

// The owner keys a business matches: women (WBE) and its MBE ethnicity.
export function ownersOf(record) {
  const certs = record.certs ?? [];
  const keys = [];
  if (certs.includes("WBE")) keys.push("women");
  if (certs.includes("MBE")) {
    const o = OWNERS.find((x) => x.ethnicity && x.ethnicity === record.ethnicity);
    if (o) keys.push(o.key);
  }
  return keys;
}

// Badge labels: "Women-owned", "Black-owned"; an MBE with no usable ethnicity is "Minority-owned".
export function ownerLabels(record) {
  const keys = ownersOf(record);
  const labels = keys.map((k) => OWNER_BY_KEY[k].label);
  if (record.certs?.includes("MBE") && !keys.some((k) => k !== "women")) labels.push("Minority-owned");
  return labels;
}

// "Astoria, Queens"; a borough alone when the city is the borough or "New York".
export function placeName(record) {
  if (!record.borough) return [record.city, record.state].filter(Boolean).join(", ");
  const city = record.city ?? "";
  const generic = !city || /^(new york|nyc|new york city)$/i.test(city) || city.toLowerCase() === record.borough.toLowerCase() ||
    (record.borough === "Staten Island" && /^staten is/i.test(city)) || (record.borough === "Bronx" && /^(the )?bronx$/i.test(city));
  return generic ? record.borough : `${city}, ${record.borough}`;
}

// The point a business is measured from: the middle of its ZIP. zips: { "11216": [lat, lon] }
const zipPoint = (zips, zip) => (zips[zip] ? { lat: zips[zip][0], lon: zips[zip][1] } : null);

// Easiest to reach first: a website, then a phone, then a real description.
const reach = (r) => (r.website ? 4 : 0) + (r.phone?.tel ? 2 : 0) + ((r.excerpt ?? "").length >= 40 ? 1 : 0);
const MATCH_RANK = { title: 4, industry: 3, name: 3, description: 1, mixed: 1 };

// What a result card needs. Street address only for walk-in kinds.
export function cardSummary(record, kind, miles) {
  return {
    id: record.id,
    name: displayName(record),
    kind: kind.label,
    cat: kind.cat,
    owners: ownerLabels(record),
    place: placeName(record),
    ...(record.zip && { zip: record.zip }),
    ...(kind.walk && record.address1 && { street: [record.address1, record.address2].filter(Boolean).join(", ") }),
    ...(record.phone?.tel && { tel: record.phone.tel }),
    ...(record.website && { website: record.website }),
    ...(record.excerpt && { excerpt: record.excerpt }),
    ...(record.established && { since: record.established.slice(0, 4) }),
    ...(miles != null && { miles: Math.round(miles * 10) / 10 })
  };
}

// Haystacks are built once per vendor list (per Worker isolate), not per request.
const prepared = new WeakMap();
function prepare(vendors) {
  let rows = prepared.get(vendors);
  if (!rows) {
    rows = [];
    for (const r of vendors) {
      const kind = kindOf(r);
      if (kind) rows.push({ record: r, kind, owners: ownersOf(r), hay: haystack(r) });
    }
    prepared.set(vendors, rows);
  }
  return rows;
}

/*
 * One view of the page. vendors: the cleaned list (index records). zips: the
 * ZIP centroids. →
 * {
 *   total, page, pages, pageSize, results: [cardSummary],
 *   facets: { what: { eat: n, … }, own: { women: n, … }, boroughs: { manhattan: n, … }, outside: n },
 *   all: every resident-facing business in NYC (current certifications), for the header
 * }
 * Facet counts follow every other filter, so "Eat & drink 212" is how many
 * results picking it would give.
 */
export function searchLocal(vendors, query, { today, zips, seed = today, pageSize = PAGE_SIZE }) {
  const words = keywordWords(query.q);
  const boroLabel = BOROUGH_BY_SLUG[query.boro];
  const origin = query.near ? zipPoint(zips, query.near) : null;
  const facets = {
    what: Object.fromEntries(CATEGORIES.map((c) => [c.key, 0])),
    own: Object.fromEntries(OWNERS.map((o) => [o.key, 0])),
    boroughs: Object.fromEntries(BOROUGHS.map((b) => [b.slug, 0])),
    outside: 0
  };
  const slugOf = Object.fromEntries(BOROUGHS.map((b) => [b.label, b.slug]));
  const matches = [];
  let all = 0;

  for (const row of prepare(vendors)) {
    const r = row.record;
    if (certStatus(r, today) === "lapsed") continue;
    if (r.borough) all++;
    const match = words.length ? keywordMatch(words, row.hay) : null;
    const ok = {
      what: !query.what || row.kind.cat === query.what,
      own: !query.own.length || query.own.some((k) => row.owners.includes(k)),
      q: !words.length || match !== null,
      boro: boroLabel ? r.borough === boroLabel : (query.outside || Boolean(r.borough))
    };
    const allBut = (skip) => Object.entries(ok).every(([k, v]) => v || k === skip);
    if (allBut("what")) facets.what[row.kind.cat]++;
    if (allBut("own")) for (const k of row.owners) facets.own[k]++;
    if (allBut("boro")) {
      if (r.borough) facets.boroughs[slugOf[r.borough]]++;
      else facets.outside++;
    }
    if (allBut(null)) {
      const point = origin && zipPoint(zips, r.zip);
      matches.push({ row, match, miles: point ? haversineMiles(origin, point) : null });
    }
  }

  // Nearest first (to a tenth of a mile, so a whole ZIP ties), then the best
  // keyword match, then places customers visit (walk; most of the list is
  // contractors and agencies), then the easiest to reach, then a shuffle that
  // changes daily.
  // A business whose ZIP has no centroid goes after every measured one.
  const byDistance = (a, b) => {
    if (a.tenth === b.tenth) return 0;
    if (a.tenth == null) return 1;
    if (b.tenth == null) return -1;
    return a.tenth - b.tenth;
  };
  const ranked = matches.map((m) => ({ ...m, tenth: m.miles == null ? null : Math.round(m.miles * 10), tie: tieBreak(m.row.record.id, seed) }))
    .sort((a, b) => byDistance(a, b) ||
      (MATCH_RANK[b.match] ?? 0) - (MATCH_RANK[a.match] ?? 0) ||
      Number(b.row.kind.walk) - Number(a.row.kind.walk) ||
      reach(b.row.record) - reach(a.row.record) ||
      a.tie - b.tie || a.row.record.id.localeCompare(b.row.record.id));

  const pages = Math.max(1, Math.ceil(ranked.length / pageSize));
  const page = Math.min(query.page ?? 1, pages);
  return {
    total: ranked.length,
    page,
    pages,
    pageSize,
    results: ranked.slice((page - 1) * pageSize, page * pageSize).map((m) => cardSummary(m.row.record, m.row.kind, m.miles)),
    facets,
    all
  };
}

/*
 * The detail panel's fields for one cleaned vendor (cleanVendor in
 * shop-diverse/clean.js, read live), or null when it isn't a business
 * residents would use or its certification has lapsed. Procurement fields
 * (codes, bonding, past clients, contact person) are left out, and so is the
 * street address of a business customers don't visit.
 */
export function localDetail(v, today) {
  const kind = v && kindOf(v);
  if (!kind || certStatus(v, today) === "lapsed") return null;
  const years = yearsInBusiness(v.established, today);
  return {
    id: v.id,
    name: displayName(v),
    ...(v.dba && { legalName: v.name }),
    kind: kind.label,
    cat: kind.cat,
    owners: ownerLabels(v),
    place: placeName(v),
    ...(v.zip && { zip: v.zip }),
    ...(kind.walk && v.address1 && { street: [v.address1, v.address2].filter(Boolean).join(", ") }),
    ...(v.phone && { phone: v.phone }),
    ...(v.website && { website: v.website }),
    ...(v.description && { description: v.description }),
    ...(v.established && { since: v.established.slice(0, 4) }),
    ...(years != null && { years }),
    ...(v.renewals?.length && { renewal: v.renewals.at(-1) })
  };
}
