/*
 * Shop Diverse NYC filters: the URL query (shared with the page, so a
 * filtered view can be shared as a link), the filtering itself, the counts
 * next to each filter option, the summary numbers and one page of results.
 * Pure functions; the server runs them over the daily vendor list.
 *
 * URL parameters (all optional):
 *   who=wbe,mbe   certifications to support; match=all requires both (default any)
 *   eth=black,asian  narrows the MBE side to these owner ethnicities
 *   cat, sub      NAICS sector and subsector, exactly as the dataset spells them
 *   q             keyword (name, DBA, description, industry)
 *   boro          a slug from BOROUGHS ("outside" = outside the five boroughs)
 *   zip           a 5-digit ZIP: that ZIP, then its borough, rank first
 *                 (Recommended only, so other sorts drop it)
 *   sort          recommended | az | newest | oldest
 *   lapsed=1      include certifications whose renewal dates have passed
 *   page          1-based
 */
import { BOROUGHS, MINORITY_ETHNICITIES, SORTS, PAGE_SIZE, MAX_KEYWORD_LENGTH } from "./config.js";
import { keywordWords, boroughFromZip } from "./clean.js";
import { haystack, keywordMatch, rankBusinesses, certStatus, displayName } from "./ranking.js";

const MAX_CATEGORY_LENGTH = 150;
const MAX_PAGE = 1000;

export const slug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ETHNICITY_BY_SLUG = Object.fromEntries(MINORITY_ETHNICITIES.map((e) => [slug(e), e]));
const BOROUGH_BY_SLUG = Object.fromEntries(BOROUGHS.map((b) => [b.slug, b.label]));

// "wbe,mbe", or the same name repeated (a plain form GET sends who=wbe&who=mbe).
const list = (params, key) =>
  [...new Set(params.getAll(key).join(",").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean))];

// URLSearchParams → { query } or { error }. Unknown values in lists are
// dropped rather than rejected, so an old link still opens.
export function normalizeQuery(params) {
  const get = (k) => params.get(k) ?? "";
  const query = {
    who: ["wbe", "mbe"].filter((c) => list(params, "who").includes(c)).map((c) => c.toUpperCase()),
    match: get("match") === "all" ? "all" : "any",
    eth: list(params, "eth").map((s) => ETHNICITY_BY_SLUG[s]).filter(Boolean),
    cat: get("cat").trim(),
    sub: get("sub").trim(),
    q: get("q").replace(/\s+/g, " ").trim(),
    boro: BOROUGH_BY_SLUG[get("boro")] ? get("boro") : "",
    zip: /^\d{5}$/.test(get("zip").trim()) ? get("zip").trim() : "",
    sort: SORTS.some((s) => s.value === get("sort")) ? get("sort") : "recommended",
    lapsed: get("lapsed") === "1",
    page: Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(get("page"))) || 1))
  };
  if (query.cat.length > MAX_CATEGORY_LENGTH || query.sub.length > MAX_CATEGORY_LENGTH) {
    return { error: "Pick a category from the list." };
  }
  if (query.q.length > MAX_KEYWORD_LENGTH) return { error: `Keep the keyword under ${MAX_KEYWORD_LENGTH} characters.` };
  if (!query.cat) query.sub = "";
  if (!query.who.includes("MBE")) query.eth = [];
  if (query.who.length < 2) query.match = "any";
  if (query.sort !== "recommended") query.zip = "";
  return { query };
}

// The inverse: only non-default values, in a fixed order, so equal queries
// make equal URLs (and share a cache entry).
export function queryToParams(query, { page = true } = {}) {
  const p = new URLSearchParams();
  if (query.who?.length) p.set("who", query.who.map((c) => c.toLowerCase()).join(","));
  if (query.match === "all" && query.who?.length > 1) p.set("match", "all");
  if (query.eth?.length) p.set("eth", [...query.eth].sort().map(slug).join(","));
  if (query.cat) p.set("cat", query.cat);
  if (query.sub) p.set("sub", query.sub);
  if (query.q) p.set("q", query.q);
  if (query.boro) p.set("boro", query.boro);
  if (query.zip) p.set("zip", query.zip);
  if (query.sort && query.sort !== "recommended") p.set("sort", query.sort);
  if (query.lapsed) p.set("lapsed", "1");
  if (page && query.page > 1) p.set("page", String(query.page));
  return p;
}

const boroughOf = (record) => record.borough ?? "Outside NYC";

// Certification filter, with the ethnicity choice narrowing the MBE side.
function matchesWho(record, query) {
  if (!query.who.length) return true;
  const certs = record.certs ?? [];
  const wbe = certs.includes("WBE");
  const mbe = certs.includes("MBE") && (!query.eth.length || query.eth.includes(record.ethnicity));
  const wants = { WBE: wbe, MBE: mbe };
  return query.match === "all" ? query.who.every((c) => wants[c]) : query.who.some((c) => wants[c]);
}

