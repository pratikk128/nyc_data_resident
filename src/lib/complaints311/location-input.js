/*
 * Reading what someone typed into the location box (plus the optional
 * borough and ZIP fields) and the location kept in the page URL.
 *
 * parseLocationInput() decides what kind of place it is:
 *   zip      "11211", or only the ZIP field
 *   borough  "Queens", "the Bronx", or only the borough field
 *   address  starts with a house number: "350 5th Ave, Manhattan", "41-41 Kissena Blvd"
 *   street   anything else: "Broadway", "Atlantic Ave, Brooklyn", "Tottenville"
 * A borough or ZIP typed at the end of the text ("Atlantic Ave, Brooklyn",
 * "Bedford Ave 11211") is split off and used to narrow the street search.
 */
import { BOROUGHS, WINDOWS, DEFAULT_WINDOW } from "./config.js";

export const MAX_INPUT_LENGTH = 120;

// What people type for each borough, longest first so "staten island" wins over "si".
const BOROUGH_NAMES = [
  ["staten island", "STATEN ISLAND"], ["the bronx", "BRONX"], ["manhattan", "MANHATTAN"],
  ["brooklyn", "BROOKLYN"], ["queens", "QUEENS"], ["bronx", "BRONX"],
  ["new york, ny", "MANHATTAN"], ["nyc", null], ["new york", null], ["ny", null],
  ["bk", "BROOKLYN"], ["si", "STATEN ISLAND"]
];

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// NYC ZIPs start 100–104, 110–114 or 116.
export const isNycZip = (zip) => /^1(0[0-4]|1[0-46])\d\d$/.test(zip);

// "brooklyn" / "Brooklyn" / "BROOKLYN" → "BROOKLYN"; anything else → null.
export function boroughFromText(text) {
  const t = clean(text).toLowerCase().replace(/[.]/g, "");
  return BOROUGH_NAMES.find(([name]) => name === t)?.[1] ?? null;
}

// Peels a borough name or a ZIP (or both) off the end of the text: "Atlantic Ave, Brooklyn 11217".
function splitTail(text) {
  let rest = text;
  let zip = null;
  let borough = null;
  for (let i = 0; i < 3; i++) {
    const zipMatch = rest.match(/(?:^|[\s,])(\d{5})(?:-\d{4})?$/);
    if (zipMatch && !zip) {
      zip = zipMatch[1];
      rest = clean(rest.slice(0, zipMatch.index).replace(/,\s*$/, ""));
      continue;
    }
    const lower = rest.toLowerCase();
    const hit = BOROUGH_NAMES.find(([name]) => lower === name || lower.endsWith(`, ${name}`) || lower.endsWith(` ${name}`));
    // Only a name at the very end is peeled, so "Queens Blvd" and "Bronx River Ave" stay streets.
    if (hit) {
      borough = borough ?? hit[1];
      rest = clean(rest.slice(0, rest.length - hit[0].length).replace(/,\s*$/, ""));
      continue;
    }
    break;
  }
  return { rest, zip, borough };
}

/*
 * → { kind: "empty" }
 *   { kind: "error", message }
 *   { kind: "zip", zip, borough? }
 *   { kind: "borough", borough }
 *   { kind: "address" | "street", text, houseNumber?, borough?, zip? }
 */
export function parseLocationInput({ text = "", borough = "", zip = "" } = {}) {
  const raw = clean(text);
  if (raw.length > MAX_INPUT_LENGTH) return { kind: "error", message: `Keep it under ${MAX_INPUT_LENGTH} characters.` };

  const fieldZip = clean(zip);
  if (fieldZip && !/^\d{5}$/.test(fieldZip)) return { kind: "error", message: "A ZIP code is 5 digits, like 11211." };
  const fieldBorough = BOROUGHS.some((b) => b.value === borough) ? borough : null;

  const tail = splitTail(raw);
  const zipCode = fieldZip || tail.zip;
  const boro = fieldBorough || tail.borough;
  if (zipCode && !isNycZip(zipCode)) return { kind: "error", message: `${zipCode} isn’t a New York City ZIP code.` };

  // "NYC" or "New York" alone names no borough; treat it as nothing typed.
  const rest = tail.rest;
  if (!rest) {
    if (zipCode) return { kind: "zip", zip: zipCode, ...(boro && { borough: boro }) };
    if (boro) return { kind: "borough", borough: boro };
    return raw ? { kind: "error", message: "Add a street, ZIP code or borough so we know where to look." } : { kind: "empty" };
  }

  const out = { text: rest, ...(boro && { borough: boro }), ...(zipCode && { zip: zipCode }) };
  const house = rest.match(/^(\d+(?:-\d+)?[A-Za-z]?)\s+(\S.*)$/);
  if (house) return { kind: "address", houseNumber: house[1].toUpperCase(), ...out };
  return { kind: "street", ...out };
}

