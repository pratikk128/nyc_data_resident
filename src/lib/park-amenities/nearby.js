/*
 * Distances and what the page shows: nearest first, the nearest of each
 * category, and a wider radius when nothing's inside the chosen one. Pure
 * and browser-safe; the API (src/lib/server/park-amenities.js) uses
 * amenitiesNear() to pick what to send, the page script selectView() to pick
 * what to show. Distances are straight-line, from the searched spot.
 */
import { RADII, MAX_RADIUS, FAR_PER_CATEGORY, PAGE_SIZE, CATEGORY_KEYS, categoryOf } from "./config.js";
import { haversineMiles, milesText, radiusText } from "../help-near-me/distance.js";

export { haversineMiles, milesText, radiusText };

// A distance past the radius, never rounded down to it: 0.51 mi outside ½ mi reads "0.51 mi", not "0.5 mi".
export function milesPast(miles, radius) {
  const t = milesText(miles);
  return parseFloat(t) <= radius ? `${(Math.ceil(miles * 100) / 100).toFixed(2)} mi` : t;
}

// Today in New York as month × 100 + day (Nov 2 → 1102), whatever the viewer's time zone.
function nycMonthDay(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get("month") * 100 + get("day");
}
const within = (n, [[m0, d0], [m1, d1]]) => n >= m0 * 100 + d0 && n <= m1 * 100 + d1;

/*
 * Whether a seasonal amenity usually runs on `date` (config.js season):
 *   → { state: "on" | "maybe" | "off", text, short }, or null (indoors, or not seasonal)
 */
export function seasonOf(a, date = new Date()) {
  const c = categoryOf(a.category);
  if (!c?.season || !c.seasonal(a.details)) return null;
  const n = nycMonthDay(date);
  const state = within(n, c.season.on) ? "on" : within(n, c.season.maybe) ? "maybe" : "off";
  return { state, text: c.season.text[state], short: state === "off" ? c.season.short : null };
}

// Amenities, each with .miles from the spot, nearest first (ties by name, so the order is stable).
export function byDistance(amenities, point) {
  return amenities
    .map((a) => ({ ...a, miles: Math.round(haversineMiles(point, a) * 1000) / 1000 }))
    .sort((a, b) => a.miles - b.miles || String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id));
}

/*
 * What the API sends for a spot: every amenity within MAX_RADIUS, plus for
 * each category with none that close, its nearest FAR_PER_CATEGORY anywhere
 * (so the page can say how far the nearest is). Nearest first.
 */
export function amenitiesNear(amenities, point) {
  const sorted = byDistance(amenities, point);
  const near = sorted.filter((a) => a.miles <= MAX_RADIUS);
  const have = new Set(near.map((a) => a.category));
  const far = CATEGORY_KEYS.filter((k) => !have.has(k))
    .flatMap((k) => sorted.filter((a) => a.category === k).slice(0, FAR_PER_CATEGORY));
  return [...near, ...far].sort((a, b) => a.miles - b.miles);
}

/*
 * The page for the chosen categories and radius. sorted: amenitiesNear() output.
 *   pages  how many times "Show more" was pressed, plus one
 * → {
 *     inRadius  every chosen amenity within the radius, nearest first (the map's pins)
 *     list      the first PAGE_SIZE × pages of them (the list)
 *     more      true when "Show more" would add something
 *     counts    { [category]: within the radius }, for the chips
 *     nearest   [{ key, amenity, inRadius }] per chosen category, in chip order (amenity null: none in the data)
 *     widenTo   the next radius with something in it, when nothing's inside this one (null otherwise)
 *   }
 */
export function selectView(sorted, { categories, radius, pages = 1, pageSize = PAGE_SIZE }) {
  const chosen = CATEGORY_KEYS.filter((k) => categories.includes(k));
  const pool = sorted.filter((a) => chosen.includes(a.category));
  const inRadius = pool.filter((a) => a.miles <= radius);
  const list = inRadius.slice(0, pageSize * pages);
  const counts = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0]));
  for (const a of sorted) if (a.miles <= radius) counts[a.category]++;
  const nearest = chosen.map((key) => {
    const amenity = pool.find((a) => a.category === key) ?? null;
    return { key, amenity, inRadius: Boolean(amenity) && amenity.miles <= radius };
  });
  const widenTo = inRadius.length || !chosen.length ? null : RADII.find((r) => r > radius && pool.some((a) => a.miles <= r)) ?? null;
  return { inRadius, list, more: inRadius.length > list.length, counts, nearest, widenTo };
}

// How many pages the list needs to include an amenity (one picked on the map past the first page).
export const pagesFor = (view, id, pageSize = PAGE_SIZE) => {
  const i = view.inRadius.findIndex((a) => a.id === id);
  return i < 0 ? null : Math.floor(i / pageSize) + 1;
};
