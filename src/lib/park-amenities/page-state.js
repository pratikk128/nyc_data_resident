/*
 * The amenity finder script's decisions (AmenityFinder.astro): the URL
 * round-trip and the words around the results. Pure, so the tests cover them
 * without a browser; the script does the DOM work.
 *
 * URL: ?lat=40.754&lon=-73.984&r=1&cat=pool,dog (no cat: every category;
 * cat= with nothing: none picked). The spot is rounded to about a block; a
 * typed address never goes in the URL.
 */
import { RADII, DEFAULT_RADIUS, CATEGORY_KEYS, categoryOf } from "./config.js";
import { milesText, milesPast, radiusText } from "./nearby.js";
import { inCityLimits } from "../in-city.js";
import { count } from "../format.js";

const round3 = (n) => Math.round(n * 1e3) / 1e3;

export function normalizeQuery(params) {
  const lat = Number(params.get("lat")), lon = Number(params.get("lon"));
  const hasPoint = params.has("lat") && params.has("lon") && Number.isFinite(lat) && Number.isFinite(lon) && inCityLimits(lat, lon);
  const r = Number(params.get("r"));
  const picked = String(params.get("cat") ?? "").split(",");
  return {
    lat: hasPoint ? round3(lat) : null,
    lon: hasPoint ? round3(lon) : null,
    r: RADII.includes(r) ? r : DEFAULT_RADIUS,
    // In chip order, each once.
    cats: params.has("cat") ? CATEGORY_KEYS.filter((k) => picked.includes(k)) : [...CATEGORY_KEYS]
  };
}

export function queryToParams(q) {
  const p = new URLSearchParams();
  if (q.lat != null) { p.set("lat", String(q.lat)); p.set("lon", String(q.lon)); }
  if (q.r !== DEFAULT_RADIUS) p.set("r", String(q.r));
  if (q.cats.length !== CATEGORY_KEYS.length) p.set("cat", q.cats.join(","));
  return p;
}

export const pointQuery = (q, lat, lon) => ({ ...q, lat: round3(lat), lon: round3(lon) });

// What the search API is asked for, and the cache key for it: "lat=…&lon=…", or "" (no spot yet).
export const searchKey = (q) => (q.lat == null ? "" : `lat=${q.lat}&lon=${q.lon}`);

// Clicking a chip turns its category on or off (none is allowed: the page asks for one);
// "All" turns every category on.
export function toggleCategory(cats, key) {
  if (key === "all") return [...CATEGORY_KEYS];
  const next = cats.includes(key) ? cats.filter((k) => k !== key) : [...cats, key];
  return CATEGORY_KEYS.filter((k) => next.includes(k));
}

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const where = (label) => (label ? `of ${label}` : "of the spot you picked");

/*
 * The line above the list, from selectView()'s answer:
 *   "38 amenities within ½ mi of 350 5th Avenue, nearest first."
 *   "80 amenities within 1 mi of 350 5th Avenue. Showing the nearest of each kind first."
 *   "Nothing within ½ mi of 350 5th Avenue."
 */
export function summaryText(view, query, placeLabel) {
  if (!query.cats.length) return "Pick at least one kind of amenity above.";
  const n = view.inRadius.length;
  if (!n) return `Nothing within ${radiusText(query.r)} ${where(placeLabel)}.`;
  const found = `${plural(n, "amenity", "amenities")} within ${radiusText(query.r)} ${where(placeLabel)}`;
  return view.list.length < n ? `${found}. Showing the nearest of each kind first.` : `${found}, nearest first.`;
}

/*
 * One "nearest of each" card's words. n: a selectView() nearest entry.
 *   "Pool · 0.3 mi" / "Pool · 1.4 mi (outside ½ mi)" / "Pool · none listed"
 * Outside the radius the distance never rounds down to it ("0.51 mi", milesPast()).
 */
export function nearestText(n, radius) {
  const one = categoryOf(n.key).one;
  if (!n.amenity) return { head: one, dist: "None listed", note: null };
  if (n.inRadius) return { head: one, dist: milesText(n.amenity.miles), note: null };
  return { head: one, dist: milesPast(n.amenity.miles, radius), note: `Outside ${radiusText(radius)}` };
}

/*
 * The empty list: what to say, and the wider radius to offer (null: none wider).
 *   "No pools within ½ mi. The nearest is 0.8 mi away." + widen to 1 mi
 * null with no kinds picked: the summary already asks for one.
 * note: the lists cover NYC Parks sites only, so a missing one isn't a failed search.
 */
export const PARKS_ONLY = "This page lists sites run by NYC Parks only, so playgrounds or fountains in other public spaces (like Bryant Park) aren’t here.";

export function emptyText(view, query) {
  if (!query.cats.length) return null;
  const kinds = query.cats.length === CATEGORY_KEYS.length ? "park amenities" : CATEGORY_KEYS.filter((k) => query.cats.includes(k)).map((k) => categoryOf(k).label.toLowerCase()).join(" or ");
  const miles = view.nearest.map((n) => n.amenity?.miles).filter((m) => m != null);
  // Nothing's inside the radius, so the nearest is past it.
  const nearest = miles.length ? ` The nearest is ${milesPast(Math.min(...miles), query.r)} away.` : "";
  return { text: `No ${kinds} within ${radiusText(query.r)}.${nearest}`, note: PARKS_ONLY, widen: view.widenTo };
}

export const chipLabel = (label, n, radius) => `${label}: ${count(n)} within ${radiusText(radius)}`;

export const pendingText = "Type an address or ZIP code above, or use your location, to see the park amenities nearest you.";
