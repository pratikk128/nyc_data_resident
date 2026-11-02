/*
 * What someone entered in the lookup form → the criteria search.js scores
 * against. Browser-safe: the page checks the form with it before sending,
 * and POST /api/crashes/search runs it again on what arrives.
 *
 * Every field is optional. The body:
 *   location  { text?, borough?, zip?, lat?, lon?, radius? }   radius in meters, with lat/lon
 *   date      { from?, to? }                                  YYYY-MM-DD, kept inside dateRange()
 *   time      { around: "HH:MM", within: minutes } | { from: "HH:MM", to: "HH:MM" }
 *   vehicle   { make?, yearFrom?, yearTo?, type?, state?, direction? }
 *   person    { role?, sex?, ageFrom?, ageTo?, injured?: "yes" | "no", position? }
 *             position: a POSITIONS key, or "rear" for any back seat
 *
 * → { criteria, problems }: problems are sentences for the form; criteria
 *   leave out whatever couldn't be read.
 */
import { dateRange } from "./config.js";
import { nycToday, date as longDate } from "../format.js";
import { streetMatchKey, streetBaseKey, minuteOf, INVOLVED_ROLES, POSITIONS } from "./normalize.js";
import { resolveMake } from "./makes.js";
import { resolveVehicleType } from "./vehicle-types.js";
import { parseLocationInput, prettyStreet } from "../complaints311/location-input.js";
import { inCityLimits } from "../in-city.js";

export const RADIUS_CHOICES = [100, 250, 500, 1000]; // meters
export const DEFAULT_RADIUS = 250;
export const TIME_WINDOWS = [30, 60, 120, 180]; // ± minutes
export const MAX_TEXT = 120;
export const DIRECTIONS = ["North", "South", "East", "West", "Northeast", "Northwest", "Southeast", "Southwest"];

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const intIn = (v, lo, hi) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
};

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

function readLocation(loc = {}, problems) {
  const out = { streets: [], borough: null, zip: null, point: null };
  const parsed = parseLocationInput({ text: clean(loc.text), borough: clean(loc.borough).toUpperCase(), zip: clean(loc.zip) });
  if (parsed.kind === "error") problems.push(parsed.message);
  else if (parsed.kind !== "empty") {
    out.borough = parsed.borough ?? null;
    out.zip = parsed.zip ?? null;
    if (parsed.text) out.streets = streetsFromText(parsed.text);
  }
  const lat = Number(loc.lat), lon = Number(loc.lon);
  if (loc.lat != null && loc.lon != null && loc.lat !== "" && loc.lon !== "") {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inCityLimits(lat, lon)) {
      problems.push("That spot isn’t in New York City. Pick a place in the five boroughs.");
    } else {
      const r = Number(loc.radius);
      out.point = { lat, lon, radius: RADIUS_CHOICES.includes(r) ? r : DEFAULT_RADIUS };
    }
  }
  return out;
}

function readDates(date = {}, problems, dataThrough, today) {
  const range = dateRange(today);
  const lo = range.from, hi = range.to ?? dataThrough ?? today;
  let from = clean(date.from), to = clean(date.to);
  for (const [name, v] of [["start", from], ["end", to]]) {
    if (v && !isDate(v)) problems.push(`The ${name} date should look like ${hi}.`);
  }
  from = isDate(from) ? from : lo;
  to = isDate(to) ? to : hi;
  if (from > to) {
    problems.push("The start date is after the end date.");
    [from, to] = [to, from];
  }
  if (to < lo || from > hi) problems.push(`This lookup covers crashes from ${longDate(lo)} to ${longDate(hi)}.`);
  return { from: from < lo ? lo : from, to: to > hi ? hi : to, given: Boolean(clean(date.from) || clean(date.to)) };
}

// → { from, to } in minutes after midnight; from > to when the window crosses midnight.
function readTime(time = {}, problems) {
  if (time.around != null && clean(time.around)) {
    const at = minuteOf(clean(time.around));
    const within = TIME_WINDOWS.includes(Number(time.within)) ? Number(time.within) : 60;
    if (at == null) { problems.push("The time should look like 14:30."); return null; }
    return { from: (at - within + 1440) % 1440, to: (at + within) % 1440, around: at, within };
  }
  if (clean(time.from) || clean(time.to)) {
    const from = minuteOf(clean(time.from)), to = minuteOf(clean(time.to));
    if (from == null || to == null) { problems.push("Give both ends of the time range, like 08:00 to 10:00."); return null; }
    return { from, to };
  }
  return null;
}

