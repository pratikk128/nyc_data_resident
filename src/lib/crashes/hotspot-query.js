/*
 * NYC Crash Hotspots: what the page asks for, as URL parameters. Browser-safe:
 * the page keeps its view in the URL with these, and the API routes read
 * the same ones.
 *
 *   Area (at most one; a spot wins, then streets, then a ZIP, then a borough):
 *     lat, lon, r, place    a spot and how far around it (r: RADII, meters); place labels it
 *     street, cross         a street, or an intersection with cross; boro narrows either
 *     zip                   a ZIP code
 *     boro                  a borough (BOROUGHS values)
 *   Filters (each a comma list of facts.js keys; any of them matches, and every list must):
 *     who, cause, move, veh
 *     sev                   SEVERITIES key (default all)
 *     time                  TIMES keys
 *
 * readQuery() drops what it can't use rather than failing, so an old or
 * hand-edited link still shows something sensible.
 */
import { DIMENSIONS } from "./facts.js";
import { streetsFromText } from "./query.js";
import { BOROUGHS, boroughLabel } from "../complaints311/config.js";
import { parseLocationInput, isNycZip, MAX_INPUT_LENGTH } from "../complaints311/location-input.js";
import { inCityLimits } from "../in-city.js";

export const RADII = [250, 500]; // meters
export const DEFAULT_RADIUS = 250;

export const SEVERITIES = [
  { key: "all", label: "All crashes", min: 0 },
  { key: "hurt", label: "Someone hurt", min: 1 },
  { key: "serious", label: "Seriously hurt or killed", min: 2 }
];

const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
export const TIMES = [
  { key: "morning", label: "Morning rush (6–10 am)", hours: range(6, 10) },
  { key: "midday", label: "Midday (10 am–4 pm)", hours: range(10, 16) },
  { key: "evening", label: "Evening rush (4–8 pm)", hours: range(16, 20) },
  { key: "night", label: "Night (8 pm–6 am)", hours: [...range(20, 24), ...range(0, 6)] }
];

// One tap to a common view. Each sets these filters and clears the others.
export const PRESETS = [
  { key: "walk", label: "I walk", filters: { who: ["pedestrian"] } },
  { key: "bike", label: "I bike or ride an e-bike", filters: { who: ["cyclist", "e-rider"] } },
  { key: "drive", label: "I drive", filters: { who: ["occupant"] } },
  { key: "heavy", label: "Trucks and buses", filters: { veh: ["truck", "bus"] } }
];

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_LENGTH);
const listOf = (params, name, allowed) => {
  const keys = new Set(allowed);
  return [...new Set(clean(params.get(name)).split(",").map((s) => s.trim()).filter((k) => keys.has(k)))];
};

/*
 * URLSearchParams → { area, filters }
 *   area: null (all of NYC)
 *     | { kind: "point", lat, lon, radius, label }
 *     | { kind: "street", streets: [{ key, base, label }] (1 or 2), borough, label }
 *     | { kind: "zip", zip, label }
 *     | { kind: "borough", borough, label }
 *   filters: { who, cause, move, veh: [key], sev, time: [key] }
 */
export function readQuery(params) {
  const get = (k) => clean(params.get(k));
  const filters = {};
  for (const d of DIMENSIONS) filters[d.param] = listOf(params, d.param, d.groups.map((g) => g.key));
  filters.sev = SEVERITIES.some((s) => s.key === get("sev")) ? get("sev") : "all";
  filters.time = listOf(params, "time", TIMES.map((t) => t.key));

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
  return { area, filters };
}

// { area, filters } → URLSearchParams, in one order, so equal views give equal strings (cache keys, links).
export function queryToParams({ area, filters }) {
  const p = new URLSearchParams();
  if (area?.kind === "point") {
    p.set("lat", String(area.lat));
    p.set("lon", String(area.lon));
    if (area.radius !== DEFAULT_RADIUS) p.set("r", String(area.radius));
    if (area.label && area.label !== "the spot you picked") p.set("place", area.label);
  } else if (area?.kind === "street") {
    p.set("street", area.streets[0].label);
    if (area.streets[1]) p.set("cross", area.streets[1].label);
    if (area.borough) p.set("boro", area.borough);
  } else if (area?.kind === "zip") {
    p.set("zip", area.zip);
  } else if (area?.kind === "borough") {
    p.set("boro", area.borough);
  }
  for (const d of DIMENSIONS) if (filters[d.param]?.length) p.set(d.param, [...filters[d.param]].sort().join(","));
  if (filters.sev && filters.sev !== "all") p.set("sev", filters.sev);
  if (filters.time?.length) p.set("time", [...filters.time].sort().join(","));
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

export const hasFilters = (filters) =>
  DIMENSIONS.some((d) => filters[d.param]?.length) || filters.sev !== "all" || filters.time.length > 0;

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
