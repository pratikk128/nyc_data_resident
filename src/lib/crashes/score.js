/*
 * How well one crash fits what someone remembers. Pure and browser-safe;
 * search.js runs it on the candidates the database returns (search-sql.js
 * picks them with the same WEIGHTS), and it decides the final order and the
 * chips each result shows.
 *
 * Points for each criterion given, more for exact than close than partial,
 * and more for the details that set a crash apart (a make and model year on
 * one vehicle, both streets of an intersection) than for common ones
 * (a borough, a sex). Vehicle criteria are scored against each vehicle and
 * the crash gets its best vehicle, so "2019 Toyota" doesn't match a crash
 * with a 2019 Honda and a 2015 Toyota; person criteria the same way, over
 * the people in the crash (not registered owners or witnesses).
 *
 * The date range is a filter, not a score.
 */
import { makeLabel } from "./makes.js";
import { vehicleTypeLabel } from "./vehicle-types.js";
import { timeLabel, ROLE_LABELS, positionLabel } from "./normalize.js";
import { boroughLabel } from "../complaints311/config.js";

export const WEIGHTS = {
  bothStreets: 30, oneStreet: 12, closeStreet: 0.6, // closeStreet: share for "72 St" matching "West 72 St"
  nearMax: 20, nearMin: 6,                           // at the spot … at the radius's edge
  zip: 8, borough: 3,
  time: 10, timeNear: 4,                             // timeNear: within NEAR_MINUTES outside the window
  make: 12, makePartial: 6, year: 8, yearNear: 4, makeAndYear: 10,
  type: 6, stateNY: 2, stateOther: 6, direction: 2,
  age: 8, ageNear: 4, ageFar: 2,                     // in range, within ±2, within ±5
  role: 4, injured: 4, position: 3, positionNear: 2, sex: 2
};
export const NEAR_MINUTES = 30;
export const AGE_NEAR = 2, AGE_FAR = 5;

const R = 6371008.8;
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Is minute m inside [from, to], which may cross midnight? And how far outside if not.
export function minutesOutside(m, { from, to }) {
  const inside = from <= to ? m >= from && m <= to : m >= from || m <= to;
  if (inside) return 0;
  const gap = (a, b) => Math.min((a - b + 1440) % 1440, (b - a + 1440) % 1440);
  return Math.min(gap(m, from), gap(m, to));
}

// Points for each criterion given, for the best possible crash.
export function maxPoints(c) {
  const W = WEIGHTS;
  let max = 0;
  if (c.streets.length) max += c.streets.length > 1 ? W.bothStreets : W.oneStreet;
  if (c.point) max += W.nearMax;
  if (c.zip) max += W.zip;
  if (c.borough) max += W.borough;
  if (c.time) max += W.time;
  const v = c.vehicle;
  if (v) {
    if (v.make) max += W.make;
    if (v.yearFrom != null) max += W.year;
    if (v.make && v.yearFrom != null) max += W.makeAndYear;
    if (v.type) max += W.type;
    if (v.state) max += v.state === "NY" ? W.stateNY : W.stateOther;
    if (v.direction) max += W.direction;
  }
  const p = c.person;
  if (p) {
    if (p.ageFrom != null) max += W.age;
    if (p.role) max += W.role;
    if (p.injured != null) max += W.injured;
    if (p.position) max += W.position;
    if (p.sex) max += W.sex;
  }
  return max;
}

const yearText = (v) => (v.yearFrom === v.yearTo ? String(v.yearFrom) : `${v.yearFrom}–${v.yearTo}`);
const ageText = (p) => (p.ageFrom === p.ageTo ? `age ${p.ageFrom}` : `age ${p.ageFrom}–${p.ageTo}`);

