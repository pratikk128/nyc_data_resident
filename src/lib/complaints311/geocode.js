/*
 * Turning typed text into a point, with NYC Planning Labs GeoSearch
 * (https://geosearch.planninglabs.nyc, free, no key, allows browser calls).
 *
 * GeoSearch only knows NYC addresses and places, and it always answers with
 * something: "11211" comes back as house number 11211 on some Queens street,
 * and "1600 Pennsylvania Ave, Washington DC" as an address on Pennsylvania Ave
 * in Brooklyn. So ZIPs and boroughs are handled before GeoSearch
 * (location-input.js), and a match only counts when its house number and
 * street agree with what was typed (chooseMatch()).
 *
 * resolveLocation() takes a search function so tests can pass canned results.
 */
import { BOROUGHS, boroughLabel } from "./config.js";
import { placeLabel, prettyStreet } from "./location-input.js";
import { inCityLimits } from "../in-city.js";

export const GEOSEARCH = "https://geosearch.planninglabs.nyc/v2";
export const MAX_SUGGESTIONS = 5;

// A GeoSearch feature → { lat, lon, houseNumber, street, name, borough, zip, label, bbl, bin }.
// bbl and bin (the tax lot and building, from the city's PAD file) are null for places that aren't addresses.
export function normalizeFeature(f) {
  const p = f.properties ?? {};
  const [lon, lat] = f.geometry?.coordinates ?? [];
  const borough = BOROUGHS.find((b) => b.label === p.borough)?.value ?? null;
  const place = {
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    houseNumber: p.housenumber ?? null,
    street: p.street ?? null,
    name: p.name ?? "",
    borough,
    zip: p.postalcode ?? null
  };
  return { ...place, label: placeLabel(place), bbl: p.addendum?.pad?.bbl ?? null, bin: p.addendum?.pad?.bin ?? null };
}

export async function geosearch(endpoint, text, { size = 10, signal, fetchFn = fetch } = {}) {
  const url = new URL(`${GEOSEARCH}/${endpoint}`);
  url.searchParams.set("text", text);
  if (endpoint === "search") url.searchParams.set("size", String(size));
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`GeoSearch returned ${res.status}`);
  const data = await res.json();
  return (data.features ?? []).map(normalizeFeature).filter((p) => Number.isFinite(p.lat) && inCityLimits(p.lat, p.lon));
}

// Up to 5 autocomplete suggestions, one per label.
export async function suggest(text, opts) {
  return dedupe(await geosearch("autocomplete", text, opts)).slice(0, MAX_SUGGESTIONS);
}

function dedupe(places) {
  const seen = new Set();
  return places.filter((p) => !seen.has(p.label) && seen.add(p.label));
}

// bbl only for a house-numbered address: a spot GeoSearch picked along a street or in a park isn't "your building".
export const buildingBbl = (p) => (p.houseNumber && p.bbl ? p.bbl : null);
export const placeToLocation = (p) => ({
  kind: "point", lat: p.lat, lon: p.lon, label: p.label, borough: p.borough, zip: p.zip,
  ...(buildingBbl(p) ? { bbl: buildingBbl(p) } : {})
});

// ---------- Matching ----------

const STREET_WORDS = new Set([
  "AVENUE", "AVE", "AV", "STREET", "ST", "ROAD", "RD", "BOULEVARD", "BLVD", "PLACE", "PL", "DRIVE", "DR",
  "LANE", "LN", "COURT", "CT", "TERRACE", "TER", "PARKWAY", "PKWY", "HIGHWAY", "HWY", "EXPRESSWAY", "EXPY",
  "WAY", "SQUARE", "SQ", "PLAZA", "PLZ", "EAST", "WEST", "NORTH", "SOUTH", "E", "W", "N", "S", "THE", "OF"
]);

