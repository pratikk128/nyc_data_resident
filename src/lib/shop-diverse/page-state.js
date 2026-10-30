/*
 * The finder script's decisions (ShopDiverseFinder.astro): the URL for a
 * view, what the form asks for, whether the browser kept edited fields,
 * what Back/Forward does to the list and the detail panel, and how closing
 * the panel leaves history, and the shortlist. Pure functions, so the tests
 * cover them without a browser; the script does the DOM work.
 */
import { normalizeQuery, queryToParams, codesValid } from "./filter.js";
import { CERTS, BOROUGHS, AMOUNT_TIERS, MAX_EXPORT } from "./config.js";

export const BASE = "/shop-diverse/";

const DEFAULT_QUERY = () => normalizeQuery(new URLSearchParams()).query;

// The page's path and query for a view; extra adds parameters such as biz.
export function pageUrl(query, extra = {}) {
  const p = queryToParams(query);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
}

// The form's fields (FormData entries) and the sort menu, which sits outside
// the form → normalizeQuery()'s { query } or { error }. A half-typed ZIP or
// code ("2", "plumbing") doesn't filter yet, and normalizeQuery() drops any
// ZIP outside Recommended.
export function formQuery(entries, sort) {
  const p = new URLSearchParams();
  for (const [k, v] of entries) if (typeof v === "string" && v) p.append(k, v);
  p.set("sort", sort);
  if (!/^\d{5}$/.test((p.get("zip") ?? "").trim())) p.delete("zip");
  if (!codesValid(p.get("code"))) p.delete("code");
  return normalizeQuery(p);
}

// On load: the query to search for, or null when the server's view stands.
// initial is the server's { query, loaded }; fromForm is formQuery()'s query
// (null on an error). The browser may have kept edited fields (back/forward
// cache, autofill), and those win, on the server's page.
export function startQuery(initial, fromForm) {
  const page = initial.query.page;
  if (fromForm && pageUrl({ ...fromForm, page }) !== pageUrl(initial.query)) return { ...fromForm, page };
  return initial.loaded ? null : initial.query;
}

/*
 * Back/Forward landed on `search` (location.search). state: { query, currentId
 * (the business shown in the panel, or null), dialogOpen }. →
 *   query: the list's new query, or null if the list stays
 *   open:  a business id to load into the panel, or null
 *   close: true to close the panel
 */
export function popstateAction(search, { query, currentId, dialogOpen }) {
  const params = new URLSearchParams(search);
  const next = normalizeQuery(params).query ?? DEFAULT_QUERY();
  const biz = params.get("biz");
  return {
    query: pageUrl(next) !== pageUrl(query) ? next : null,
    open: biz && biz !== currentId ? biz : null,
    close: !biz && dialogOpen
  };
}

// Closing the panel: "back" when a card pushed its history entry, so Back
// doesn't reopen it; "replace" (drop ?biz= in place) for a panel the page
// arrived with; null when the URL has no ?biz= (Back already removed it).
export function closeAction(search, historyState) {
  if (!new URLSearchParams(search).get("biz")) return null;
  return historyState?.fromList ? "back" : "replace";
}

// "1m" → "$1M+"
const tierLabel = (value) => AMOUNT_TIERS.find((t) => t.value === value).label.replace(" or more", "+");

// One chip per active filter (their number is on the phones' Filters button): { label, query } where query is this view
// without that filter, back on page 1. normalizeQuery() drops what depends
// on it (the subcategory with its category, ethnicities with MBE, "both"
// with either certification).
export function activeFilters(query) {
  const chip = (label, change) => ({
    label,
    query: normalizeQuery(queryToParams({ ...query, ...change, page: 1 })).query
  });
  return [
    ...query.who.map((c) => chip(CERTS[c].label, { who: query.who.filter((w) => w !== c) })),
    query.match === "all" && chip("Both women- and minority-owned", { match: "any" }),
    ...query.eth.map((e) => chip(`Owner: ${e}`, { eth: query.eth.filter((x) => x !== e) })),
    query.cat && chip(query.cat, { cat: "", sub: "" }),
    query.sub && chip(query.sub, { sub: "" }),
    query.q && chip(`Keyword: “${query.q}”`, { q: "" }),
    ...query.code.map((c) => chip(`Code ${c}`, { code: query.code.filter((x) => x !== c) })),
    query.bond && chip(`Bonding ${tierLabel(query.bond)}`, { bond: "" }),
    query.contract && chip(`Past contract ${tierLabel(query.contract)}`, { contract: "" }),
    query.union && chip("Union signatory", { union: false }),
    query.boro && chip(BOROUGHS.find((b) => b.slug === query.boro).label, { boro: "" }),
    query.zip && chip(`Near ${query.zip}`, { zip: "" }),
    query.lapsed && chip("Including lapsed", { lapsed: false })
  ].filter(Boolean);
}

// A click the script handles; one with a modifier key or another button
// opens the link the browser's way (new tab, window).
export const plainClick = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey) && (e.button ?? 0) === 0;

// ---------- Shortlist ----------
// Kept in the visitor's browser (localStorage) as [{ id, name }], oldest
// first, up to MAX_EXPORT businesses: the most one CSV holds.
export const SHORTLIST_KEY = "shop-diverse:shortlist";

// Stored text → the list; anything malformed is dropped, never thrown.
export function parseShortlist(raw) {
  let items;
  try { items = JSON.parse(raw ?? "[]"); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.filter((i) => /^\d{1,12}$/.test(i?.id ?? "") && typeof i.name === "string" && !seen.has(i.id) && seen.add(i.id))
    .slice(0, MAX_EXPORT);
}

// Adds the business, or removes it if it's there. → { list, full } where
// full is true when the list was already at MAX_EXPORT and nothing changed.
export function toggleShortlist(list, item) {
  if (list.some((i) => i.id === item.id)) return { list: list.filter((i) => i.id !== item.id), full: false };
  if (list.length >= MAX_EXPORT) return { list, full: true };
  return { list: [...list, { id: item.id, name: item.name }], full: false };
}

export const EXPORT_PATH = "/api/shop-diverse/export";
export const shortlistExportUrl = (list) => `${EXPORT_PATH}?ids=${list.map((i) => i.id).join(",")}`;
// The search's first MAX_EXPORT results, whatever page is showing.
export const searchExportUrl = (query) => {
  const p = queryToParams(query, { page: false });
  return p.toString() ? `${EXPORT_PATH}?${p}` : EXPORT_PATH;
};
