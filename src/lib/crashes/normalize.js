/*
 * One spelling for the crash fields people search on, used on the data
 * (rows.js, in the hotspots build) and on what a person types (query.js), so both meet
 * in the middle. Browser-safe. Vehicle types have their own map
 * (vehicle-types.js).
 */
import { streetKey } from "../street-closures/streets.js";

/*
 * The matching form of a street: streetKey() ("W 72nd St" → "WEST 72 STREET",
 * B'way → BROADWAY), then spaces dropped so "MC DONALD AVENUE" and
 * "MCDONALD AVE" meet. A leading house number goes ("200 WEST 72 STREET",
 * the way off_street_name is often written). null when nothing is left.
 */
export function streetMatchKey(name) {
  let key = streetKey(name);
  // "200 WEST 72 STREET" loses its house number; "3 AVENUE" and "72 STREET" are streets.
  const house = key.match(/^\d+[A-Z]?(?:-\d+)? (.+)$/);
  if (house && !STREET_TYPE_WORDS.has(house[1])) key = house[1];
  const compact = key.replace(/ /g, "");
  return compact || null;
}
const STREET_TYPE_WORDS = new Set(["STREET", "AVENUE", "ROAD", "PLACE", "DRIVE", "LANE", "COURT", "TERRACE", "BOULEVARD", "PARKWAY", "WAY"]);

// streetMatchKey() without a leading East/West/North/South, so "72 St" finds
// "WEST 72 STREET" (a close match, not an exact one).
export const streetBaseKey = (key) => (key ? key.replace(/^(?:EAST|WEST|NORTH|SOUTH)(?=\d)/, "") : null);

// "Unspecified", "Unknown", "-", "" … are not recorded.
const NOT_RECORDED = new Set(["", "UNSPECIFIED", "UNKNOWN", "-", "--", "N/A", "NA", "NONE", "0"]);
export function textOf(value) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return NOT_RECORDED.has(s.toUpperCase()) ? null : s;
}

export function numberOf(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