// "5th Ave" → ["5"], "B'WAY" → ["BROADWAY"], "Atlantic Avenue" → ["ATLANTIC"]
function nameTokens(text) {
  return String(text ?? "").toUpperCase()
    .replace(/\bB'?WAY\b/g, "BROADWAY")
    .replace(/(\d+)(ST|ND|RD|TH)\b/g, "$1")
    .split(/[^A-Z0-9]+/)
    .filter((t) => t && !STREET_WORDS.has(t));
}

// The typed street (or place name) shares a word with the match's street or name.
export function streetMatches(typed, place) {
  const want = nameTokens(typed);
  if (!want.length) return true;
  const have = new Set([...nameTokens(place.street), ...nameTokens(place.name)]);
  return want.some((t) => have.has(t));
}

// Only places in the borough or ZIP that was given; if that leaves nothing, the ZIP is dropped first.
export function narrow(places, { borough, zip }) {
  let out = places;
  if (zip) {
    const inZip = out.filter((p) => p.zip === zip);
    if (inZip.length) return inZip;
  }
  if (borough) out = out.filter((p) => p.borough === borough);
  return out;
}

/*
 * parsed: an address or street from parseLocationInput(). places: normalized GeoSearch results.
 * → { status: "resolved", place, onStreet? }   onStreet: a spot picked along a street with no house number
 *   { status: "choose", reason: "ambiguous" | "inexact", suggestions }
 *   { status: "not-found" }
 */
export function chooseMatch(parsed, places) {
  const street = parsed.kind === "address" ? parsed.text.replace(/^\S+\s+/, "") : parsed.text;
  const candidates = dedupe(narrow(places, parsed).filter((p) => streetMatches(street, p)));
  if (!candidates.length) return { status: "not-found" };

  if (parsed.kind === "address") {
    const exact = candidates.filter((p) => String(p.houseNumber ?? "").toUpperCase() === parsed.houseNumber);
    if (!exact.length) return { status: "choose", reason: "inexact", suggestions: candidates.slice(0, MAX_SUGGESTIONS) };
    // "350 5th Ave" is in Manhattan and in Brooklyn: ask which.
    if (new Set(exact.map((p) => p.borough)).size > 1) {
      return { status: "choose", reason: "ambiguous", suggestions: exact.slice(0, MAX_SUGGESTIONS) };
    }
    return { status: "resolved", place: exact[0] };
  }

  // A street or place with a borough or ZIP: GeoSearch's top match there.
  if (parsed.borough || parsed.zip) return { status: "resolved", place: candidates[0], onStreet: true };
  // No borough: callers search each borough and pass one match per borough.
  if (new Set(candidates.map((p) => p.borough)).size === 1) return { status: "resolved", place: candidates[0], onStreet: true };
  return { status: "choose", reason: "ambiguous", suggestions: candidates.slice(0, MAX_SUGGESTIONS) };
}

/*
 * parsed → resolved location for the page, or a reason it couldn't be.
 *   { status: "resolved", location: { kind: "point" | "zip" | "borough", ... }, onStreet? }
 *   onStreet: the street's name when one spot was picked along it
 *   { status: "choose", reason, suggestions } | { status: "not-found" }
 * search(text, size) returns normalized places (defaults to GeoSearch).
 */
export async function resolveLocation(parsed, { search = (text, size) => geosearch("search", text, { size }) } = {}) {
  if (parsed.kind === "zip") return { status: "resolved", location: { kind: "zip", zip: parsed.zip, borough: parsed.borough ?? null } };
  if (parsed.kind === "borough") return { status: "resolved", location: { kind: "borough", borough: parsed.borough } };

  let places;
  if (parsed.kind === "street" && !parsed.borough && !parsed.zip) {
    // "Broadway" runs through four boroughs; GeoSearch alone would only offer Brooklyn.
    // Ask for it in each borough and keep each borough's top match.
    const perBorough = await Promise.all(BOROUGHS.map(async (b) => {
      const found = await search(`${parsed.text}, ${b.label}`, 5);
      return found.find((p) => p.borough === b.value && streetMatches(parsed.text, p));
    }));
    places = perBorough.filter(Boolean);
  } else {
    const where = [parsed.borough && boroughLabel(parsed.borough), parsed.zip].filter(Boolean).join(" ");
    const text = parsed.kind === "address" ? `${parsed.houseNumber} ${parsed.text.replace(/^\S+\s+/, "")}` : parsed.text;
    places = await search(where ? `${text}, ${where}` : text, 10);
  }

  const match = chooseMatch(parsed, places);
  if (match.status !== "resolved") return match;
  // A spot picked along a street (not a named place like "Tottenville Marina"): its street, for the
  // "we picked one spot on Atlantic Avenue" note.
  const onStreet = match.onStreet && match.place.street ? prettyStreet(match.place.street) : null;
  return { status: "resolved", onStreet, location: placeToLocation(match.place) };
}