// ---------- Display ----------

const ORDINAL_WORDS = "STREET|ST|AVENUE|AVE|PLACE|PL|ROAD|RD|DRIVE|DR|TERRACE|TER|LANE|LN|COURT|CT|WAY";

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th"}`;
}

// "5 AVENUE" → "5th Avenue", "B'WAY" → "Broadway", "EAST 14 STREET" → "East 14th Street".
export function prettyStreet(street) {
  let s = clean(street).toUpperCase()
    .replace(/\bB'?WAY\b/g, "BROADWAY")
    .replace(new RegExp(`(^|\\s)(\\d+)\\s+(${ORDINAL_WORDS})\\b`, "g"), (_, pre, n, word) => `${pre}${ordinal(Number(n))} ${word}`);
  s = s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
  return s.replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_, n, suf) => n + suf.toLowerCase());
}

// "350 5th Avenue, Manhattan 10118"
export function placeLabel({ houseNumber, street, name, borough, zip }) {
  const boroughName = BOROUGHS.find((b) => b.value === borough)?.label ?? "";
  const first = street ? [houseNumber, prettyStreet(street)].filter(Boolean).join(" ") : prettyStreet(name ?? "");
  return [first, [boroughName, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// ---------- URL state ----------
// ?lat=40.7484&lon=-73.9857&place=350+5th+Avenue,+Manhattan+10118&boro=MANHATTAN&zip=10118
// ?zip=11211               (a ZIP on its own)
// ?boro=QUEENS             (a borough on its own)
// plus &window=3m|12m, &area=immediate, &vs=city

// Roughly the five boroughs, so a URL can't point the radius queries anywhere else.
export function inNyc(lat, lon) {
  return lat > 40.47 && lat < 40.93 && lon > -74.27 && lon < -73.68;
}

export function locationFromParams(params) {
  const get = (k) => clean(params.get(k));
  const window = WINDOWS[get("window")] ? get("window") : DEFAULT_WINDOW;
  const area = get("area") === "immediate" ? "immediate" : "neighborhood";
  const vs = get("vs") === "city" ? "city" : "borough";
  const borough = BOROUGHS.some((b) => b.value === get("boro")) ? get("boro") : null;
  const zip = /^\d{5}$/.test(get("zip")) && isNycZip(get("zip")) ? get("zip") : null;
  const lat = Number(get("lat")), lon = Number(get("lon"));
  const view = { window, area, vs };

  if (get("lat") && get("lon") && Number.isFinite(lat) && Number.isFinite(lon) && inNyc(lat, lon)) {
    return {
      ...view,
      location: {
        kind: "point",
        lat: Math.round(lat * 1e5) / 1e5,
        lon: Math.round(lon * 1e5) / 1e5,
        label: get("place").slice(0, MAX_INPUT_LENGTH) || "the spot you picked",
        borough, zip
      }
    };
  }
  if (zip) return { ...view, location: { kind: "zip", zip, borough } };
  if (borough) return { ...view, location: { kind: "borough", borough } };
  return { ...view, location: null };
}

export function locationToParams(location, { window = DEFAULT_WINDOW, area = "neighborhood", vs = "borough" } = {}) {
  const p = new URLSearchParams();
  if (location?.kind === "point") {
    p.set("lat", String(location.lat));
    p.set("lon", String(location.lon));
    if (location.label) p.set("place", location.label);
    if (location.borough) p.set("boro", location.borough);
    if (location.zip) p.set("zip", location.zip);
  } else if (location?.kind === "zip") {
    p.set("zip", location.zip);
  } else if (location?.kind === "borough") {
    p.set("boro", location.borough);
  }
  if (window !== DEFAULT_WINDOW) p.set("window", window);
  if (area === "immediate") p.set("area", "immediate");
  if (vs === "city") p.set("vs", "city");
  return p;
}
