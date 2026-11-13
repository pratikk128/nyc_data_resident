/*
 * NYC Crash Hotspots: what the page asks for (a place, and how you get
 * around), as URL parameters. Browser-safe:
 * the page keeps its view in the URL with these, and the API routes read
 * the same ones.
 *
 *   Area (at most one; a spot wins, then streets, then a ZIP, then a borough):
 *     lat, lon, r, place    a spot and how far around it (r: RADII, meters); place labels it
 *                           (left out when the area has privateLabel, as for "your location")
 *     street, cross         a street, or an intersection with cross; boro narrows either
 *     zip                   a ZIP code
 *     boro                  a borough (BOROUGHS values)
 *   How you get around:
 *     mode                  MODES key (walk, bike, drive); none means everyone
 *
 * readQuery() drops what it can't use rather than failing, so an old or
 * hand-edited link still shows something sensible.
 */
import { DIMENSIONS } from "./facts.js";
import { streetMatchKey, streetBaseKey } from "./normalize.js";
import { BOROUGHS, boroughLabel } from "../complaints311/config.js";
import { parseLocationInput, isNycZip, prettyStreet, MAX_INPUT_LENGTH } from "../complaints311/location-input.js";
import { inCityLimits } from "../in-city.js";

export const RADII = [250, 500]; // meters
export const DEFAULT_RADIUS = 250;


// "Broadway & W 72 St" / "Broadway and West 72nd" / "Broadway at 72 St" → two streets.
const INTERSECTION = /\s*(?:&|\/|\+|@|\band\b|\bat\b|\bcorner of\b)\s*/i;

/*
 * The street part of the location text → up to two streets
 * [{ key, base, label }]. A house number is dropped by streetMatchKey()
 * ("200 W 72 St" is West 72nd Street; "72 St" stays 72nd Street): the data
 * names streets, not addresses.
 */
export function streetsFromText(text) {
  return clean(text).split(INTERSECTION).map((part) => part.trim())
    .filter(Boolean).slice(0, 2)
    .map((part) => {
      const key = streetMatchKey(part);
      const label = prettyStreet(part.replace(/^\d+(?:-\d+)?[A-Za-z]?\s+(?=\S+\s+\S)/, ""));
      return key && { key, base: streetBaseKey(key), label };
    })
    .filter(Boolean);
}

/*
 * How the person gets around. It picks the crashes counted (walking: the
 * ones that hurt a pedestrian) and who the tips talk to. Driving counts every
 * crash, since a driver can be in any of them, including hitting someone on foot.
 */
export const MODES = [
  { key: "walk", label: "I walk", who: ["pedestrian"], victim: "a pedestrian", people: "Pedestrians" },
  { key: "bike", label: "I bike or ride an e-bike", who: ["cyclist", "e-rider"], victim: "a cyclist or e-rider", people: "Cyclists and e-riders" },
  { key: "drive", label: "I drive", who: [], victim: "someone", people: "People" }
];
export const modeOf = (key) => MODES.find((m) => m.key === key) ?? null;

// A mode → the crash_facts filters (hotspot-sql.js): { who, cause, move, veh: [key] }.
export function filtersFor(mode) {
  const filters = {};
  for (const d of DIMENSIONS) filters[d.param] = [];
  filters.who = [...(modeOf(mode)?.who ?? [])];
  return filters;
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_LENGTH);

/*
 * URLSearchParams → { area, filters }
 *   area: null (all of NYC)
 *     | { kind: "point", lat, lon, radius, label }
 *     | { kind: "street", streets: [{ key, base, label }] (1 or 2), borough, label }
 *     | { kind: "zip", zip, label }
 *     | { kind: "borough", borough, label }
 *   mode: MODES key or null
 *   filters: filtersFor(mode)
 */
