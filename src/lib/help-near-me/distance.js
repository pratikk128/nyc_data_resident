/*
 * Distances and what the list shows: nearest first, a few per category,
 * widening the radius when nothing's inside it. Pure and browser-safe; the
 * API (src/lib/server/help-near-me.js) uses the same functions to pick what
 * to send, the page script to pick what to show.
 */
import { RADII, MAX_RADIUS, FAR_PER_CATEGORY, PER_CATEGORY, CATEGORY_KEYS } from "./config.js";

const EARTH_RADIUS_MILES = 3958.7613;
const RAD = Math.PI / 180;

// Great-circle distance between two { lat, lon } points, in miles.
export function haversineMiles(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Sites with a point, each with .miles from the spot, nearest first (ties by name, so the order is stable).
export function byDistance(sites, point) {
  return sites
    .filter((s) => s.lat != null && s.lon != null)
    .map((s) => ({ ...s, miles: Math.round(haversineMiles(point, s) * 1000) / 1000 }))
    .sort((a, b) => a.miles - b.miles || String(a.name).localeCompare(String(b.name)));
}

/*
 * What the API sends for a spot: every site within MAX_RADIUS, plus for each
 * category with none that close, its nearest FAR_PER_CATEGORY anywhere (so the
 * page can say how far the nearest one is). Nearest first.
 */
export function sitesNear(sites, point) {
  const sorted = byDistance(sites, point);
  const near = sorted.filter((s) => s.miles <= MAX_RADIUS);
  const have = new Set(near.map((s) => s.category));
  const far = CATEGORY_KEYS.filter((k) => !have.has(k))
    .flatMap((k) => sorted.filter((s) => s.category === k).slice(0, FAR_PER_CATEGORY));
  return [...near, ...far].sort((a, b) => a.miles - b.miles);
}

// "0.4 mi", "Under 0.1 mi", "12 mi"
export function milesText(miles) {
  if (miles < 0.1) return "Under 0.1 mi";
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

// "½ mi", "1 mi", "2 mi"
export const radiusText = (r) => (r === 0.5 ? "½ mi" : r === 0.25 ? "¼ mi" : `${r} mi`);

/*
 * The list for the chosen categories and radius. sorted: byDistance() output.
 *   pages  how many times "Show more" was pressed, plus one
 * → {
 *     radius     the radius used: the chosen one, or the next wider one with something in it
 *     widened    null | "radius" (nothing inside the chosen radius) | "anywhere" (nothing within MAX_RADIUS)
 *     list       nearest perCategory × pages per category, nearest first (temporarily closed last)
 *     counts     { [category]: open sites within the radius used }, for the chips (temporarily closed left out)
 *     inRadius   every site of the chosen categories within the radius used
 *     missing    [{ key, miles }] chosen categories with nothing within the radius used, and how far the nearest is
 *     more       true when "Show more" would add something
 *     moreOf     the categories it would add to
 *   }
 */
export function selectView(sorted, { categories, radius, pages = 1, perCategory = PER_CATEGORY }) {
  const chosen = new Set(categories.length ? categories : CATEGORY_KEYS);
  const pool = sorted.filter((s) => chosen.has(s.category));
  const within = (r) => pool.filter((s) => s.miles <= r);

  let used = radius, widened = null;
  if (!within(radius).length) {
    const wider = RADII.find((r) => r > radius && within(r).length);
    if (wider) { used = wider; widened = "radius"; }
    else if (pool.length) widened = "anywhere";
  }

  const counts = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0]));
  for (const s of sorted) if (s.miles <= used && !s.closed) counts[s.category]++;

  const inRadius = widened === "anywhere" ? [] : within(used);
  const take = perCategory * pages;
  const list = [];
  const moreOf = [];
  for (const k of chosen) {
    const ofKind = widened === "anywhere" ? pool.filter((s) => s.category === k) : inRadius.filter((s) => s.category === k);
    list.push(...ofKind.slice(0, take));
    if (ofKind.length > take) moreOf.push(k);
  }
  // Temporarily closed sites after the open ones.
  list.sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0) || a.miles - b.miles || String(a.name).localeCompare(String(b.name)));

  const missing = [...chosen]
    .filter((k) => !list.some((s) => s.category === k))
    .map((k) => ({ key: k, miles: pool.find((s) => s.category === k)?.miles ?? null }));

  return { radius: used, widened, list, counts, inRadius, missing, more: moreOf.length > 0, moreOf };
}
