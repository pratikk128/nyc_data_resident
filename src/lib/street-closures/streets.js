/*
 * Street names: one spelling for matching ("W 8th St", "WEST    8 STREET" and
 * "west 8 street" are all "WEST 8 STREET"), display labels, and the street
 * autocomplete. Browser-safe.
 *
 * The dataset writes numbered streets without ordinals ("51 AVENUE"), pads
 * some names with spaces ("WEST    8 STREET"), spells Saint as "ST" ("ST MARKS
 * PLACE") and splits Mc names ("MC DONALD AVENUE").
 */
import { prettyStreet } from "../complaints311/location-input.js";

const TYPES = {
  ST: "STREET", STR: "STREET", AVE: "AVENUE", AV: "AVENUE", AVN: "AVENUE", BLVD: "BOULEVARD", BL: "BOULEVARD",
  RD: "ROAD", PL: "PLACE", PKWY: "PARKWAY", PKY: "PARKWAY", DR: "DRIVE", LN: "LANE", CT: "COURT",
  TER: "TERRACE", TERR: "TERRACE", HWY: "HIGHWAY", EXPY: "EXPRESSWAY", EXWY: "EXPRESSWAY", TPKE: "TURNPIKE",
  SQ: "SQUARE", PLZ: "PLAZA", CONC: "CONCOURSE", CRES: "CRESCENT", BWAY: "BROADWAY", HTS: "HEIGHTS"
};
const DIRECTIONS = { E: "EAST", W: "WEST", N: "NORTH", S: "SOUTH" };
const ORDINAL_WORDS = {
  FIRST: "1", SECOND: "2", THIRD: "3", FOURTH: "4", FIFTH: "5", SIXTH: "6",
  SEVENTH: "7", EIGHTH: "8", NINTH: "9", TENTH: "10", ELEVENTH: "11", TWELFTH: "12"
};
const STREET_TYPES = new Set(Object.values(TYPES));

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/*
 * The matching form of a street name: upper case, single spaces, ordinals
 * dropped ("51ST" → "51"), street types spelled out ("AVE" → "AVENUE"), a
 * leading E/W/N/S spelled out ("W 8 ST" → "WEST 8 STREET") and Saint as "ST".
 * "ST" is Street everywhere but first ("ST MARKS PLACE"), as in the data.
 */
export function streetKey(name) {
  const tokens = String(name ?? "").toUpperCase()
    .replace(/\bB'?WAY\b/g, "BROADWAY")
    .replace(/['’.]/g, "")
    .replace(/[^A-Z0-9&/\- ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return tokens.map((t, i) => {
    const next = tokens[i + 1];
    if (i === 0 && t === "SAINT" && next) return "ST";
    if (i === 0 && t === "ST" && next && !DIRECTIONS[next]) return "ST";
    if (i === 0 && DIRECTIONS[t] && next) return DIRECTIONS[t];
    const ordinal = t.match(/^(\d+)(ST|ND|RD|TH)$/);
    if (ordinal) return ordinal[1];
    if (ORDINAL_WORDS[t] && STREET_TYPES.has(TYPES[next] ?? next)) return ORDINAL_WORDS[t];
    return TYPES[t] ?? t;
  }).join(" ");
}

// DOT's stand-ins for a cross street that isn't a street ("BEND", "DEAD END",
// "WASHINGTON CEMETERY BOUNDARY"); left out of the autocomplete.
export const isStreetName = (key) => !/^(?:BEND|DEAD END|PEDESTRIAN OVERPASS|BODY OF WATER)$|BOUNDARY$/.test(key);

// Without spaces, so "MCDONALD AVE" finds "MC DONALD AVENUE".
const compact = (key) => key.replace(/ /g, "");

// "WEST    8 STREET" → "West 8th Street"
export const streetLabel = (name) => prettyStreet(clean(name));

/*
 * The autocomplete: streets whose name contains what was typed, starting at a
 * word ("8 st" finds West 8th Street, not 18th Street). Streets that start
 * with it come first, then busier streets.
 *   streets  [{ key, label, blocks }]
 * → up to `limit` of them
 */
export function suggestStreets(streets, text, limit = 8) {
  const q = streetKey(text);
  if (!q) return [];
  const qc = compact(q);
  const hits = [];
  for (const s of streets) {
    const at = (` ${s.key}`).indexOf(` ${q}`);
    // Spaces ignored only for names, so "8 st" can't land inside "WEST18STREET".
    const loose = at < 0 && qc.length >= 4 && !/\d/.test(qc) && compact(s.key).includes(qc);
    if (at < 0 && !loose) continue;
    hits.push({ s, rank: at === 0 ? 0 : at > 0 ? 1 : 2 });
  }
  hits.sort((a, b) => a.rank - b.rank || b.s.blocks - a.s.blocks || a.s.label.localeCompare(b.s.label));
  return hits.slice(0, limit).map((h) => h.s);
}

// The street a typed name means: an exact match, else the only suggestion, else null.
export function resolveStreet(streets, text) {
  const key = streetKey(text);
  const exact = streets.find((s) => s.key === key || compact(s.key) === compact(key));
  if (exact) return exact;
  const hits = suggestStreets(streets, text, 2);
  return hits.length === 1 ? hits[0] : null;
}
