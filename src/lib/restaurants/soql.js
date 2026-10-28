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

// A SoQL string literal: single quotes doubled.
export function soqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Upper-cased, trimmed, whitespace collapsed, with the like wildcard removed
// so user input only ever matches literally.
function likeTerm(value) {
  return String(value ?? "").toUpperCase().replace(/%/g, "").replace(/\s+/g, " ").trim();
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

// Validates and normalizes raw search input. Returns { error } or { query }.
export function normalizeSearch({ name, boro, where, lat, lng } = {}) {
  const cleanName = likeTerm(name);
  if (cleanName.length < 2) return { error: "Type at least 2 letters of the restaurant name." };
  const query = { name: cleanName };
  if (boro && boro !== "All") {
    if (!BOROUGHS.includes(boro)) return { error: "Pick a borough from the list." };
    query.boro = boro;
  }
  const location = parseLocation(where);
  if (location) query.location = location;
  if (lat != null && lng != null && lat !== "" && lng !== "") {
    const la = Number(lat), lo = Number(lng);
    // Roughly the five boroughs, so the box can't be used to scan elsewhere
    if (!(la > 40.4 && la < 41 && lo > -74.3 && lo < -73.6)) return { error: "“Near me” only works inside New York City." };
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

// Numerator: cited critical violations per code family ("02", "15", ...).
export function familyCountParams(since, { bySimilar = false } = {}) {
  const keys = bySimilar ? "cuisine_description, boro, " : "";
  return {
    $select: `${keys}substring(violation_code, 1, 2) AS fam, count(*) AS n`,
    $where: `${inWindow(since)} AND violation_code IS NOT NULL AND critical_flag = 'Critical'`,
    $group: `${keys}fam`,
    $limit: "50000"
  };
}

export function similarKey(cuisine, boro) {
  return `${cuisine ?? ""}|${boro ?? ""}`;
}
