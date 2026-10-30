/*
 * The help finder script's decisions (HelpFinder.astro): the URL round-trip
 * and the words around the results. Pure, so the tests cover them without a
 * browser; the script does the DOM work.
 *
 * URL: ?lat=40.846&lon=-73.895&r=2&cat=snap,older (no cat: every category),
 * or ?boro=bronx&cat=snap for a whole borough (no spot, no radius).
 * The spot is rounded to about a block; a typed address never goes in the URL.
 */
import { RADII, DEFAULT_RADIUS, MAX_RADIUS, CATEGORY_KEYS, categoryOf, boroughOf } from "./config.js";
import { milesText, radiusText } from "./distance.js";
import { inCityLimits } from "./in-city.js";
import { count } from "../format.js";

const round3 = (n) => Math.round(n * 1e3) / 1e3;

export function normalizeQuery(params) {
  const lat = Number(params.get("lat")), lon = Number(params.get("lon"));
  const boro = boroughOf(params.get("boro"))?.key ?? null;
  // A borough wins over a spot: the two don't mix.
  const hasPoint = !boro && params.has("lat") && params.has("lon") && Number.isFinite(lat) && Number.isFinite(lon) && inCityLimits(lat, lon);
  const r = Number(params.get("r"));
  const cats = String(params.get("cat") ?? "").split(",").filter((k) => CATEGORY_KEYS.includes(k));
  return {
    lat: hasPoint ? round3(lat) : null,
    lon: hasPoint ? round3(lon) : null,
    boro,
    r: RADII.includes(r) ? r : DEFAULT_RADIUS,
    cats: cats.length === CATEGORY_KEYS.length ? [] : [...new Set(cats)]
  };
}

export function queryToParams(q) {
  const p = new URLSearchParams();
  if (q.boro) p.set("boro", q.boro);
  else if (q.lat != null) { p.set("lat", String(q.lat)); p.set("lon", String(q.lon)); }
  if (!q.boro && q.r !== DEFAULT_RADIUS) p.set("r", String(q.r));
  if (q.cats.length) p.set("cat", q.cats.join(","));
  return p;
}

export const pointQuery = (q, lat, lon) => ({ ...q, lat: round3(lat), lon: round3(lon), boro: null });
export const boroughQuery = (q, boro) => ({ ...q, lat: null, lon: null, boro });

// What the search API is asked for, and the cache key for it: "lat=…&lon=…", "boro=bronx", or "" (nothing picked).
export const searchKey = (q) => (q.boro ? `boro=${q.boro}` : q.lat == null ? "" : `lat=${q.lat}&lon=${q.lon}`);

// Clicking a chip: "All" clears the choice; a category toggles (and none left means all again).
export function toggleCategory(cats, key) {
  if (key === "all") return [];
  const next = cats.includes(key) ? cats.filter((k) => k !== key) : [...cats, key];
  return next.length === CATEGORY_KEYS.length ? [] : CATEGORY_KEYS.filter((k) => next.includes(k));
}

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const where = (label) => (label ? `of ${label}` : "of the spot you picked");

/*
 * The line above the list, from selectView()'s answer:
 *   "12 places within 2 mi of 350 5th Avenue. Showing the nearest 5 of each kind."
 *   "Nothing within ½ mi, so we looked farther: 4 places within 1 mi of …"
 * Temporarily closed places are counted apart: "3 places within 1 mi of …, plus 1 temporarily closed."
 * A borough: "240 places in the Bronx. Showing 5 of each kind first, A to Z."
 */
export function summaryText(view, query, placeLabel) {
  if (query.boro) {
    const n = view.inRadius.length;
    const closed = view.inRadius.filter((s) => s.closed).length;
    const lead = `${plural(n - closed, "place")} ${boroughOf(query.boro).inText}` + (closed ? `, plus ${count(closed)} temporarily closed` : "") + ".";
    return view.more ? `${lead} Showing a few of each kind first, A to Z.` : lead;
  }
  if (view.widened === "anywhere") {
    return `Nothing within ${radiusText(query.r)} ${where(placeLabel)}, or within ${radiusText(MAX_RADIUS)}. These are the nearest anywhere in the city.`;
  }
  const n = view.inRadius.length;
  const closed = view.inRadius.filter((s) => s.closed).length;
  const found = `${plural(n - closed, "place")} within ${radiusText(view.radius)} ${where(placeLabel)}` +
    (closed ? `, plus ${count(closed)} temporarily closed` : "");
  const lead = view.widened === "radius" ? `Nothing within ${radiusText(query.r)}, so we looked farther: ${found}.` : `${found}.`;
  return view.more || view.list.length < n ? `${lead} Showing the nearest of each kind first.` : lead;
}

/*
 * Chosen kinds with nothing in the list: "No Drop-In Centers within 2 mi. The nearest is 3.4 mi away."
 * → [{ key, text, miles }]
 */
export function missingNotes(view, query = {}) {
  return view.missing.map(({ key, miles }) => {
    const label = categoryOf(key).label;
    const text = query.boro
      ? `No ${label} listed ${boroughOf(query.boro).inText}.`
      : miles == null
      ? `No ${label} found in the city’s list.`
      : `No ${label} within ${radiusText(view.radius)}. The nearest is ${milesText(miles)} away.`;
    return { key, text, miles };
  });
}

// The next radius that would reach `miles`, or null when it's past the widest.
export const radiusFor = (miles) => RADII.find((r) => r >= miles) ?? null;

export const chipLabel = (label, n, query = {}) =>
  `${label}: ${plural(n, "place")} ${query.boro ? boroughOf(query.boro).inText : "nearby"}`;

// "Show more: Youth programs" when only one kind has more, else "Show more of each kind".
export const moreText = (view) =>
  view.moreOf.length === 1 ? `Show more: ${categoryOf(view.moreOf[0]).short}` : "Show more of each kind";

// A short label mid-sentence: "Drop-in centers" → "drop-in centers", "NYCHA community centers" kept.
export const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/*
 * Beside the radius buttons when the list isn't for the one picked
 * (selectView() widened it), so the buttons and the map's ring agree; null otherwise.
 */
export function radiusNote(view, query) {
  if (view.widened === "radius") return `Nothing within ${radiusText(query.r)}, so showing ${radiusText(view.radius)}`;
  if (view.widened === "anywhere") return `Nothing within ${radiusText(MAX_RADIUS)}, so showing the nearest anywhere`;
  return null;
}

export const pendingText = "Type an address or ZIP code above, use your location, or pick a borough, to see help nearby.";
