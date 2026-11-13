/*
 * One spelling for the crash fields people search on, used on the data
 * (rows.js, in the hotspots build) and on what a person types (query.js), so both meet
 * in the middle. Browser-safe. Makes and vehicle types have their own maps
 * (makes.js, vehicle-types.js).
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

// "9:25" / "09:25" → 565 minutes after midnight; null when not a time.
export function minuteOf(time) {
  const m = String(time ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

// 565 → "9:25 AM"
export function timeLabel(minute) {
  if (minute == null) return null;
  const h = Math.floor(minute / 60), m = minute % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/*
 * Who a person row is, from person_type and ped_role:
 *   driver, passenger              people in a vehicle (person_type Occupant)
 *   pedestrian, cyclist            on foot, on a bicycle (person_type Bicyclist)
 *   other-motorized                on an e-scooter, skateboard, wheelchair and the like
 *   registrant, owner, witness, notified, other
 *                                  on the report but not in the crash: a car's
 *                                  registered owner, a witness, someone the
 *                                  police told. Left out of counts and matching.
 */
export const INVOLVED_ROLES = ["driver", "passenger", "pedestrian", "cyclist", "other-motorized"];
const PED_ROLES = {
  DRIVER: "driver", PASSENGER: "passenger", PEDESTRIAN: "pedestrian",
  REGISTRANT: "registrant", OWNER: "owner", WITNESS: "witness", "NOTIFIED PERSON": "notified"
};

export function personRole(personType, pedRole) {
  const role = PED_ROLES[String(pedRole ?? "").trim().toUpperCase()];
  if (role && !INVOLVED_ROLES.includes(role)) return role;
  const type = String(personType ?? "").trim().toUpperCase();
  if (type === "PEDESTRIAN") return "pedestrian";
  if (type === "BICYCLIST") return "cyclist";
  if (type === "OTHER MOTORIZED") return "other-motorized";
  return role ?? "other";
}

export const isInvolved = (role) => INVOLVED_ROLES.includes(role);

export const ROLE_LABELS = {
  driver: "Driver", passenger: "Passenger", pedestrian: "Pedestrian", cyclist: "Cyclist",
  "other-motorized": "E-scooter, skateboard or similar", registrant: "Registered owner",
  owner: "Owner", witness: "Witness", notified: "Person notified", other: "Other"
};

/*
 * Where someone sat, from position_in_vehicle (the police form's long
 * wording: "Left rear passenger, or rear passenger on a bicycle, motorcycle,
 * snowmobile"). The rear-* keys share "rear-", so "back seat" can match any.
 */
export const POSITIONS = [
  { key: "driver", label: "Driver’s seat" },
  { key: "front-passenger", label: "Front passenger seat" },
  { key: "rear-left", label: "Back seat, left" },
  { key: "rear-middle", label: "Back seat, middle" },
  { key: "rear-right", label: "Back seat, right" },
  { key: "rear-other", label: "Further back (bus, truck bed, wagon cargo area)" },
  { key: "other", label: "On a lap, or riding outside" }
];
export function positionKey(text) {
  const t = String(text ?? "").toUpperCase();
  if (!t.trim() || /^(UNKNOWN|DOES NOT APPLY|UNSPECIFIED)/.test(t)) return null;
  if (/^DRIVER/.test(t)) return "driver";
  if (/^(FRONT PASSENGER|MIDDLE FRONT)/.test(t)) return "front-passenger";
  if (/^LEFT REAR/.test(t)) return "rear-left";
  if (/^MIDDLE REAR/.test(t)) return "rear-middle";
  if (/^RIGHT REAR/.test(t)) return "rear-right";
  if (/^ANY PERSON IN THE REAR/.test(t)) return "rear-other";
  return "other";
}
export const positionLabel = (key) => POSITIONS.find((p) => p.key === key)?.label ?? null;

// Ages outside 0–110 are data-entry noise (the table has negatives and 9999s).
export function ageOf(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 110 && String(value ?? "").trim() !== "" ? n : null;
}

// M / F; the data's U (unknown) and anything else are not recorded.
export function sexOf(value) {
  const s = String(value ?? "").trim().toUpperCase();
  return s === "M" || s === "F" ? s : null;
}

// Model years a car could have: 1900 to next year.
export function yearOf(value, now = new Date()) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1900 && n <= now.getUTCFullYear() + 1 ? n : null;
}

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

/*
 * A short, stable hash of a source row (cyrb53, 14 hex characters), part of
 * each facts row's `h`. Keys are sorted, so the column order Socrata returns doesn't matter.
 */
export function rowHash(row) {
  const text = JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k]]));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
