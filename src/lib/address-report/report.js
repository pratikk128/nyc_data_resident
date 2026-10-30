/*
 * The address report (/address/): one spot, a short answer from each
 * dashboard that works by location, and a link into the full dashboard.
 * Each card's data comes from that dashboard's own API; this file picks what
 * the card shows. Pure and browser-safe, so the tests cover it.
 *
 * URL: ?lat=40.748&lon=-73.986, rounded to about a block. A typed address
 * never goes in the URL (it would sit in browser history and shared links).
 */
import { inCityLimits } from "../in-city.js";
import { topTypes, openShare, compareShares } from "../complaints311/stats.js";
import { typeLabel } from "../complaints311/labels.js";
import { MIN_IMMEDIATE_REQUESTS } from "../complaints311/config.js";
import { WINDOWS as CLOSURE_WINDOWS } from "../street-closures/config.js";
import { windowRange, blocksInView, sortBlocks } from "../street-closures/closures.js";
import { CATEGORIES as HELP_CATEGORIES } from "../help-near-me/config.js";
import { nearestSites, distanceMiles } from "../water/stats.js";
import { schoolPath } from "../schools/config.js";
import { gradeInfo } from "../restaurants/inspections.js";

const round3 = (n) => Math.round(n * 1e3) / 1e3;

// The spot in the URL, or null.
export function spotFromParams(params) {
  const lat = Number(params.get("lat")), lon = Number(params.get("lon"));
  if (!params.get("lat") || !params.get("lon") || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return inCityLimits(lat, lon) ? { lat: round3(lat), lon: round3(lon) } : null;
}

export const spotToParams = ({ lat, lon }) => new URLSearchParams({ lat: String(round3(lat)), lon: String(round3(lon)) });

// Each dashboard, opened on the same spot.
export function dashboardLinks({ lat, lon }, { waterSite = null } = {}) {
  const at = `lat=${round3(lat)}&lon=${round3(lon)}`;
  return {
    complaints: `/311-complaints/?${at}&area=immediate`,
    closures: `/street-closures/?${at}&r=0.25`,
    help: `/help-near-me/?${at}`,
    water: `/drinking-water/near-me?${at}${waterSite ? `&sites=${encodeURIComponent(waterSite)}` : ""}`,
    restaurants: `/restaurant-inspections/?lat=${round3(lat)}&lng=${round3(lon)}`,
    schools: `/school-quality/?view=map&${at}`
  };
}

// ---------- 311 ----------

// /api/311/area (¼ mile, last 12 months) → { total, top: [{ key, label, count }], openShare }
export function complaintsCard(area, n = 3) {
  return { total: area.total, top: topTypes(area.types ?? {}, n), openShare: openShare(area.status) };
}

/*
 * What's more common within the ¼ mile than across the city, as on the 311
 * dashboard: area and city are { total, types }; city is /api/311/baseline's
 * .city. → { enough, above: up to n of [{ key, label, count, ratio }], highest first }.
 * Under MIN_IMMEDIATE_REQUESTS requests the shares are too noisy to compare.
 */
export function complaintsStandouts(area, city, n = 3) {
  if (!(area.total >= MIN_IMMEDIATE_REQUESTS) || !city?.types) return { enough: false, above: [] };
  const { above } = compareShares(area.types ?? {}, city.types);
  return { enough: true, above: above.slice(0, n).map((r) => ({ key: r.key, label: typeLabel(r.key), count: r.count, ratio: r.ratio })) };
}

// ---------- Street closures ----------

const WEEK = CLOSURE_WINDOWS.find((w) => w.key === "week").key;

/*
 * /api/street-closures/search near the spot (¼ mile) →
 *   { today: blocks closed today, week: blocks closed some day this week, nearest: up to n of those, nearest first }
 */
export function closuresCard(data, n = 3) {
  const today = data.today;
  const now = blocksInView(data.blocks ?? [], windowRange("today", today));
  const week = sortBlocks(blocksInView(data.blocks ?? [], windowRange(WEEK, today)), today);
  return { today: now.length, week: week.length, nearest: week.slice(0, n), date: today };
}

// ---------- Help near me ----------

// /api/help-near-me/search → the nearest open site of each kind of help, nearest first.
export function helpCard(sites, maxMiles = 2) {
  const out = [];
  for (const c of HELP_CATEGORIES) {
    const s = sites
      .filter((x) => x.category === c.key && !x.closed && x.miles != null && x.miles <= maxMiles)
      .sort((a, b) => a.miles - b.miles)[0];
    if (s) out.push({ ...s, kind: c.short });
  }
  return out.sort((a, b) => a.miles - b.miles);
}

// ---------- Drinking water ----------

// The nearest active sampling station, with .miles, or null.
export const nearestStation = (stations, spot) => nearestSites(stations, spot, 1)[0] ?? null;

// ---------- Restaurants ----------

/*
 * /api/restaurants/search near the spot (up to 25, nearest first) →
 *   { total, more, grades: { A, B, C, other }, nearest: up to n }
 * "other" is no grade yet or grade pending.
 */
export function restaurantsCard(data, n = 5) {
  const grades = { A: 0, B: 0, C: 0, other: 0 };
  for (const r of data.results ?? []) {
    const short = gradeInfo(r.grade?.grade).short;
    grades[short in grades ? short : "other"]++;
  }
  return { total: (data.results ?? []).length, more: Boolean(data.more), grades, nearest: (data.results ?? []).slice(0, n) };
}

// ---------- Schools ----------

/*
 * /api/schools/search?view=map points ([lat, lon, dbn, name, type]) → the n
 * nearest schools, nearest first: [{ dbn, name, type, miles, href }].
 * Nearest isn't zoned: the card says so and links to the DOE's zone lookup.
 */
export function nearestSchools(points, spot, n = 3) {
  return points
    .map(([lat, lon, dbn, name, type]) => ({ dbn, name, type, miles: distanceMiles(spot, { lat, lon }), href: schoolPath(dbn) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, n);
}

// ---------- The place ----------

/*
 * GeoSearch's reverse lookup (/v2/reverse) near the spot → "Midtown West, Manhattan",
 * or null. Names the spot in a shared link or "Use my location" without an
 * address: the neighborhood of the nearest address GeoSearch knows.
 */
export function neighborhoodName(features) {
  const p = (features ?? []).map((f) => f.properties ?? {}).find((x) => x.neighbourhood);
  return p ? [p.neighbourhood, p.borough].filter(Boolean).join(", ") : null;
}

// ---------- Words ----------

// "0.3 mi", "under 0.1 mi"
export const milesText = (miles) => (miles < 0.1 ? "under 0.1 mi" : `${miles.toFixed(1)} mi`);