function scoreVehicle(v, row) {
  const W = WEIGHTS;
  let points = 0;
  const chips = [], missed = [];
  let makeHit = false, yearHit = false;
  if (v.make) {
    if (v.make.key && row.make_key === v.make.key) {
      points += W.make; makeHit = true;
      chips.push({ label: makeLabel(v.make.key), strength: v.make.how === "exact" ? "exact" : "close" });
    } else if (!v.make.key && row.make_raw && v.make.text.length >= 3 &&
      row.make_raw.toUpperCase().replace(/[^A-Z0-9]/g, "").startsWith(v.make.text.replace(/[^A-Z0-9]/g, "").slice(0, 4))) {
      points += W.makePartial; makeHit = true;
      chips.push({ label: `Make like “${v.make.label}”`, strength: "partial" });
    } else missed.push(v.make.key ? makeLabel(v.make.key) : v.make.label);
  }
  if (v.yearFrom != null) {
    const y = row.vehicle_year;
    if (y != null && y >= v.yearFrom && y <= v.yearTo) { points += W.year; yearHit = true; chips.push({ label: `${y} model`, strength: "exact" }); }
    else if (y != null && (y === v.yearFrom - 1 || y === v.yearTo + 1)) { points += W.yearNear; yearHit = true; chips.push({ label: `${y} model (1 year off)`, strength: "close" }); }
    else missed.push(`${yearText(v)} model`);
  }
  if (makeHit && yearHit) points += W.makeAndYear;
  if (v.type) {
    if (row.type_key === v.type) { points += W.type; chips.push({ label: vehicleTypeLabel(v.type), strength: "exact" }); }
    else missed.push(vehicleTypeLabel(v.type));
  }
  if (v.state) {
    if (row.state_registration === v.state) { points += v.state === "NY" ? W.stateNY : W.stateOther; chips.push({ label: `${v.state} plates`, strength: "exact" }); }
    else missed.push(`${v.state} plates`);
  }
  if (v.direction) {
    if (row.travel_direction === v.direction) { points += W.direction; chips.push({ label: `Heading ${v.direction.toLowerCase()}`, strength: "exact" }); }
    else missed.push(`Heading ${v.direction.toLowerCase()}`);
  }
  return { points, chips, missed };
}

function scorePerson(p, row) {
  const W = WEIGHTS;
  let points = 0;
  const chips = [], missed = [];
  if (p.role) {
    if (row.role === p.role) { points += W.role; chips.push({ label: ROLE_LABELS[p.role], strength: "exact" }); }
    else missed.push(ROLE_LABELS[p.role]);
  }
  if (p.ageFrom != null) {
    const a = row.age;
    const off = a == null ? Infinity : a < p.ageFrom ? p.ageFrom - a : a > p.ageTo ? a - p.ageTo : 0;
    if (off === 0) { points += W.age; chips.push({ label: `Age ${a}`, strength: "exact" }); }
    else if (off <= AGE_NEAR) { points += W.ageNear; chips.push({ label: `Age ${a}`, strength: "close" }); }
    else if (off <= AGE_FAR) { points += W.ageFar; chips.push({ label: `Age ${a}`, strength: "partial" }); }
    else missed.push(ageText(p));
  }
  if (p.injured != null) {
    const hurt = row.injury === "Injured" || row.injury === "Killed";
    if (hurt === p.injured) { points += W.injured; chips.push({ label: p.injured ? "Injured" : "No injury recorded", strength: "exact" }); }
    else missed.push(p.injured ? "Injured" : "No injury recorded");
  }
  if (p.position) {
    const rearAny = p.position === "rear" && row.position_key?.startsWith("rear-");
    if (row.position_key === p.position) { points += W.position; chips.push({ label: positionLabel(p.position), strength: "exact" }); }
    else if (rearAny || (p.position.startsWith("rear-") && row.position_key?.startsWith("rear-"))) {
      points += rearAny ? W.position : W.positionNear;
      chips.push({ label: positionLabel(row.position_key), strength: rearAny ? "exact" : "close" });
    } else missed.push(p.position === "rear" ? "Back seat" : positionLabel(p.position));
  }
  if (p.sex) {
    if (row.sex === p.sex) { points += W.sex; chips.push({ label: p.sex === "M" ? "Male" : "Female", strength: "exact" }); }
    else missed.push(p.sex === "M" ? "Male" : "Female");
  }
  return { points, chips, missed };
}