export function readQuery(params) {
  const get = (k) => clean(params.get(k));
  const mode = modeOf(get("mode"))?.key ?? null;

  const borough = BOROUGHS.some((b) => b.value === get("boro")) ? get("boro") : null;
  let area = null;
  const lat = Number(get("lat")), lon = Number(get("lon"));
  const streets = get("street") ? streetsFromText(get("cross") ? `${get("street")} & ${get("cross")}` : get("street")) : [];
  if (get("lat") && get("lon") && Number.isFinite(lat) && Number.isFinite(lon) && inCityLimits(lat, lon)) {
    const r = Number(get("r"));
    area = {
      kind: "point",
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      radius: RADII.includes(r) ? r : DEFAULT_RADIUS,
      label: get("place") || "the spot you picked"
    };
  } else if (streets.length) {
    const where = borough ? `, ${boroughLabel(borough)}` : "";
    area = { kind: "street", streets, borough, label: `${streets.map((s) => s.label).join(" & ")}${where}` };
  } else if (/^\d{5}$/.test(get("zip")) && isNycZip(get("zip"))) {
    area = { kind: "zip", zip: get("zip"), label: `ZIP ${get("zip")}` };
  } else if (borough) {
    area = { kind: "borough", borough, label: boroughLabel(borough) };
  }
  return { area, mode, filters: filtersFor(mode) };
}

// { area, mode } → URLSearchParams, in one order, so equal views give equal strings (cache keys, links).
export function queryToParams({ area, mode }) {
  const p = new URLSearchParams();
  if (area?.kind === "point") {
    p.set("lat", String(area.lat));
    p.set("lon", String(area.lon));
    if (area.radius !== DEFAULT_RADIUS) p.set("r", String(area.radius));
    if (area.label && area.label !== "the spot you picked" && !area.privateLabel) p.set("place", area.label);
  } else if (area?.kind === "street") {
    p.set("street", area.streets[0].label);
    if (area.streets[1]) p.set("cross", area.streets[1].label);
    if (area.borough) p.set("boro", area.borough);
  } else if (area?.kind === "zip") {
    p.set("zip", area.zip);
  } else if (area?.kind === "borough") {
    p.set("boro", area.borough);
  }
  if (mode) p.set("mode", mode);
  return p;
}

/*
 * The same view without its place label (the label doesn't change the
 * numbers), for the API's cache key.
 */
export function queryKey(query) {
  const p = queryToParams(query);
  p.delete("place");
  return p.toString();
}

/*
 * What was typed in the place box →
 *   { kind: "area", area }           a ZIP, a borough, a street or an intersection: no lookup needed
 *   { kind: "lookup", parsed }       an address: the page geocodes it (complaints311/geocode.js)
 *   { kind: "empty" }                nothing typed: all of NYC
 *   { kind: "problem", text }
 * "Broadway & W 72 St" is an intersection, "Atlantic Ave, Brooklyn" a street,
 * "350 5th Ave" an address, and "5 Ave" a street (a number and one word).
 */
export function placeFromText(text) {
  const parsed = parseLocationInput({ text });
  if (parsed.kind === "empty") return { kind: "empty" };
  if (parsed.kind === "error") return { kind: "problem", text: parsed.message };
  const params = new URLSearchParams();
  if (parsed.kind === "zip") params.set("zip", parsed.zip);
  else if (parsed.kind === "borough") params.set("boro", parsed.borough);
  else {
    const streets = streetsFromText(parsed.text);
    const isAddress = parsed.kind === "address" && streets.length < 2 && /^\S+\s+\S+\s+\S/.test(parsed.text);
    if (isAddress) return { kind: "lookup", parsed };
    if (!streets.length) return { kind: "problem", text: "We couldn’t read a street in that. Try a street name, an intersection like “Broadway & W 72 St”, or a ZIP code." };
    params.set("street", streets[0].label);
    if (streets[1]) params.set("cross", streets[1].label);
    if (parsed.borough) params.set("boro", parsed.borough);
  }
  return { kind: "area", area: readQuery(params).area };
}
