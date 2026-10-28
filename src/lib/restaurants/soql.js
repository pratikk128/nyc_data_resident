/*
 * SoQL query builders for the restaurant inspection dataset (43nn-pn8j).
 * Pure functions: they return the $-parameters, and the server data module
 * (src/lib/server/restaurants.js) sends them. Text fields in the data are
 * uppercase and inconsistent, so text matches use upper() on both sides.
 */
import { BOROUGHS, NOT_INSPECTED_DATE } from "./inspections.js";

export const SEARCH_LIMIT = 25;
const SEARCH_FETCH = 60; // a camis can have several name/address spellings; dedupe, then cut to 25
const NEAR_ME_MILES = 0.5;
// Longer than any name or address in the data; keeps LIKE patterns small.
export const MAX_NAME_LENGTH = 80;
export const MAX_PLACE_LENGTH = 100;

// A SoQL string literal: single quotes doubled.
export function soqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Upper-cased, trimmed, whitespace collapsed, with the like wildcards (% and
// _) taken out so user input only ever matches literally. Apostrophes
// (straight or the curly ones phones type) and underscores become a word
// break, so "Joe’s" finds "JOE'S" and "JOES" alike.
function likeTerm(value) {
  return String(value ?? "").toUpperCase().replace(/%/g, "").replace(/['‘’ʼ`_]/g, " ").replace(/\s+/g, " ").trim();
}

// Each word in order, anything between: "joe pizza" finds "JOE'S PIZZA" and
// "east 14 street" finds "EAST   14 STREET" (the data has runs of spaces).
function contains(column, value) {
  return `upper(${column}) like ${soqlString(`%${likeTerm(value).split(" ").join("%")}%`)}`;
}

// The "Street or ZIP" box. A 5-digit value is a ZIP. A value that starts with
// a number ("123 Broadway", "41-41 Kissena Blvd") is a building number plus a
// street; anything else is part of a street name.
export function parseLocation(text) {
  const value = likeTerm(text);
  if (!value) return null;
  if (/^\d{5}$/.test(value)) return { zipcode: value };
  const m = value.match(/^(\d[\dA-Z-]*)\s+(.+)$/);
  if (m) return { building: m[1], street: m[2] };
  return { street: value };
}

// ~0.5 mile box around a point (1° latitude ≈ 69 miles).
export function boundingBox(lat, lng, miles = NEAR_ME_MILES) {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

// Roughly the five boroughs. "Near me" is only allowed inside, so the box
// can't be used to scan elsewhere; the page checks it too before searching.
export function inNyc(lat, lng) {
  return lat > 40.4 && lat < 41 && lng > -74.3 && lng < -73.6;
}

// Validates and normalizes raw search input. Returns { error } or { query }.
export function normalizeSearch({ name, boro, where, lat, lng } = {}) {
  const cleanName = likeTerm(name);
  if (cleanName.length < 2) return { error: "Type at least 2 letters of the restaurant name." };
  if (cleanName.length > MAX_NAME_LENGTH) return { error: `Keep the restaurant name under ${MAX_NAME_LENGTH} characters.` };
  if (likeTerm(where).length > MAX_PLACE_LENGTH) return { error: `Keep the street or ZIP under ${MAX_PLACE_LENGTH} characters.` };
  const query = { name: cleanName };
  if (boro && boro !== "All") {
    if (!BOROUGHS.includes(boro)) return { error: "Pick a borough from the list." };
    query.boro = boro;
  }
  const location = parseLocation(where);
  if (location) query.location = location;
  if (lat != null && lng != null && lat !== "" && lng !== "") {
    const la = Number(lat), lo = Number(lng);
    if (!inNyc(la, lo)) return { error: "“Near me” only works inside New York City." };
    query.near = { lat: Math.round(la * 1e4) / 1e4, lng: Math.round(lo * 1e4) / 1e4 };
  }
  return { query };
}

export function searchWhere(query) {
  const parts = [contains("dba", query.name)];
  if (query.boro) parts.push(`boro = ${soqlString(query.boro)}`);
  const loc = query.location;
  if (loc?.zipcode) parts.push(`zipcode = ${soqlString(loc.zipcode)}`);
  if (loc?.building) parts.push(`upper(building) = ${soqlString(loc.building)}`);
  if (loc?.street) parts.push(contains("street", loc.street));
  if (query.near) {
    const b = boundingBox(query.near.lat, query.near.lng);
    parts.push(`latitude between ${b.south.toFixed(5)} and ${b.north.toFixed(5)}`);
    parts.push(`longitude between ${b.west.toFixed(5)} and ${b.east.toFixed(5)}`);
  }
  return parts.join(" AND ");
}

export function searchParams(query) {
  return {
    $select: "camis, dba, building, street, boro, zipcode, cuisine_description, max(inspection_date) AS last_inspected",
    $where: searchWhere(query),
    $group: "camis, dba, building, street, boro, zipcode, cuisine_description",
    $order: "dba, camis",
    $limit: String(SEARCH_FETCH)
  };
}

// Every graded row for a batch of restaurants; latestGrade() picks per camis.
export function gradesParams(camisList) {
  return {
    $select: "camis, grade, grade_date, inspection_date",
    $where: `camis in (${camisList.map(soqlString).join(", ")}) AND grade IS NOT NULL`,
    $group: "camis, grade, grade_date, inspection_date",
    $limit: "5000"
  };
}

export function detailParams(camis) {
  return {
    $where: `camis = ${soqlString(camis)}`,
    $order: "inspection_date DESC, violation_code",
    $limit: "5000"
  };
}

// ---------- Benchmarks (run once a day) ----------

const inWindow = (since) => `inspection_date >= '${since}T00:00:00' AND inspection_date > '${NOT_INSPECTED_DATE}T00:00:00'`;

// Denominator: every inspection (camis + date) in the window, violations or
// not, plus the number of restaurants behind them.
export function restaurantCountParams(since, { bySimilar = false } = {}) {
  return {
    $select: `${bySimilar ? "cuisine_description, boro, " : ""}count(distinct camis) AS restaurants, ` +
      "count(distinct camis || inspection_date::text) AS inspections",
    $where: inWindow(since),
    ...(bySimilar && { $group: "cuisine_description, boro" }),
    $limit: "50000"
  };
}

// One citation per inspection, code and text, the same de-duplication
// groupInspections() applies to a single restaurant's rows.
const CITATION_KEY = "camis || '|' || inspection_date::text || '|' || trim(violation_code) || '|' || " +
  "coalesce(violation_description, '')";

// Numerator: cited critical violations per code family ("02", "15", ...).
export function familyCountParams(since, { bySimilar = false } = {}) {
  const keys = bySimilar ? "cuisine_description, boro, " : "";
  return {
    $select: `${keys}substring(violation_code, 1, 2) AS fam, count(distinct ${CITATION_KEY}) AS n`,
    $where: `${inWindow(since)} AND violation_code IS NOT NULL AND critical_flag = 'Critical'`,
    $group: `${keys}fam`,
    $limit: "50000"
  };
}

export function similarKey(cuisine, boro) {
  return `${cuisine ?? ""}|${boro ?? ""}`;
}
