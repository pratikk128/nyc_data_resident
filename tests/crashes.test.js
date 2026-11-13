/*
 * The crash data behind NYC Crash Hotspots: normalizing streets, makes,
 * vehicle types and times; and the date range.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { streetMatchKey, streetBaseKey, minuteOf, timeLabel, sexOf, yearOf, textOf, rowHash } from "../src/lib/crashes/normalize.js";
import { makeOf, resolveMake } from "../src/lib/crashes/makes.js";
import { vehicleTypeKey, resolveVehicleType } from "../src/lib/crashes/vehicle-types.js";
import { streetsFromText } from "../src/lib/crashes/hotspot-query.js";
import { crashRow } from "../src/lib/crashes/rows.js";
import { dateWhere, dateRange } from "../src/lib/crashes/config.js";

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
  assert.deepEqual(makeOf("YAMA -MCL"), { key: "YAMAHA", class: "motorcycle" });
  assert.deepEqual(makeOf("HD -MCL"), { key: "HARLEY-DAVIDSON", class: "motorcycle" });
  assert.deepEqual(makeOf("RAMB -CAR/SUV"), { key: "RAM", class: "car" });
  assert.deepEqual(makeOf("THMS-TRUCK/BUS"), { key: "THOMAS BUILT", class: "truck" });
  assert.equal(makeOf("NE/FL").key, "NEW FLYER");
  assert.equal(makeOf("Zhilo").key, "ZHILO");
  assert.equal(makeOf("FISKE").key, "FISKER", "a truncated name");
  assert.equal(makeOf("UNK").key, null);
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
  assert.equal(t("Utility"), "suv", "the data's bare Utility is nearly all cars");
  assert.equal(t("Utility Truck"), "truck");
  assert.equal(t("Standing Scooter"), "e-scooter");
  assert.equal(t("Unknown Car"), "sedan");
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

// ---------- Times, values ----------

test("times and other values", () => {
  assert.equal(minuteOf("9:25"), 565);
  assert.equal(minuteOf("00:00"), 0);
  assert.equal(minuteOf("25:00"), null);
  assert.equal(timeLabel(565), "9:25 AM");
  assert.equal(timeLabel(0), "12:00 AM");
  assert.equal(timeLabel(13 * 60 + 5), "1:05 PM");
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

test("date range: the last year, rolling with today", () => {
  assert.deepEqual(dateRange("2026-10-31"), { from: "2025-10-31", to: null });
  assert.deepEqual(dateRange("2028-02-29"), { from: "2027-03-01", to: null });
});

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
  ]
};

