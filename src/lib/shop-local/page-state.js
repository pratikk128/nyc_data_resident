/*
 * The Shop Local script's decisions (LocalFinder.astro): the URL for a view,
 * what the form asks for, what Back/Forward does, and which ZIP "Use my
 * location" stands for. Pure functions, so the tests cover them without a
 * browser; the script does the DOM work.
 */
import { normalizeQuery, queryToParams, defaultQuery } from "./filter.js";
import { BASE } from "./config.js";
import { haversineMiles } from "../help-near-me/distance.js";
import { boroughFromZip } from "../shop-diverse/clean.js";

// The page's path and query for a view; extra adds parameters such as biz.
export function pageUrl(query, extra = {}) {
  const p = queryToParams(query);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
}

// The form's fields (FormData entries) → normalizeQuery()'s { query } or
// { error }. A half-typed ZIP doesn't filter yet.
export function formQuery(entries) {
  const p = new URLSearchParams();
  for (const [k, v] of entries) if (typeof v === "string" && v) p.append(k, v);
  if (!/^\d{5}$/.test((p.get("near") ?? "").trim())) p.delete("near");
  return normalizeQuery(p);
}

// What the ZIP box holds, once typed: "" (empty), "ok", "short" (still
// typing) or "outside" (five digits, but not a NYC ZIP).
export function zipState(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (!/^\d{5}$/.test(v)) return /^\d{0,4}$/.test(v) ? "short" : "outside";
  return boroughFromZip(v) ? "ok" : "outside";
}

// On load: the query to search for, or null when the server's view stands.
// The browser may have kept edited fields (back/forward cache, autofill).
export function startQuery(initial, fromForm) {
  const page = initial.query.page;
  if (fromForm && pageUrl({ ...fromForm, page }) !== pageUrl(initial.query)) return { ...fromForm, page };
  return initial.loaded ? null : initial.query;
}

/*
 * Back/Forward landed on `search`. state: { query, currentId, dialogOpen } →
 *   query: the list's new query, or null if the list stays
 *   open:  a business id to load into the panel, or null
 *   close: true to close the panel
 */
export function popstateAction(search, { query, currentId, dialogOpen }) {
  const params = new URLSearchParams(search);
  const next = normalizeQuery(params).query ?? defaultQuery();
  const biz = params.get("biz");
  return {
    query: pageUrl(next) !== pageUrl(query) ? next : null,
    open: biz && biz !== currentId ? biz : null,
    close: !biz && dialogOpen
  };
}

// Closing the panel: "back" when a card pushed its history entry, "replace"
// for a panel the page arrived with, null when the URL has no ?biz=.
export function closeAction(search, historyState) {
  if (!new URLSearchParams(search).get("biz")) return null;
  return historyState?.fromList ? "back" : "replace";
}

// "Use my location" → the NYC ZIP whose middle is closest, so only a ZIP
// goes in the URL, never the exact spot. zips: { "11216": [lat, lon] }
export function nearestZip(lat, lon, zips) {
  let best = null;
  let bestMiles = Infinity;
  for (const [zip, [zlat, zlon]] of Object.entries(zips)) {
    if (!boroughFromZip(zip)) continue;
    const miles = haversineMiles({ lat, lon }, { lat: zlat, lon: zlon });
    if (miles < bestMiles) { best = zip; bestMiles = miles; }
  }
  return best;
}

// A click the script handles; one with a modifier key opens the link the browser's way.
export const plainClick = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey) && (e.button ?? 0) === 0;