// The best of a list by points, or an empty result (with everything missed) when the list is empty.
function best(items, scoreOne, emptyMissed) {
  let top = null;
  for (const item of items) {
    const s = scoreOne(item);
    if (!top || s.points > top.points) top = { ...s, item };
  }
  return top ?? { points: 0, chips: [], missed: emptyMissed, item: null };
}

/*
 * → { score, max, percent, chips: [{ label, strength }], missed: [label],
 *     vehicleRef, personRef }  (the unique_ids of the best-matching vehicle and person)
 *   crash     a crashes row
 *   vehicles  its vehicles rows
 *   persons   its persons rows (involved and not; only involved ones are scored)
 */
export function scoreCrash(c, { crash, vehicles = [], persons = [] }) {
  const W = WEIGHTS;
  let score = 0;
  const chips = [], missed = [];

  if (c.streets.length) {
    const keys = crash.street_keys ?? []; // its crash_streets rows
    let got = 0;
    for (const s of c.streets) {
      const exact = keys.some((k) => k.street === s.key);
      const close = !exact && keys.some((k) => k.street_base === s.base);
      if (exact) { got += 1; chips.push({ label: s.label, strength: "exact" }); }
      else if (close) { got += W.closeStreet; chips.push({ label: `${s.label} (direction differs or missing)`, strength: "close" }); }
      else missed.push(s.label);
    }
    if (got > 0) score += c.streets.length > 1 ? (got / 2) * W.bothStreets : got * W.oneStreet;
  }
  if (c.point) {
    if (crash.latitude != null) {
      const d = distanceMeters(c.point.lat, c.point.lon, crash.latitude, crash.longitude);
      if (d <= c.point.radius) {
        score += W.nearMax - (W.nearMax - W.nearMin) * (d / c.point.radius);
        chips.push({ label: `${Math.round(d)} m from the spot`, strength: d <= c.point.radius / 3 ? "exact" : "close" });
      } else missed.push(`Within ${c.point.radius} m`);
    } else missed.push(`Within ${c.point.radius} m (no map point recorded)`);
  }
  if (c.zip) {
    if (crash.zip_code === c.zip) { score += W.zip; chips.push({ label: `ZIP ${c.zip}`, strength: "exact" }); }
    else missed.push(`ZIP ${c.zip}`);
  }
  if (c.borough) {
    if (crash.borough === c.borough) { score += W.borough; chips.push({ label: boroughLabel(c.borough), strength: "exact" }); }
    else missed.push(boroughLabel(c.borough));
  }
  if (c.time) {
    const m = crash.crash_minute;
    const off = m == null ? Infinity : minutesOutside(m, c.time);
    if (off === 0) { score += W.time; chips.push({ label: `At ${timeLabel(m)}`, strength: "exact" }); }
    else if (off <= NEAR_MINUTES) { score += W.timeNear; chips.push({ label: `At ${timeLabel(m)} (${off} min outside)`, strength: "close" }); }
    else missed.push("Time of day");
  }

  let vehicleRef = null, personRef = null;
  if (c.vehicle) {
    const v = best(vehicles, (row) => scoreVehicle(c.vehicle, row), ["Vehicle details"]);
    score += v.points; chips.push(...v.chips); missed.push(...v.missed);
    vehicleRef = v.points > 0 ? v.item?.unique_id ?? null : null;
  }
  if (c.person) {
    const involved = persons.filter((p) => p.involved);
    const p = best(involved, (row) => scorePerson(c.person, row), ["Person details"]);
    score += p.points; chips.push(...p.chips); missed.push(...p.missed);
    personRef = p.points > 0 ? p.item?.unique_id ?? null : null;
  }

  const max = maxPoints(c);
  score = Math.round(score * 10) / 10;
  return { score, max, percent: max ? Math.round((100 * score) / max) : null, chips, missed, vehicleRef, personRef };
}
