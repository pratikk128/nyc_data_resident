/*
 * NYC Crash Lookup logic: normalizing streets, makes, vehicle types, roles
 * and seats; reading the form; scoring; the candidate SQL (run against a
 * small in-memory SQLite built from source-shaped rows); the daily sync's
 * diff; the page URL; and the HTML.
 *   npm test
 * End-to-end searches against real data: tests/crashes-e2e.test.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { streetMatchKey, streetBaseKey, minuteOf, timeLabel, personRole, positionKey, ageOf, sexOf, yearOf, textOf, rowHash } from "../src/lib/crashes/normalize.js";
import { makeOf, resolveMake } from "../src/lib/crashes/makes.js";
import { vehicleTypeKey, resolveVehicleType } from "../src/lib/crashes/vehicle-types.js";
import { normalizeSearch, streetsFromText, onlyDates } from "../src/lib/crashes/query.js";
import { scoreCrash, maxPoints, minutesOutside, distanceMeters, WEIGHTS } from "../src/lib/crashes/score.js";
import { candidateQuery } from "../src/lib/crashes/search-sql.js";
import { searchCrashes, crashRows } from "../src/lib/crashes/search.js";
import { crashRow, streetRows, vehicleRow, personRow } from "../src/lib/crashes/rows.js";
import { TABLES, INDEXES, COLUMNS } from "../src/lib/crashes/schema.js";
import { crashDetail } from "../src/lib/crashes/detail.js";
import { vehicleSummary, locationLine, roleCountsLine, roleCounts } from "../src/lib/crashes/present.js";
import { valuesToParams, paramsToBody, paramsToValues, hasSearch, openCrash, resultsSummary } from "../src/lib/crashes/page-state.js";
import { cardHtml, detailHtml, chipsHtml } from "../src/lib/crashes/render.js";
import { dateWhere } from "../src/lib/crashes/config.js";

const THROUGH = "2026-10-27";
const criteria = (body) => {
  const { criteria: c, problems } = normalizeSearch(body, { dataThrough: THROUGH });
  assert.deepEqual(problems, []);
  return c;
};

// ---------- Streets ----------

test("streets: one spelling for abbreviations, directions, ordinals, case and spacing", () => {
  const same = (a, b) => assert.equal(streetMatchKey(a), streetMatchKey(b), `${a} ≟ ${b}`);
  same("W 72 St", "WEST 72 STREET");
  same("west 72nd street", "WEST   72 STREET");
  same("3rd Ave", "THIRD AVENUE");
  same("3rd Ave", "3 AVENUE");
  same("E 53 ST", "East 53rd Street");
  same("Francis Lewis Blvd", "FRANCIS LEWIS BOULEVARD");
  same("MC DONALD AVE", "McDonald Avenue");
  same("B'way", "Broadway");
  assert.equal(streetMatchKey("W 72 St"), "WEST72STREET");
});

test("streets: a house number goes, a numbered street stays", () => {
  assert.equal(streetMatchKey("200 WEST 72 STREET"), "WEST72STREET");
  assert.equal(streetMatchKey("1212-14 ATLANTIC AVENUE"), "ATLANTICAVENUE");
  assert.equal(streetMatchKey("45-10 94 STREET"), "94STREET");
  assert.equal(streetMatchKey("72 St"), "72STREET");
  assert.equal(streetMatchKey("100 AVENUE"), "100AVENUE");
  assert.equal(streetMatchKey("   "), null);
});

test("streets: the base form drops East/West so “72 St” finds West 72nd", () => {
  assert.equal(streetBaseKey("WEST72STREET"), "72STREET");
  assert.equal(streetBaseKey(streetMatchKey("72 St")), "72STREET");
  assert.equal(streetBaseKey("WESTENDAVENUE"), "WESTENDAVENUE", "West End Avenue isn't West + End Avenue");
});

test("intersections: either separator, either order, house numbers dropped", () => {
  const keys = (t) => streetsFromText(t).map((s) => s.key);
  assert.deepEqual(keys("Broadway & W 72 St"), ["BROADWAY", "WEST72STREET"]);
  assert.deepEqual(keys("W 72nd St and Broadway"), ["WEST72STREET", "BROADWAY"]);
  assert.deepEqual(keys("broadway / west 72 street"), ["BROADWAY", "WEST72STREET"]);
  assert.deepEqual(keys("Broadway at 72 St"), ["BROADWAY", "72STREET"]);
  assert.deepEqual(keys("350 5th Ave"), ["5AVENUE"]);
});

// ---------- Makes and vehicle types ----------

test("makes: the data's codes with their body class, and spelled-out names", () => {
  assert.deepEqual(makeOf("TOYT -CAR/SUV"), { key: "TOYOTA", class: "car" });
  assert.deepEqual(makeOf("BMW  -CAR/SUV"), { key: "BMW", class: "car" });
  assert.deepEqual(makeOf("FORD-TRUCK/BUS"), { key: "FORD", class: "truck" });
  assert.deepEqual(makeOf("HINO -TRUCK/BUS"), { key: "HINO", class: "truck" });
  assert.deepEqual(makeOf("Ford"), { key: "FORD", class: null });
  assert.deepEqual(makeOf("TOYOT"), { key: "TOYOTA", class: null }, "a truncated name");
  assert.deepEqual(makeOf("MERCEDES BENZ"), { key: "MERCEDES-BENZ", class: null });
  assert.deepEqual(makeOf("ZZZZ -CAR/SUV"), { key: null, class: "car" });
  assert.deepEqual(makeOf(""), { key: null, class: null });
});

test("makes: what people type, exact, a prefix or a typo", () => {
  assert.equal(resolveMake("Toyota").key, "TOYOTA");
  assert.equal(resolveMake("toyt").key, "TOYOTA");
  assert.equal(resolveMake("Chevy").key, "CHEVROLET");
  assert.equal(resolveMake("VW").key, "VOLKSWAGEN");
  assert.deepEqual([resolveMake("Merced").key, resolveMake("Merced").how], ["MERCEDES-BENZ", "prefix"]);
  assert.deepEqual([resolveMake("Toyta").key, resolveMake("Toyta").how], ["TOYOTA", "typo"]);
  assert.equal(resolveMake("Hundai").key, "HYUNDAI");
  assert.equal(resolveMake("xq"), null);
});

test("vehicle types: the form's spellings grouped", () => {
  const t = vehicleTypeKey;
  assert.equal(t("Sedan"), "sedan");
  assert.equal(t("4 dr sedan"), "sedan");
  assert.equal(t("Station Wagon/Sport Utility Vehicle"), "suv");
  assert.equal(t("subn"), "suv");
  assert.equal(t("PK"), "pickup");
  assert.equal(t("Pick-up Truck"), "pickup", "a pickup, not a truck");
  assert.equal(t("Box Truck"), "truck");
  assert.equal(t("Tractor Truck Diesel"), "truck");
  assert.equal(t("AMBULANCE"), "emergency");
  assert.equal(t("Ambulance"), "emergency");
  assert.equal(t("E-Bike"), "e-bike");
  assert.equal(t("Bike"), "bike");
  assert.equal(t("E-Scooter"), "e-scooter");
  assert.equal(t("Moped"), "moped");
  assert.equal(t("Motorscooter"), "moped");
  assert.equal(t("Motorcycle"), "motorcycle");
  assert.equal(t("Taxi"), "taxi");
  assert.equal(t("LIMO"), "taxi");
  assert.equal(t("Bus"), "bus");
  assert.equal(t("van"), "van");
  assert.equal(t("Unknown"), null);
  assert.equal(t(""), null);
  assert.equal(resolveVehicleType("suv"), "suv");
  assert.equal(resolveVehicleType("e bike"), "e-bike");
});

// ---------- People, times, values ----------

test("roles: who was in the crash and who's only on the report", () => {
  assert.equal(personRole("Occupant", "Driver"), "driver");
  assert.equal(personRole("Occupant", "Passenger"), "passenger");
  assert.equal(personRole("Occupant", "Registrant"), "registrant");
  assert.equal(personRole("Pedestrian", "Pedestrian"), "pedestrian");
  assert.equal(personRole("Bicyclist", "Driver"), "cyclist");
  assert.equal(personRole("Other Motorized", "Driver"), "other-motorized");
  assert.equal(personRole("Occupant", "Witness"), "witness");
  assert.equal(personRole("Occupant", "Notified Person"), "notified");
});

test("seats, times, ages and other values", () => {
  assert.equal(positionKey("Driver"), "driver");
  assert.equal(positionKey("Front passenger, if two or more persons, including the driver, are in the front seat"), "front-passenger");
  assert.equal(positionKey("Left rear passenger, or rear passenger on a bicycle, motorcycle, snowmobile"), "rear-left");
  assert.equal(positionKey("Right rear passenger or motorcycle sidecar passenger"), "rear-right");
  assert.equal(positionKey("Unknown"), null);
  assert.equal(minuteOf("9:25"), 565);
  assert.equal(minuteOf("00:00"), 0);
  assert.equal(minuteOf("25:00"), null);
  assert.equal(timeLabel(565), "9:25 AM");
  assert.equal(timeLabel(0), "12:00 AM");
  assert.equal(timeLabel(13 * 60 + 5), "1:05 PM");
  assert.equal(ageOf("34"), 34);
  assert.equal(ageOf("-1"), null);
  assert.equal(ageOf("9999"), null);
  assert.equal(ageOf(""), null);
  assert.equal(sexOf("U"), null);
  assert.equal(yearOf("2019"), 2019);
  assert.equal(yearOf("1066"), null);
  assert.equal(textOf("Unspecified"), null);
  assert.equal(textOf("  Driver   Inattention "), "Driver Inattention");
});

test("row hash: stable across key order, changes with any value", () => {
  assert.equal(rowHash({ a: "1", b: "2" }), rowHash({ b: "2", a: "1" }));
  assert.notEqual(rowHash({ a: "1", b: "2" }), rowHash({ a: "1", b: "3" }));
  assert.match(rowHash({}), /^[0-9a-f]{14}$/);
});

test("date range: one SoQL condition for every table", () => {
  assert.equal(dateWhere({ from: "2024-01-01", to: null }), "crash_date >= '2024-01-01T00:00:00'");
  assert.equal(dateWhere({ from: "2024-01-01", to: "2024-12-31" }), "crash_date >= '2024-01-01T00:00:00' AND crash_date <= '2024-12-31T23:59:59'");
});

// ---------- The form ----------

test("search form: every part optional, values normalized", () => {
  const c = criteria({
    location: { text: "Broadway & W 72 St, Manhattan" },
    date: { from: "2024-06-01", to: "2024-06-30" },
    time: { around: "17:30", within: 60 },
    vehicle: { make: "toyota", yearFrom: "2019", type: "suv", state: "ny" },
    person: { role: "driver", ageFrom: "34", injured: "yes", position: "rear" }
  });
  assert.deepEqual(c.streets.map((s) => s.key), ["BROADWAY", "WEST72STREET"]);
  assert.equal(c.borough, "MANHATTAN");
  assert.deepEqual([c.dateFrom, c.dateTo], ["2024-06-01", "2024-06-30"]);
  assert.deepEqual([c.time.from, c.time.to], [16 * 60 + 30, 18 * 60 + 30]);
  assert.equal(c.vehicle.make.key, "TOYOTA");
  assert.deepEqual([c.vehicle.yearFrom, c.vehicle.yearTo], [2019, 2019]);
  assert.equal(c.vehicle.state, "NY");
  assert.deepEqual([c.person.ageFrom, c.person.ageTo, c.person.injured, c.person.position], [34, 34, true, "rear"]);
  assert.equal(onlyDates(c), false);
});

test("search form: dates stay inside the range; a time window can cross midnight", () => {
  const c = criteria({ date: { from: "2020-01-01" }, time: { around: "23:30", within: 60 } });
  assert.deepEqual([c.dateFrom, c.dateTo], ["2024-01-01", THROUGH]);
  assert.deepEqual([c.time.from, c.time.to], [22 * 60 + 30, 30]);
  assert.equal(onlyDates(criteria({})), true);
});

test("search form: plain-language problems", () => {
  const { problems } = normalizeSearch({
    location: { zip: "07030", lat: 40.74, lon: -74.03 },
    date: { from: "2024-06-30", to: "2024-06-01" },
    vehicle: { yearFrom: "1800", state: "New York" },
    person: { ageFrom: "abc" }
  }, { dataThrough: THROUGH });
  assert.ok(problems.some((p) => /isn’t a New York City ZIP/.test(p)));
  assert.ok(problems.some((p) => /isn’t in New York City/.test(p)), "Hoboken is turned away (inCityLimits)");
  assert.ok(problems.some((p) => /start date is after/.test(p)));
  assert.ok(problems.some((p) => /model year/.test(p)));
  assert.ok(problems.some((p) => /two-letter code/.test(p)));
  assert.ok(problems.some((p) => /Age should be/.test(p)));
});

// ---------- Scoring ----------

const crash = (over = {}) => ({
  collision_id: "c1", crash_date: "2024-06-15", crash_minute: 17 * 60 + 40, borough: "MANHATTAN", zip_code: "10023",
  latitude: 40.7781, longitude: -73.9817, on_street: "BROADWAY", cross_street: "WEST 72 STREET", off_street: null,
  street_keys: [{ street: "BROADWAY", street_base: "BROADWAY" }, { street: "WEST72STREET", street_base: "72STREET" }],
  ...over
});
const vehicle = (over = {}) => ({ unique_id: "v1", make_key: "TOYOTA", make_raw: "TOYT -CAR/SUV", vehicle_year: 2019, type_key: "suv", state_registration: "NY", travel_direction: "North", ...over });
const person = (over = {}) => ({ unique_id: "p1", role: "driver", involved: 1, age: 34, sex: "F", injury: "Injured", position_key: "driver", ...over });

test("score: every detail matching earns the most it can, 100%", () => {
  const c = criteria({
    location: { text: "Broadway & W 72 St", zip: "10023", borough: "MANHATTAN" },
    time: { around: "17:30", within: 30 },
    vehicle: { make: "Toyota", yearFrom: "2019", type: "suv" },
    person: { role: "driver", ageFrom: "34", sex: "F" }
  });
  const fit = scoreCrash(c, { crash: crash(), vehicles: [vehicle()], persons: [person()] });
  assert.equal(fit.score, fit.max);
  assert.equal(fit.percent, 100);
  assert.deepEqual(fit.missed, []);
  assert.equal(fit.vehicleRef, "v1");
  assert.equal(fit.personRef, "p1");
  assert.equal(fit.max, maxPoints(c));
});

test("score: make and year must be on the same vehicle", () => {
  const c = criteria({ vehicle: { make: "Toyota", yearFrom: "2019" } });
  const W = WEIGHTS;
  const split = scoreCrash(c, { crash: crash(), vehicles: [vehicle({ make_key: "HONDA" }), vehicle({ unique_id: "v2", vehicle_year: 2015 })] });
  const same = scoreCrash(c, { crash: crash(), vehicles: [vehicle()] });
  assert.equal(same.score, W.make + W.year + W.makeAndYear);
  assert.equal(split.score, W.make, "the Toyota (wrong year) is the best single vehicle");
  assert.ok(same.score > split.score * 2);
});

test("score: exact beats close beats partial", () => {
  const c = criteria({ vehicle: { yearFrom: "2019" }, person: { ageFrom: "34" } });
  const exact = scoreCrash(c, { crash: crash(), vehicles: [vehicle()], persons: [person()] });
  const close = scoreCrash(c, { crash: crash(), vehicles: [vehicle({ vehicle_year: 2020 })], persons: [person({ age: 36 })] });
  const partial = scoreCrash(c, { crash: crash(), vehicles: [vehicle({ vehicle_year: 2022 })], persons: [person({ age: 39 })] });
  assert.ok(exact.score > close.score && close.score > partial.score);
  assert.equal(close.chips.find((ch) => /2020/.test(ch.label)).strength, "close");
  assert.equal(partial.chips.find((ch) => /Age 39/.test(ch.label)).strength, "partial");
  assert.deepEqual(partial.missed, ["2019 model"]);
});

test("score: the intersection outweighs a borough; a street without its direction is close", () => {
  const both = scoreCrash(criteria({ location: { text: "Broadway & W 72 St" } }), { crash: crash() });
  const boro = scoreCrash(criteria({ location: { borough: "MANHATTAN" } }), { crash: crash() });
  const noDir = scoreCrash(criteria({ location: { text: "72 St" } }), { crash: crash() });
  assert.equal(both.score, WEIGHTS.bothStreets);
  assert.equal(boro.score, WEIGHTS.borough);
  assert.equal(noDir.chips[0].strength, "close");
  assert.ok(noDir.score < WEIGHTS.oneStreet && noDir.score > 0);
});

test("score: registered owners and witnesses aren't matched", () => {
  const c = criteria({ person: { ageFrom: "60", sex: "M" } });
  const fit = scoreCrash(c, { crash: crash(), persons: [person(), person({ unique_id: "p2", role: "registrant", involved: 0, age: 60, sex: "M" })] });
  assert.equal(fit.personRef, null);
  assert.equal(fit.score, 0);
});

test("score: near a spot, closer is better; time windows across midnight", () => {
  const c = criteria({ location: { lat: 40.7781, lon: -73.9817, radius: 250 } });
  const at = scoreCrash(c, { crash: crash() });
  const edge = scoreCrash(c, { crash: crash({ latitude: 40.7781 + 0.002 }) });
  const out = scoreCrash(c, { crash: crash({ latitude: 40.79 }) });
  assert.ok(at.score > edge.score && edge.score > 0 && out.score === 0);
  assert.ok(Math.abs(distanceMeters(40.7781, -73.9817, 40.7781 + 0.002, -73.9817) - 222) < 2);
  assert.equal(minutesOutside(10, { from: 1380, to: 60 }), 0);
  assert.equal(minutesOutside(90, { from: 1380, to: 60 }), 30);
  assert.equal(minutesOutside(1350, { from: 1380, to: 60 }), 30);
});

// ---------- The database: SQL candidates and the full search ----------

function memoryDb(raw) {
  const db = new DatabaseSync(":memory:");
  for (const sql of Object.values(TABLES)) db.exec(sql);
  for (const sql of INDEXES) db.exec(sql);
  const put = (table, row) => db.prepare(`INSERT INTO ${table} (${COLUMNS[table].join(",")}) VALUES (${COLUMNS[table].map(() => "?").join(",")})`)
    .run(...COLUMNS[table].map((c) => row[c] ?? null));
  for (const r of raw.crashes) { const c = crashRow(r); put("crashes", c); for (const s of streetRows(c)) put("crash_streets", s); }
  for (const r of raw.vehicles) put("vehicles", vehicleRow(r));
  for (const r of raw.persons) put("persons", personRow(r));
  return { all: async (sql, params = []) => db.prepare(sql).all(...params) };
}

const id = (n) => n.toString(16).padStart(32, "0");
const RAW = {
  crashes: [
    { collision_id: id(1), crash_date: "2024-06-15T00:00:00.000", crash_time: "17:40", borough: "MANHATTAN", zip_code: "10023", latitude: "40.7781", longitude: "-73.9817", on_street_name: "BROADWAY", cross_street_name: "WEST 72 STREET" },
    { collision_id: id(2), crash_date: "2024-06-15T00:00:00.000", crash_time: "8:05", borough: "MANHATTAN", zip_code: "10023", on_street_name: "WEST 72 STREET", cross_street_name: "COLUMBUS AVENUE" },
    { collision_id: id(3), crash_date: "2025-02-01T00:00:00.000", crash_time: "23:50", borough: "BROOKLYN", zip_code: "11201", latitude: "0", longitude: "0", off_street_name: "200 ATLANTIC AVENUE" },
    { collision_id: id(4), crash_date: "2024-06-16T00:00:00.000", crash_time: "17:35", latitude: "40.7783", longitude: "-73.9819" }
  ],
  vehicles: [
    { unique_id: "v1", collision_id: id(1), crash_date: "2024-06-15T00:00:00.000", vehicle_make: "TOYT -CAR/SUV", vehicle_year: "2019", vehicle_type: "Station Wagon/Sport Utility Vehicle", state_registration: "NY" },
    { unique_id: "v2", collision_id: id(1), crash_date: "2024-06-15T00:00:00.000", vehicle_type: "Bike" },
    { unique_id: "v3", collision_id: id(2), crash_date: "2024-06-15T00:00:00.000", vehicle_make: "TOYT -CAR/SUV", vehicle_year: "2015", vehicle_type: "Sedan", state_registration: "NJ" },
    { unique_id: "v4", collision_id: id(3), crash_date: "2025-02-01T00:00:00.000", vehicle_make: "HOND -CAR/SUV", vehicle_year: "2019", vehicle_type: "Sedan" },
    { unique_id: "v5", collision_id: id(4), crash_date: "2024-06-16T00:00:00.000", vehicle_make: "TOYT -CAR/SUV", vehicle_year: "2020", vehicle_type: "PK" }
  ],
  persons: [
    { unique_id: "p1", collision_id: id(1), crash_date: "2024-06-15T00:00:00.000", vehicle_id: "v1", person_type: "Occupant", ped_role: "Driver", person_age: "34", person_sex: "F", person_injury: "Unspecified", position_in_vehicle: "Driver" },
    { unique_id: "p2", collision_id: id(1), crash_date: "2024-06-15T00:00:00.000", vehicle_id: "v2", person_type: "Bicyclist", ped_role: "Driver", person_age: "27", person_sex: "M", person_injury: "Injured" },
    { unique_id: "p3", collision_id: id(1), crash_date: "2024-06-15T00:00:00.000", vehicle_id: "v1", person_type: "Occupant", ped_role: "Registrant", person_age: "61", person_sex: "M" },
    { unique_id: "p4", collision_id: id(2), crash_date: "2024-06-15T00:00:00.000", vehicle_id: "v3", person_type: "Occupant", ped_role: "Driver", person_age: "50", person_sex: "M" },
    { unique_id: "p5", collision_id: id(3), crash_date: "2025-02-01T00:00:00.000", person_type: "Pedestrian", ped_role: "Pedestrian", person_age: "70", person_sex: "F", person_injury: "Injured", ped_location: "Pedestrian/Bicyclist/Other Pedestrian at Intersection" }
  ]
};

test("search: an intersection and a vehicle rank the right crash first, with why", async () => {
  const db = memoryDb(RAW);
  const out = await searchCrashes(db, criteria({ location: { text: "W 72nd St and Broadway" }, vehicle: { make: "Toyota", yearFrom: "2019" } }));
  assert.equal(out.results[0].collisionId, id(1));
  assert.equal(out.results[0].percent, 100);
  // 2: one of the streets + a Toyota (27); 4: a Toyota a year off (26); 3: a 2019 Honda (8).
  assert.deepEqual(out.results.map((r) => r.collisionId), [id(1), id(2), id(4), id(3)]);
  assert.equal(out.results[0].vehicles, "2019 Toyota SUV (NY) + Bicycle");
  assert.equal(out.results[0].people, "1 driver, 1 cyclist", "the registered owner isn't counted");
  assert.ok(out.results[0].chips.some((c) => c.label === "Toyota"));
  assert.equal(out.total, 4);
});

test("search: the date range filters; a spot finds crashes with no street; dates alone list newest first", async () => {
  const db = memoryDb(RAW);
  const in2025 = await searchCrashes(db, criteria({ date: { from: "2025-01-01" }, vehicle: { yearFrom: "2019" } }));
  assert.deepEqual(in2025.results.map((r) => r.collisionId), [id(3)]);
  const near = await searchCrashes(db, criteria({ location: { lat: 40.7781, lon: -73.9817, radius: 100 } }));
  assert.deepEqual(near.results.map((r) => r.collisionId), [id(1), id(4)]);
  assert.equal(near.results[1].location, null, "crash 4 has a map point but no street");
  const dates = await searchCrashes(db, criteria({ date: { from: "2024-06-15", to: "2024-06-16" } }));
  assert.equal(dates.dateOnly, true);
  assert.equal(dates.results[0].collisionId, id(4));
});

test("search: person details match people in the crash; a time window", async () => {
  const db = memoryDb(RAW);
  const cyclist = await searchCrashes(db, criteria({ person: { role: "cyclist", ageFrom: "26", ageTo: "28" } }));
  assert.equal(cyclist.results[0].collisionId, id(1));
  const owner = await searchCrashes(db, criteria({ person: { ageFrom: "61" } }));
  assert.ok(!owner.results.some((r) => r.collisionId === id(1)), "the 61-year-old registrant doesn't match");
  const evening = await searchCrashes(db, criteria({ time: { around: "17:30", within: 30 } }));
  assert.deepEqual(new Set(evening.results.map((r) => r.collisionId)), new Set([id(1), id(4)]));
});

test("search SQL: every value bound, under D1's 100-parameter cap", () => {
  const { sql, params } = candidateQuery(criteria({
    location: { text: "Broadway & W 72 St", borough: "MANHATTAN", zip: "10023", lat: 40.7781, lon: -73.9817 },
    time: { around: "17:30", within: 60 },
    vehicle: { make: "Lucid", yearFrom: "2019", yearTo: "2021", type: "sedan", state: "NJ", direction: "North" },
    person: { role: "driver", sex: "F", ageFrom: "30", ageTo: "35", injured: "no", position: "rear-left" }
  }));
  assert.ok(params.length <= 100, `${params.length} parameters`);
  const used = new Set((sql.match(/\?\d+/g) ?? []).map((m) => Number(m.slice(1))));
  assert.deepEqual([...used].sort((a, b) => a - b), params.map((_, i) => i + 1), "each parameter used, in range");
  assert.ok(!/BROADWAY|TOYOTA|10023/.test(sql), "no values in the SQL text");
});

// ---------- Deep dive ----------

test("deep dive: people under their vehicle, cyclists apart, owners on their own", async () => {
  const db = memoryDb(RAW);
  const d = crashDetail((await crashRows(db, [id(1)])).get(id(1)));
  assert.equal(d.vehicles.length, 2);
  assert.deepEqual(d.vehicles[0].people.map((p) => p.role), ["driver"]);
  assert.deepEqual(d.outside.map((p) => p.role), ["cyclist"]);
  assert.equal(d.outside[0].recognize.vehicle, "Vehicle 2: Bicycle");
  assert.deepEqual(d.notInvolved.map((p) => p.role), ["registrant"]);
  assert.equal(d.recognize.location, "Broadway & West 72nd Street");
  assert.equal(d.details.factors.length, 0);
  const html = detailHtml(d);
  assert.ok(html.indexOf("Is this the crash?") < html.indexOf("What happened"), "recognition first");
  assert.match(html, /<div id="cl-details-body" hidden>/, "crash details start collapsed");
  assert.match(html, /Not recorded/);
  assert.match(html, /h9gi-nx95/);
});

// ---------- Daily sync ----------

test("sync diff: writes only new or changed rows, deletes what the source dropped", async () => {
  const { diffTable } = await import("./support/workers.js").then(() => import("../src/lib/server/crashes-sync.js"));
  const [a, b] = RAW.crashes;
  const stored = [{ id: a.collision_id, h: crashRow(a).h }, { id: b.collision_id, h: "old" }, { id: id(9), h: "x" }];
  const { upserts, deletes } = diffTable("crashes", [a, b, RAW.crashes[2]], stored);
  assert.deepEqual(upserts.map((r) => r.collision_id), [id(2), id(3)]);
  assert.deepEqual(deletes, [id(9)]);
});

// ---------- Page ----------

test("page URL: form values round-trip into the API body; a spot needs both coordinates", () => {
  const params = valuesToParams({ where: "Broadway & W 72 St", make: "Toyota", yfrom: "2019", lat: "40.7", lon: "", r: "250", at: "", within: "60" }, id(1));
  assert.equal(params.get("lat"), null, "a lat without a lon is dropped");
  assert.equal(params.get("within"), null, "give or take means nothing without a time");
  assert.equal(openCrash(params), id(1));
  assert.ok(hasSearch(params));
  const body = paramsToBody(params);
  assert.equal(body.location.text, "Broadway & W 72 St");
  assert.equal(body.vehicle.make, "Toyota");
  assert.equal(paramsToValues(params).yfrom, "2019");
  assert.equal(hasSearch(new URLSearchParams(`crash=${id(1)}`)), false);
  assert.equal(openCrash(new URLSearchParams("crash=../etc")), null);
  assert.equal(resultsSummary({ total: 120, results: new Array(50), dateOnly: false }), "120 crashes fit at least one detail. Showing the 50 closest.");
});

test("HTML: values are escaped, strength is in words not just color", () => {
  assert.match(chipsHtml([{ label: "2020 model", strength: "close" }]), /close<\/span>/);
  const card = { collisionId: id(1), date: "2024-06-15", time: null, location: "<b>Broadway</b>", area: null, vehicles: "x", people: "y", injured: 0, killed: 0, percent: 80, chips: [], missed: [] };
  const html = cardHtml(card, 1);
  assert.ok(!html.includes("<b>Broadway"));
  assert.match(html, /time not recorded/);
  assert.equal(vehicleSummary({ type_key: "e-bike" }), "E-bike");
  assert.equal(vehicleSummary({ vehicle_year: 2019, make_key: null, make_raw: "LUCI -CAR/SUV", type_key: "sedan" }), "2019 LUCI car");
  assert.equal(locationLine({ off_street: "200 WEST 72 STREET" }), "200 West 72nd Street");
  assert.equal(roleCountsLine(roleCounts([{ role: "pedestrian", involved: 1 }, { role: "pedestrian", involved: 1 }])), "2 pedestrians");
});
