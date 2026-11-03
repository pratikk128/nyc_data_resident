/*
 * The way into the address report (/address/) from a dashboard that's on a
 * spot or a ZIP: DashboardLayout's "See everything about this address" link
 * ([data-report-link], with the reportLink prop), pointed at the same place.
 * Browser-safe and small, so any dashboard can import it.
 *
 * A dashboard with the place in its URL (?lat=&lon=, Restaurant
 * Inspections' ?lat=&lng=, or ?zip=) calls syncReportLink() after each URL
 * change; one without (Building Report) calls showReportLink(spot).
 */
import { inCityLimits } from "../in-city.js";
import { isNycZip } from "../complaints311/location-input.js";

const round3 = (n) => Math.round(n * 1e3) / 1e3;

// The spot in the URL, rounded to about a block, or null.
export function spotFromParams(params) {
  const lonKey = params.get("lon") ? "lon" : "lng";
  const lat = Number(params.get("lat")), lon = Number(params.get(lonKey));
  if (!params.get("lat") || !params.get(lonKey) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return inCityLimits(lat, lon) ? { lat: round3(lat), lon: round3(lon) } : null;
}

export const spotToParams = ({ lat, lon }) => new URLSearchParams({ lat: String(round3(lat)), lon: String(round3(lon)) });

// A spot opens the report on it; a ZIP is handed over the way the landing page's box does (#q=, looked up there).
export const reportHref = (place) => (place.zip ? `/address/#q=${place.zip}` : `/address/?${spotToParams(place)}`);

// The place in a dashboard's URL: its spot, else its ZIP, else null (a borough, a street).
export function placeFromParams(params) {
  const zip = params.get("zip");
  return spotFromParams(params) ?? (zip && isNycZip(zip) ? { zip } : null);
}

// The link on a spot or { zip }, or hidden with neither.
export function showReportLink(place) {
  const ok = place && (place.zip ? isNycZip(place.zip) : inCityLimits(place.lat, place.lon));
  for (const el of document.querySelectorAll("[data-report-link]")) {
    el.hidden = !ok;
    if (ok) el.querySelector("a").href = reportHref(place);
  }
}

let watching = false;
export function syncReportLink() {
  showReportLink(placeFromParams(new URLSearchParams(location.search)));
  // Back and Forward change the URL without the dashboard writing it.
  if (!watching) addEventListener("popstate", () => syncReportLink());
  watching = true;
}