// Haystacks are built once per vendor list (per Worker isolate), not per request.
const haystacks = new WeakMap();
function haystacksFor(vendors) {
  let hay = haystacks.get(vendors);
  if (!hay) {
    hay = vendors.map(haystack);
    haystacks.set(vendors, hay);
  }
  return hay;
}

const countInto = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const sortedCounts = (map) => [...map].map(([label, count]) => ({ label, count }))
  .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

// Share of the list (0–1) with no NYC borough, after ZIPs fill in the ones
// the dataset left blank; null for an empty list.
export function outsideShare(vendors) {
  if (!vendors.length) return null;
  return vendors.filter((v) => !v.borough).length / vendors.length;
}

// What a result card needs.
export function cardSummary(record, today) {
  return {
    id: record.id,
    name: displayName(record),
    ...(record.dba && { legalName: record.name }),
    certs: record.certs ?? [],
    category: record.title || record.subsector || record.sector || "",
    excerpt: record.excerpt ?? "",
    place: record.borough ?? [record.city, record.state].filter(Boolean).join(", "),
    ...(certStatus(record, today) === "lapsed" && { lapsed: true })
  };
}

/*
 * Everything one view of the page shows. vendors: the cleaned list.
 * → {
 *   total, page, pages, results: [cardSummary],
 *   facets: { who: {WBE, MBE}, eth: [{label,count}], categories, subcategories, boroughs, lapsed },
 *   kpis: { total, wbe, mbe, both, outside }
 * }
 * Facet counts follow every other filter, so "Construction (412)" is how many
 * results picking Construction would give.
 */
export function searchBusinesses(vendors, query, { today, seed = today, pageSize = PAGE_SIZE }) {
  const hay = haystacksFor(vendors);
  const words = keywordWords(query.q);
  const boroLabel = BOROUGH_BY_SLUG[query.boro];

  const facets = {
    who: { WBE: 0, MBE: 0 },
    eth: new Map(),
    categories: new Map(),
    subcategories: new Map(),
    boroughs: new Map(),
    lapsed: 0
  };
  const matches = [];

  for (let i = 0; i < vendors.length; i++) {
    const r = vendors[i];
    const match = words.length ? keywordMatch(words, hay[i]) : null;
    const ok = {
      who: matchesWho(r, query),
      cat: !query.cat || r.sector === query.cat,
      sub: !query.sub || r.subsector === query.sub,
      q: !words.length || match !== null,
      boro: !boroLabel || boroughOf(r) === boroLabel,
      lapsed: query.lapsed || certStatus(r, today) !== "lapsed"
    };
    const allBut = (...skip) => Object.entries(ok).every(([k, v]) => v || skip.includes(k));

    if (allBut("who")) {
      const certs = r.certs ?? [];
      if (certs.includes("WBE")) facets.who.WBE++;
      if (certs.includes("MBE")) facets.who.MBE++;
    }
    // Ethnicity options count MBE firms only, under every filter but the ethnicity choice.
    if (allBut("who") && r.certs?.includes("MBE") && MINORITY_ETHNICITIES.includes(r.ethnicity) &&
        matchesWho(r, { ...query, eth: [] })) {
      countInto(facets.eth, r.ethnicity);
    }
    if (allBut("cat", "sub") && r.sector) countInto(facets.categories, r.sector);
    if (query.cat && allBut("sub") && r.subsector) countInto(facets.subcategories, r.subsector);
    if (allBut("boro")) countInto(facets.boroughs, boroughOf(r));
    if (allBut("lapsed") && !ok.lapsed) facets.lapsed++;
    if (allBut()) matches.push({ record: r, match });
  }

  const zipBorough = boroughFromZip(query.zip);
  const ranked = rankBusinesses(matches, { sort: query.sort, today, query, zipBorough, seed });
  const pages = Math.max(1, Math.ceil(ranked.length / pageSize));
  const page = Math.min(query.page ?? 1, pages);

  const kpis = { total: matches.length, wbe: 0, mbe: 0, both: 0, outside: 0 };
  for (const { record: r } of matches) {
    const certs = r.certs ?? [];
    const w = certs.includes("WBE"), m = certs.includes("MBE");
    if (w) kpis.wbe++;
    if (m) kpis.mbe++;
    if (w && m) kpis.both++;
    if (!r.borough) kpis.outside++;
  }

  return {
    total: matches.length,
    page,
    pages,
    pageSize,
    results: ranked.slice((page - 1) * pageSize, page * pageSize).map((row) => cardSummary(row.record, today)),
    facets: {
      who: facets.who,
      eth: MINORITY_ETHNICITIES.map((label) => ({ label, slug: slug(label), count: facets.eth.get(label) ?? 0 })),
      categories: sortedCounts(facets.categories),
      subcategories: sortedCounts(facets.subcategories),
      boroughs: BOROUGHS.map((b) => ({ ...b, count: facets.boroughs.get(b.label) ?? 0 })),
      lapsed: facets.lapsed
    },
    kpis
  };
}