function readVehicle(v = {}, problems) {
  const out = {};
  const makeText = clean(v.make);
  if (makeText) {
    const make = resolveMake(makeText);
    // An unknown make is matched by the start of its name, so it needs a few letters to go on.
    if (make) out.make = make;
    else if (makeText.replace(/[^A-Za-z0-9]/g, "").length >= 3) out.make = { key: null, label: makeText, how: "unknown", text: makeText.toUpperCase() };
    else problems.push(`We don’t know the make “${makeText}”. Try its name, like Toyota or Ford.`);
  }
  const nextYear = new Date().getUTCFullYear() + 1;
  let yearFrom = intIn(v.yearFrom, 1900, nextYear), yearTo = intIn(v.yearTo, 1900, nextYear);
  if (Number.isNaN(yearFrom) || Number.isNaN(yearTo)) problems.push(`A model year is between 1900 and ${nextYear}.`);
  yearFrom = Number.isNaN(yearFrom) ? null : yearFrom;
  yearTo = Number.isNaN(yearTo) ? null : yearTo;
  if (yearFrom != null || yearTo != null) {
    out.yearFrom = yearFrom ?? yearTo;
    out.yearTo = yearTo ?? yearFrom;
    if (out.yearFrom > out.yearTo) [out.yearFrom, out.yearTo] = [out.yearTo, out.yearFrom];
  }
  const type = resolveVehicleType(clean(v.type));
  if (clean(v.type) && !type) problems.push(`We don’t know the vehicle type “${clean(v.type)}”. Pick one from the list.`);
  if (type) out.type = type;
  const state = clean(v.state).toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) problems.push("Plate state is a two-letter code, like NY or NJ.");
  else if (state) out.state = state;
  const dir = DIRECTIONS.find((d) => d.toLowerCase() === clean(v.direction).toLowerCase());
  if (dir) out.direction = dir;
  return Object.keys(out).length ? out : null;
}

function readPerson(p = {}, problems) {
  const out = {};
  const role = clean(p.role).toLowerCase();
  if (INVOLVED_ROLES.includes(role)) out.role = role;
  const sex = clean(p.sex).toUpperCase();
  if (sex === "M" || sex === "F") out.sex = sex;
  let ageFrom = intIn(p.ageFrom, 0, 110), ageTo = intIn(p.ageTo, 0, 110);
  if (Number.isNaN(ageFrom) || Number.isNaN(ageTo)) problems.push("Age should be a whole number from 0 to 110.");
  ageFrom = Number.isNaN(ageFrom) ? null : ageFrom;
  ageTo = Number.isNaN(ageTo) ? null : ageTo;
  if (ageFrom != null || ageTo != null) {
    out.ageFrom = ageFrom ?? ageTo;
    out.ageTo = ageTo ?? ageFrom;
    if (out.ageFrom > out.ageTo) [out.ageFrom, out.ageTo] = [out.ageTo, out.ageFrom];
  }
  if (p.injured === "yes" || p.injured === "no") out.injured = p.injured === "yes";
  const position = clean(p.position).toLowerCase();
  if (position === "rear" || POSITIONS.some((x) => x.key === position)) out.position = position;
  return Object.keys(out).length ? out : null;
}

// `today` (YYYY-MM-DD, New York) sets the rolling date range; tests pin it.
export function normalizeSearch(body = {}, { dataThrough, today = nycToday() } = {}) {
  const problems = [];
  const location = readLocation(body.location, problems);
  const date = readDates(body.date, problems, dataThrough, today);
  const criteria = {
    ...location,
    dateFrom: date.from,
    dateTo: date.to,
    dateGiven: date.given,
    time: readTime(body.time, problems),
    vehicle: readVehicle(body.vehicle, problems),
    person: readPerson(body.person, problems)
  };
  return { criteria, problems };
}

// True when nothing but the date range was given.
export const onlyDates = (c) =>
  !c.streets.length && !c.borough && !c.zip && !c.point && !c.time && !c.vehicle && !c.person;

// A stable string for the edge cache key.
export const criteriaKey = (c) => JSON.stringify(c);
