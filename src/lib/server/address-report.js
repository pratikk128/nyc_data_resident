/*
 * The address report's "nearest" cards in one small response: the nearest
 * water sampling station with its last 12 months, the nearest help site of
 * each kind, the nearest public schools, and the nearest park amenity of each kind. Each reads its dashboard's own
 * data through the same loaders as that dashboard's API (KV, edge cached,
 * rate limited), and the server keeps only what the card shows, so the
 * browser never downloads the full station, help, school or amenity lists.
 *
 * A part that fails is reported on its own ({ failed, error }); the other
 * cards still show.
 */
import { getStations, stationDetails } from "./water.js";
import { loadSearch as loadHelp } from "./help-near-me.js";
import { loadSearch as loadSchools } from "./schools.js";
import { loadSearch as loadParks } from "./park-amenities.js";
import { RateLimited, RATE_LIMITED_TEXT } from "./rate-limit.js";
import { nearestStation, helpCard, nearestSchools, nearestParks, SHOW_WATER } from "../address-report/report.js";
import { normalizeQuery } from "../schools/filter.js";
import { plainDescription } from "../water/stats.js";
import sitesFile from "../../data/water-sites.json";

export const NEAREST_TTL = 3600;
const WATER_DOWN_TEXT = "Drinking water results aren’t available right now. Try again later.";

// Active sampling stations (in the daily stations job) with a location: { site, place, borough, lat, lon }.
async function activeStations() {
  const active = new Set(Object.keys((await getStations()).totals ?? {}));
  return sitesFile.sites
    .filter((s) => active.has(s.site) && s.lat != null && s.lon != null)
    .map((s) => ({ site: s.site, place: plainDescription(s.description), borough: s.borough, lat: s.lat, lon: s.lon }));
}

// → { station: nearestStation() or null, data: /api/water/stations for it or null }
async function water(spot) {
  const station = nearestStation(await activeStations(), spot);
  return { station, data: station ? await stationDetails([station.site]) : null };
}

// → { sites: helpCard(), with only what the card shows }
async function help(spot, requestUrl, ctx, clientAddress) {
  const { sites } = await loadHelp(spot, requestUrl, ctx, clientAddress);
  return {
    sites: helpCard(sites).map(({ kind, name, miles, address, borough, zip, lat, lon }) => ({ kind, name, miles, address, borough, zip, lat, lon }))
  };
}

// → { schools: nearestSchools() }, from every school on the School Quality map
async function schools(spot, requestUrl, ctx, clientAddress) {
  const { query } = normalizeQuery(new URLSearchParams());
  const { points } = await loadSchools(query, { view: "map" }, requestUrl, ctx, clientAddress);
  return { schools: nearestSchools(points, spot) };
}

/*
 * → { parks: nearestParks(), partial }, from Park Amenities Near Me's search (every
 * amenity within a mile, and the nearest of each kind). partial: some kind's dataset
 * couldn't be read, so the answer shouldn't be cached; none of them read is a failure.
 */
async function parks(spot, requestUrl, ctx, clientAddress) {
  const { amenities, sources } = await loadParks(spot, requestUrl, ctx, clientAddress);
  if (sources.every((s) => s.error)) throw new Error("No park amenity dataset could be read");
  return { parks: nearestParks(amenities), partial: sources.some((s) => s.error) };
}

function failed(err, text = null) {
  if (err instanceof RateLimited) return { failed: true, error: RATE_LIMITED_TEXT };
  console.error(err);
  return { failed: true, error: text };
}

/*
 * spot: { lat, lon }, rounded to about a block (report.js spotFromParams()).
 * → { water, help, schools, parks }, each as above or { failed: true, error: text or null };
 * no water while SHOW_WATER is off (the water dataset isn't asked).
 */
export async function loadNearest(spot, requestUrl, ctx, clientAddress) {
  const [w, h, s, p] = await Promise.allSettled([
    SHOW_WATER ? water(spot) : null,
    help(spot, requestUrl, ctx, clientAddress),
    schools(spot, requestUrl, ctx, clientAddress),
    parks(spot, requestUrl, ctx, clientAddress)
  ]);
  return {
    ...(SHOW_WATER && { water: w.status === "fulfilled" ? w.value : failed(w.reason, WATER_DOWN_TEXT) }),
    help: h.status === "fulfilled" ? h.value : failed(h.reason),
    schools: s.status === "fulfilled" ? s.value : failed(s.reason),
    parks: p.status === "fulfilled" ? p.value : failed(p.reason)
  };
}
