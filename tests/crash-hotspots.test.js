/*
 * NYC Crash Hotspots: the crash groups and severity (facts.js), the URL and
 * modes (hotspot-query.js), the SQL on an in-memory database (hotspot-sql.js),
 * the same numbers counted in JS (hotspot-compute.js), the build that
 * fetches the source and stores them (server/crash-hotspots.js), and what
 * the page says (hotspot-view.js, hotspot-render.js).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { WHO, CAUSES, MANEUVERS, VEHICLES, DIMENSIONS, causeKey, maneuverKey, maskOf, keysOf, factsRow, cornerOf, cellOf, byCrash } from "../src/lib/crashes/facts.js";
import { readQuery, queryToParams, queryKey, placeFromText, filtersFor } from "../src/lib/crashes/hotspot-query.js";
import { totalsSql, boroughTotalsSql, readTotals, addTotals, cornersSql, readCorners, cornerRankSql, areaBoroughSql, pointsSql, factsPageSql, STREET_SEP } from "../src/lib/crashes/hotspot-sql.js";
import { packFacts, unpackFacts, summarize, mapOf } from "../src/lib/crashes/hotspot-compute.js";
import { streetMatchKey, streetBaseKey } from "../src/lib/crashes/normalize.js";
import { boroughLabel } from "../src/lib/complaints311/config.js";
import { statCards, watchFor, patterns, mostCommon, cornerFindings, tipFor, howOften, groupTitle, toCsv, WATCH, CORNER, TIPS } from "../src/lib/crashes/hotspot-view.js";
import { watchHtml, spotsHtml } from "../src/lib/crashes/hotspot-render.js";
import { crashRow, streetRows, vehicleRow } from "../src/lib/crashes/rows.js";
import { TABLES, INDEXES, COLUMNS } from "../src/lib/crashes/schema.js";
import { SOURCE_COLUMNS } from "../src/lib/crashes/config.js";
import { VEHICLE_TYPES } from "../src/lib/crashes/vehicle-types.js";

const q = (s) => readQuery(new URLSearchParams(s));

// ---------- Groups ----------

test("groups: bits are unique, fit an int, and never move", () => {
  for (const groups of [WHO, CAUSES, MANEUVERS, VEHICLES]) {
    const bits = groups.map((g) => g.bit);
    assert.equal(new Set(bits).size, bits.length);
    assert.ok(bits.every((b) => Number.isInteger(b) && b >= 0 && b < 31));
    assert.equal(new Set(groups.map((g) => g.key)).size, groups.length);
  }
  // Packed into the facts in KV and cached by browsers: changing one relabels crashes in a cached copy.
  assert.deepEqual(Object.fromEntries(CAUSES.map((c) => [c.key, c.bit])), {
    distracted: 0, yield: 1, tailgating: 2, speeding: 3, "red-light": 4, lane: 5, turning: 6, backing: 7,
    impaired: 8, aggressive: 9, inexperience: 10, "drowsy-ill": 11, road: 12, "ped-error": 13, defect: 14
  });
  assert.deepEqual(MANEUVERS.map((m) => [m.key, m.bit]).sort((a, b) => a[1] - b[1]).map((m) => m[0]),
    ["left-turn", "right-turn", "u-turn", "lane-change", "backing", "stop-go", "parking", "wrong-way", "straight"]);
  assert.deepEqual(WHO.map((w) => w.bit), [0, 1, 2, 3, 4]);
  // Every vehicle-types.js key has a bit.
  assert.deepEqual(VEHICLES.map((v) => v.key).sort(), VEHICLE_TYPES.map((v) => v.key).sort());
});

test("causes and maneuvers: the form's wording grouped, the vague left out", () => {
  assert.equal(causeKey("Driver Inattention/Distraction"), "distracted");
  assert.equal(causeKey("Cell Phone (hand-Held)"), "distracted");
  assert.equal(causeKey("Unsafe Speed"), "speeding");
  assert.equal(causeKey("Traffic Control Disregarded"), "red-light");
  assert.equal(causeKey("Traffic Control Device Improper/Non-Working"), "road");
  assert.equal(causeKey("Lane Marking Improper/Inadequate"), "road");
  assert.equal(causeKey("Unsafe Lane Changing"), "lane");
  assert.equal(causeKey("Passing Too Closely"), "lane");
  assert.equal(causeKey("Failure to Yield Right-of-Way"), "yield");
  assert.equal(causeKey("Alcohol Involvement"), "impaired");
  assert.equal(causeKey("Pedestrian/Bicyclist/Other Pedestrian Error/Confusion"), "ped-error");
  assert.equal(causeKey("Tire Failure/Inadequate"), "defect");
  assert.equal(causeKey("Illnes"), "drowsy-ill");
  assert.equal(causeKey("Other Vehicular"), null);
  assert.equal(causeKey(null), null);
  assert.equal(maneuverKey("Making Left Turn"), "left-turn");
  assert.equal(maneuverKey("Making Left Turn on Red"), "left-turn");
  assert.equal(maneuverKey("Making U Turn"), "u-turn");
  assert.equal(maneuverKey("Starting from Parking"), "parking");
  assert.equal(maneuverKey("Parked"), "parking");
  assert.equal(maneuverKey("Avoiding double parked/stopped vehicle"), null);
  assert.equal(maneuverKey("Going Straight Ahead"), "straight");
  assert.equal(maneuverKey("Merging"), "lane-change");
});

test("masks: keys in, keys out, unknown keys skipped", () => {
  const m = maskOf(CAUSES, ["speeding", "road", "nope"]);
  assert.equal(m, (1 << 3) | (1 << 12));
  assert.deepEqual(keysOf(CAUSES, m).sort(), ["road", "speeding"]);
});

test("places: corners either way round, a grid square, Monday first", () => {
  const a = cornerOf("BROADWAY", "WEST 72 STREET"), b = cornerOf("W 72nd St", "Broadway");
  assert.equal(a.key, b.key);
  assert.equal(a.label, "Broadway & West 72nd Street");
  assert.deepEqual(cornerOf("BROADWAY", null), { key: null, label: null });
  assert.deepEqual(cornerOf("BROADWAY", "BROADWAY"), { key: null, label: null });
  assert.equal(cellOf(40.7781, -73.9817), cellOf(40.7785, -73.9812));
  assert.equal(cellOf(null, -73.98), null);
});

// ---------- Fixtures ----------

const id = (n) => n.toString(16).padStart(32, "0");
const day = (d) => `${d}T00:00:00.000`;
const RAW = {
  crashes: [
    // Broadway & W 72: a car turning left hits a pedestrian, hurt
    { collision_id: id(1), crash_date: day("2025-03-03"), crash_time: "17:40", borough: "MANHATTAN", zip_code: "10023", latitude: "40.7781", longitude: "-73.9817",
      on_street_name: "BROADWAY", cross_street_name: "WEST 72 STREET", number_of_persons_injured: "1", number_of_pedestrians_injured: "1",
      contributing_factor_vehicle_1: "Failure to Yield Right-of-Way", vehicle_type_code1: "Sedan" },
    // Same corner, written the other way round: speeding, an e-bike rider hurt (in no count but the total) and the SUV's driver
    { collision_id: id(2), crash_date: day("2025-03-04"), crash_time: "23:15", borough: "MANHATTAN", zip_code: "10023", latitude: "40.7782", longitude: "-73.9816",
      on_street_name: "W 72 ST", cross_street_name: "BROADWAY", number_of_persons_injured: "2", number_of_motorist_injured: "1", contributing_factor_vehicle_1: "Unsafe Speed",
      vehicle_type_code1: "Station Wagon/Sport Utility Vehicle", vehicle_type_code2: "E-Bike" },
    // Same corner, nobody hurt, a truck backing
    { collision_id: id(3), crash_date: day("2025-04-10"), crash_time: "9:05", borough: "MANHATTAN", zip_code: "10023", latitude: "40.7780", longitude: "-73.9818",
      on_street_name: "BROADWAY", cross_street_name: "WEST 72 STREET", contributing_factor_vehicle_1: "Backing Unsafely", vehicle_type_code1: "Box Truck" },
    // Brooklyn, no vehicle rows (nothing on what they were doing); a cyclist killed
    { collision_id: id(4), crash_date: day("2025-05-01"), crash_time: "2:30", borough: "BROOKLYN", zip_code: "11201", latitude: "40.6887", longitude: "-73.9806",
      on_street_name: "ATLANTIC AVENUE", number_of_persons_killed: "1", number_of_cyclist_killed: "1", vehicle_type_code1: "Bike", vehicle_type_code2: "Sedan" },
    // No location at all
    { collision_id: id(5), crash_date: day("2025-05-02"), borough: "QUEENS" }
  ],
  // Types and first factors are on the crash row (vehicle_type_code*, contributing_factor_vehicle_*).
  vehicles: [
    { unique_id: "v1", collision_id: id(1), pre_crash: "Making Left Turn", contributing_factor_2: "Driver Inattention/Distraction" },
    { unique_id: "v2", collision_id: id(2), pre_crash: "Going Straight Ahead" },
    { unique_id: "v3", collision_id: id(2), pre_crash: "Going Straight Ahead" },
    { unique_id: "v4", collision_id: id(3), pre_crash: "Backing" }
  ]
};

function facts(raw = RAW) {
  const vehicles = byCrash(raw.vehicles.map(vehicleRow));
  return raw.crashes.map(crashRow).map((c) => factsRow(c, vehicles.get(c.collision_id)));
}

test("facts row: who was hurt, how badly, the causes, maneuvers and vehicles", () => {
  const [f1, f2, f3, f4, f5] = facts();
  assert.equal(f1.severity, 1);
  assert.deepEqual(keysOf(WHO, f1.who), ["pedestrian"]);
  assert.deepEqual(keysOf(CAUSES, f1.causes).sort(), ["distracted", "yield"]);
  assert.deepEqual(keysOf(MANEUVERS, f1.maneuvers), ["left-turn"]);
  assert.deepEqual(keysOf(VEHICLES, f1.vehicles), ["sedan"]);
  assert.equal(f1.corner, f2.corner, "the same corner written either way round");

  assert.equal(f2.severity, 1);
  assert.deepEqual(keysOf(WHO, f2.who).sort(), ["e-rider", "occupant"], "the one hurt in no count but the total is an e-rider; the motorist is in the SUV");
  assert.deepEqual([f2.erider_injured, f2.erider_killed, f2.cyc_injured], [1, 0, 0], "the e-rider's own counts leave out the driver");
  assert.deepEqual([f1.ped_injured, f1.ped_killed], [1, 0]);
  assert.deepEqual(keysOf(VEHICLES, f2.vehicles).sort(), ["e-bike", "suv"]);

  assert.equal(f3.severity, 0);
  assert.deepEqual(keysOf(MANEUVERS, f3.maneuvers), ["backing"]);
  assert.deepEqual(keysOf(VEHICLES, f3.vehicles), ["truck"]);

  assert.equal(f4.severity, 2);
  assert.equal(f4.killed, 1);
  assert.deepEqual(keysOf(WHO, f4.who), ["cyclist"]);
  assert.deepEqual([f4.cyc_killed, f4.ped_killed, f4.erider_killed], [1, 0, 0]);
  assert.deepEqual(keysOf(VEHICLES, f4.vehicles).sort(), ["bike", "sedan"]);
  assert.equal(f4.corner, null);

  assert.equal(f5.lat, null);
  assert.equal(f5.cell, null);
});

test("facts row: motorists hurt with a motorcycle in the crash are motorcyclists", () => {
  const crash = (motorists, codes) => crashRow({ collision_id: "m", crash_date: day("2025-06-01"), number_of_persons_injured: String(motorists),
    number_of_motorist_injured: String(motorists), ...Object.fromEntries(codes.map((c, i) => [i ? `vehicle_type_code${i + 1}` : "vehicle_type_code1", c])) });
  const who = (motorists, codes) => keysOf(WHO, factsRow(crash(motorists, codes)).who).sort();
  assert.deepEqual(who(1, ["Motorcycle", "Sedan"]), ["motorcyclist"]);
  assert.deepEqual(who(2, ["Motorcycle", "Sedan"]), ["motorcyclist", "occupant"], "more hurt than motorcycles: someone in the car too");
  assert.deepEqual(who(1, ["Sedan", "Taxi"]), ["occupant"]);
  assert.deepEqual(who(0, ["Motorcycle"]), []);
});

test("facts row: what a vehicle was doing comes from its vehicle row", () => {
  const changed = { ...RAW, vehicles: RAW.vehicles.map((v) => (v.unique_id === "v1" ? { ...v, pre_crash: "Going Straight Ahead" } : v)) };
  assert.deepEqual(keysOf(MANEUVERS, facts(changed)[0].maneuvers), ["straight"]);
  assert.equal(facts()[3].maneuvers, 0, "no vehicle rows, no maneuvers");
});

// ---------- URL ----------

test("query: a mode and a place read from the URL, round-trip in one order", () => {
  const r = q("mode=walk&zip=11211&veh=truck");
  assert.equal(r.mode, "walk");
  assert.deepEqual(r.filters.who, ["pedestrian"]);
  assert.deepEqual(r.filters.veh, [], "the old filter parameters are ignored");
  assert.deepEqual(r.area, { kind: "zip", zip: "11211", label: "ZIP 11211" });
  assert.equal(queryToParams(r).toString(), "zip=11211&mode=walk");
  assert.equal(queryKey(q("mode=bike&zip=11211")), queryKey(q("zip=11211&mode=bike")));
  assert.equal(q("mode=fly").mode, null);
  assert.deepEqual(filtersFor("bike").who, ["cyclist", "e-rider"]);
  assert.deepEqual(filtersFor("drive").who, [], "driving counts every crash");
  assert.deepEqual(filtersFor(null).who, []);
});

test("query: a spot must be in the city; a spot beats a street beats a ZIP beats a borough", () => {
  assert.equal(q("lat=40.7178&lon=-74.0431").area, null, "Jersey City is turned away");
  const spot = q("lat=40.6887&lon=-73.9806&r=500&place=Atlantic Ave&zip=11201").area;
  assert.equal(spot.kind, "point");
  assert.equal(spot.radius, 500);
  assert.equal(q("lat=40.6887&lon=-73.9806&r=123").area.radius, 250);
  assert.equal(q("street=Atlantic Ave&zip=11201").area.kind, "street");
  assert.equal(q("zip=11201&boro=BROOKLYN").area.kind, "zip");
  assert.equal(q("zip=07302").area, null, "not an NYC ZIP");
  assert.deepEqual(q("boro=QUEENS").area, { kind: "borough", borough: "QUEENS", label: "Queens" });
  const corner = q("street=Broadway&cross=W 72 St&boro=MANHATTAN").area;
  assert.equal(corner.streets.length, 2);
  assert.equal(corner.label, "Broadway & W 72nd St, Manhattan");
  // The URL keeps the place, so a reload shows the same thing.
  assert.deepEqual(readQuery(queryToParams({ area: corner, mode: null })).area, corner);
  // "Your location" shows on screen but never goes in the URL.
  const mine = { ...q("lat=40.689&lon=-73.981&place=your location").area, privateLabel: true };
  assert.equal(queryToParams({ area: mine, mode: null }).toString(), "lat=40.689&lon=-73.981");
});

test("place box: ZIP, borough, street and intersection need no lookup; an address does", () => {
  assert.equal(placeFromText("").kind, "empty");
  assert.equal(placeFromText("11211").area.kind, "zip");
  assert.equal(placeFromText("Queens").area.kind, "borough");
  const street = placeFromText("Atlantic Ave, Brooklyn").area;
  assert.equal(street.kind, "street");
  assert.equal(street.borough, "BROOKLYN");
  assert.equal(placeFromText("Broadway & W 72 St").area.streets.length, 2);
  assert.equal(placeFromText("5 Ave & 14 St").area.streets.length, 2, "an intersection of numbered streets isn't an address");
  assert.equal(placeFromText("5 Ave").area.kind, "street");
  assert.equal(placeFromText("350 5th Ave").kind, "lookup");
  assert.equal(placeFromText("07302").kind, "problem");
});

// ---------- SQL ----------

function memoryDb(raw = RAW) {
  const db = new DatabaseSync(":memory:");
  for (const sql of Object.values(TABLES)) db.exec(sql);
  for (const sql of INDEXES) db.exec(sql);
  const put = (table, row) => db.prepare(`INSERT INTO ${table} (${COLUMNS[table].join(",")}) VALUES (${COLUMNS[table].map(() => "?").join(",")})`)
    .run(...COLUMNS[table].map((c) => row[c] ?? null));
  for (const r of raw.crashes) { const c = crashRow(r); put("crashes", c); for (const s of streetRows(c)) put("crash_streets", s); }
  for (const f of facts(raw)) put("crash_facts", f);
  return (stmt) => db.prepare(stmt.sql).all(...stmt.params);
}

test("SQL: totals and per-group counts follow the place and mode", () => {
  const all = memoryDb();
  const city = readTotals(all(totalsSql(q("")))[0]);
  assert.equal(city.crashes, 5);
  assert.equal(city.killed, 1);
  assert.equal(city.injured, 3);
  assert.equal(city.fatalCrashes, 1);
  assert.equal(city.groups.who.pedestrian.n, 1);
  assert.equal(city.groups.who.cyclist.fatal, 1);
  assert.equal(city.groups.maneuvers["left-turn"].n, 1);

  assert.equal(readTotals(all(totalsSql(q("mode=walk")))[0]).crashes, 1, "crashes that hurt a pedestrian");
  const bike = readTotals(all(totalsSql(q("mode=bike")))[0]);
  assert.equal(bike.crashes, 2, "a cyclist or an e-rider");
  assert.deepEqual([bike.injured, bike.killed], [1, 1], "only the cyclists and e-riders, not the SUV's hurt driver");
  const walk = readTotals(all(totalsSql(q("mode=walk")))[0]);
  assert.deepEqual([walk.injured, walk.killed], [1, 0]);
  const drive = readTotals(all(totalsSql(q("mode=drive")))[0]);
  assert.deepEqual([drive.injured, drive.killed], [city.injured, city.killed], "driving: everyone");
  assert.equal(readTotals(all(totalsSql(q("mode=drive")))[0]).crashes, 5, "every crash");
  assert.equal(city.hurtCrashes, 3);
  assert.equal(readTotals(all(totalsSql(q("zip=10023")))[0]).crashes, 3);
  assert.equal(readTotals(all(totalsSql(q("boro=BROOKLYN")))[0]).crashes, 1);
  assert.equal(readTotals(all(totalsSql(q("street=Broadway&cross=W 72 St")))[0]).crashes, 3, "either order on the report");
  assert.equal(readTotals(all(totalsSql(q("street=72 St")))[0]).crashes, 3, "72 St without West takes in West 72nd");
  assert.equal(readTotals(all(totalsSql(q("street=E 72 St")))[0]).crashes, 0, "East isn't West");
  assert.equal(readTotals(all(totalsSql(q("lat=40.7781&lon=-73.9817&r=250")))[0]).crashes, 3);
  assert.equal(readTotals(all(totalsSql(q("lat=40.7900&lon=-73.9817&r=250")))[0]).crashes, 0, "1.3 km north is outside 250 m");
  assert.deepEqual(readTotals(undefined).crashes, 0);
});

test("SQL: borough totals, ranked corners, an intersection's rank, the area's borough, the map", () => {
  const all = memoryDb();
  const rows = all(boroughTotalsSql(q("")));
  const byBorough = Object.fromEntries(rows.map((r) => [r.borough, readTotals(r)]));
  assert.equal(byBorough.MANHATTAN.crashes, 3);
  assert.equal(byBorough.BROOKLYN.crashes, 1);
  assert.equal(addTotals(rows.map((r) => readTotals(r))).crashes, 5, "the boroughs add up to NYC");
  assert.equal(addTotals(rows.map((r) => readTotals(r))).groups.who.pedestrian.n, 1);
  assert.equal(all(boroughTotalsSql(q("mode=walk&zip=10023"))).reduce((s, r) => s + r.crashes, 0), 1, "citywide whatever the area, with the mode");

  const corners = readCorners(all(cornersSql(q(""))));
  assert.equal(corners.length, 1);
  assert.equal(corners[0].n, 3);
  assert.equal(corners[0].hurt, 2);
  assert.equal(corners[0].fatal, 0);
  assert.equal(corners[0].borough, "MANHATTAN");
  assert.ok(Math.abs(corners[0].lat - 40.7781) < 0.001);
  assert.equal(corners[0].groups.vehicles.truck.n, 1);
  assert.equal(all(cornersSql(q("mode=walk"))).length, 0, "fewer than 3 crashes isn't listed");

  assert.deepEqual({ ...all(cornerRankSql(q(""), "MANHATTAN", 2))[0] }, { total: 1, above: 0 });
  assert.deepEqual({ ...all(cornerRankSql(q(""), "MANHATTAN", 1))[0] }, { total: 1, above: 1 });
  assert.equal(all(cornerRankSql(q(""), "BROOKLYN", 1))[0].total, 0, "the Brooklyn crash names no cross street");

  assert.equal(all(areaBoroughSql(q("zip=10023&mode=walk")))[0].borough, "MANHATTAN");
  assert.deepEqual(all(pointsSql(q(""))).map((p) => p.date), ["2025-05-01"], "only the crash that killed someone");
  // A corner from the list, back through the URL, finds the same crashes.
  const [street, cross] = corners[0].label.split(" & ");
  assert.equal(readTotals(all(totalsSql(q(new URLSearchParams({ street, cross, boro: corners[0].borough }).toString())))[0]).crashes, 3);
});

test("SQL: places are bound parameters; filter values never reach the SQL text", () => {
  const stmt = totalsSql(q("street=Broadway'; DROP TABLE crashes;--&mode=walk"));
  assert.ok(!stmt.sql.includes("DROP"));
  assert.ok(stmt.params.length <= 100);
  assert.ok(stmt.params.every((p) => typeof p === "string" || typeof p === "number"));
});

// ---------- What the page says ----------

const groupsWith = (counts) => {
  const groups = {};
  for (const d of DIMENSIONS) {
    groups[d.column] = {};
    for (const g of d.groups) groups[d.column][g.key] = { n: counts[`${d.column}:${g.key}`] ?? 0, fatal: 0 };
  }
  return groups;
};
const totals = (crashes, counts, extra = {}) => ({ crashes, injured: 0, killed: 0, hurtCrashes: 0, fatalCrashes: 0, groups: groupsWith(counts), ...extra });

test("watch for: clearly more common here, enough of them, biggest gap first, the mode's victims left out", () => {
  const summary = {
    area: { kind: "zip", label: "ZIP 11211" },
    compareTo: { kind: "borough", label: "Brooklyn" },
    here: totals(100, { "maneuvers:left-turn": 30, "causes:speeding": 12, "who:pedestrian": 4, "who:cyclist": 20, "causes:distracted": 30, "maneuvers:straight": 80 }),
    compare: totals(1000, { "maneuvers:left-turn": 100, "causes:speeding": 60, "who:pedestrian": 10, "who:cyclist": 50, "causes:distracted": 290, "maneuvers:straight": 100 })
  };
  const items = watchFor(summary);
  assert.deepEqual(items.map((i) => i.id), ["maneuvers:left-turn", "who:cyclist", "causes:speeding"],
    "distracted is about the same; 4 pedestrians is too few; going straight is never listed");
  assert.equal(items[0].title, "A vehicle turning left");
  assert.equal(items[0].of, 100);
  assert.equal(watchFor(summary, "bike").some((i) => i.column === "who"), false, "with a mode, who was hurt is the given");
  assert.match(watchFor(summary, "walk")[0].tip, /walk signal/, "the tip talks to someone walking");
  assert.deepEqual(watchFor({ ...summary, compare: null }), []);
  // One intersection has fewer crashes, so CORNER's lower bar applies.
  const corner = { ...summary, area: { kind: "corner", label: "A & B" },
    here: totals(8, { "maneuvers:left-turn": 3 }), compare: totals(1000, { "maneuvers:left-turn": 100 }) };
  assert.deepEqual(watchFor(corner).map((i) => i.id), ["maneuvers:left-turn"]);
  assert.ok(CORNER.minLocal < WATCH.minLocal && CORNER.minLocal > 1);

  const html = watchHtml(items, { compareLabel: "Brooklyn", areaLabel: "ZIP 11211", enough: true });
  assert.match(html, /3\.0× as common as across Brooklyn/);
  assert.match(html, /30 of 100 crashes here \(30%\) vs 10% across Brooklyn/);
  assert.match(watchHtml([], { compareLabel: "Brooklyn", enough: true }), /Nothing stands out/);
  assert.match(watchHtml([], { compareLabel: "Brooklyn", areaLabel: "<b>", enough: false }), /&#60;b&#62;/);
  const common = mostCommon(totals(9, { "causes:distracted": 4, "vehicles:truck": 6 }), totals(1000, { "causes:distracted": 400, "vehicles:truck": 50 }));
  assert.equal(common.id, "causes:distracted", "a cause or action, not a vehicle, and in at least a third");
  assert.match(watchHtml([], { compareLabel: "Brooklyn", enough: true, common }), /Most common here[\s\S]*Distracted driving/);
  assert.equal(mostCommon(totals(9, { "causes:distracted": 2 }), totals(100, {})), null, "too few");
});

test("tips: every one has a general line; a mode's line when there is one", () => {
  for (const [id, t] of Object.entries(TIPS)) assert.ok(t.all, id);
  assert.equal(tipFor("causes:aggressive", "walk"), TIPS["causes:aggressive"].all);
  assert.notEqual(tipFor("maneuvers:right-turn", "bike"), TIPS["maneuvers:right-turn"].all);
  assert.equal(tipFor("nope", "walk"), null);
});

test("stat cards: crashes that hurt the mode's someone, how often, people killed and hurt, an intersection's rank", () => {
  const base = { dateFrom: "2024-06-01", dataThrough: "2025-05-31", area: { kind: "zip", label: "ZIP 11211" } };
  const here = totals(730, {}, { injured: 400, killed: 2, hurtCrashes: 365, fatalCrashes: 2 });
  const cards = statCards({ ...base, here });
  assert.deepEqual(cards.map((c) => c.name), ["hurt", "killed", "crashes"]);
  assert.equal(cards[0].label, "Crashes that hurt someone");
  assert.equal(cards[0].value, "365");
  assert.equal(cards[0].context, "About 7 a week.", "under 1.5 a day reads as a week");
  assert.equal(cards[1].value, "2");
  assert.equal(statCards({ ...base, here }, "walk")[0].label, "Crashes that hurt a pedestrian");
  assert.equal(cards[1].context, "400 people hurt.");
  assert.equal(cards[1].label, "People killed");
  assert.equal(statCards({ ...base, here }, "bike")[1].label, "Cyclists and e-riders killed");
  assert.equal(statCards({ ...base, here }, "walk")[1].context, "400 pedestrians hurt.");
  assert.equal(statCards({ ...base, here }, "walk").length, 2, "walking: every crash counted hurt someone, so no all-crashes card");
  const rank = statCards({ ...base, area: { kind: "corner", label: "A & B" }, here, rank: { label: "Brooklyn", total: 4000, above: 9 } });
  assert.equal(rank[2].value, "#10");
  assert.match(rank[2].context, /of 4,000 where a crash hurt someone\. In the worst 1%\./);
  assert.equal(howOften(3, 365), "3 in the last year.");
  assert.equal(howOften(40, 365), "About 3 a month.");
  assert.equal(howOften(1000, 365), "About 3 a day.");
  assert.equal(toCsv(["a", "b"], [["x, y", 'say "hi"']]), 'a,b\n"x, y","say ""hi"""');
  assert.equal(groupTitle("vehicles", VEHICLES.find((v) => v.key === "suv")), "An SUV involved");
  assert.equal(groupTitle("vehicles", VEHICLES.find((v) => v.key === "e-bike")), "An e-bike involved");
  assert.equal(groupTitle("who", WHO[0]), "Pedestrians hurt");
});

test("dangerous intersections: each against its own borough, numbered, escaped, with the place for the click", () => {
  const corner = (label, borough, counts) => ({ corner: label, label, borough, lat: 40.7, lon: -73.9, n: 10, hurt: 6, injured: 7, killed: 0, fatal: 1, groups: groupsWith(counts) });
  const summary = {
    city: totals(2000, { "vehicles:truck": 320 }),
    boroughs: { MANHATTAN: totals(1000, { "vehicles:truck": 20 }), BROOKLYN: totals(1000, { "vehicles:truck": 300 }) },
    corners: [
      corner("Broadway & West 72nd <St>", "MANHATTAN", { "vehicles:truck": 4 }),
      corner("Atlantic Ave & Flatbush Ave", "BROOKLYN", { "vehicles:truck": 4, "causes:yield": 4 }),
      corner("A St & B St", null, { "vehicles:truck": 4 })
    ]
  };
  const spots = cornerFindings(summary);
  assert.deepEqual(spots[0].findings.map((f) => f.id), ["vehicles:truck"], "40% vs 2% across Manhattan");
  assert.equal(spots[1].findings.find((f) => f.id === "vehicles:truck"), undefined, "40% vs 30% across Brooklyn isn't enough");
  assert.deepEqual(spots[2].findings.map((f) => f.id), ["vehicles:truck"], "no borough: against NYC (16%)");
  assert.ok(patterns({ crashes: 10, groups: groupsWith({ "vehicles:truck": 2 }) }, summary.city, null, CORNER).length === 0, "2 isn't enough at a corner");

  const html = spotsHtml(spots, { victim: "a pedestrian", shown: 2 });
  assert.match(html, /<span class="sr-only">1\. <\/span>Broadway &#38; West 72nd &#60;St&#62;/);
  assert.match(html, /data-corner-street="Broadway"/);
  assert.match(html, /data-corner-cross="West 72nd &#60;St&#62;"/);
  assert.match(html, /crashes hurt a pedestrian/);
  assert.match(html, /What goes wrong here[\s\S]*A truck involved<\/strong>: 4 of 10 crashes, vs 2\.0% across Manhattan/);
  assert.match(html, /data-extra hidden/, "past the first two, folded");
  assert.match(html, /Show 1 more/);
  assert.match(spotsHtml([]), /No intersection here/);
});

// ---------- Counting without SQL (hotspot-compute.js) ----------

// A seeded, made-up year of crash_facts and crash_streets: enough corners, streets, places and kinds to exercise every rule.
function syntheticDb(n = 1500) {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const db = new DatabaseSync(":memory:");
  for (const sql of Object.values(TABLES)) db.exec(sql);
  for (const sql of INDEXES) db.exec(sql);
  const put = (table, row) => db.prepare(`INSERT INTO ${table} (${COLUMNS[table].join(",")}) VALUES (${COLUMNS[table].map(() => "?").join(",")})`)
    .run(...COLUMNS[table].map((c) => row[c] ?? null));
  const streets = [["BROADWAY", "Broadway"], ["W 72 ST", "W 72 St"], ["E 72 ST", "E 72 St"], ["AMSTERDAM AVE", "Amsterdam Ave"],
    ["ATLANTIC AVE", "Atlantic Ave"], ["FLATBUSH AVE", "Flatbush Ave"], ["QUEENS BLVD", "Queens Blvd"]];
  const boroughs = ["MANHATTAN", "BROOKLYN", "QUEENS", "BRONX", "STATEN ISLAND", null];
  const zips = ["10023", "10024", "11201", "11217", "11375", null];
  for (let i = 0; i < n; i++) {
    const on = pick(streets), cross = rand() < 0.7 ? pick(streets) : null, off = rand() < 0.1 ? pick(streets) : null;
    const corner = cross && cross !== on ? cornerOf(rand() < 0.2 ? on[1].toUpperCase() : on[1], cross[1]) : { key: null, label: null };
    const severity = pick([0, 0, 0, 1, 1, 1, 2]);
    const located = rand() < 0.95;
    const id = `c${String(i).padStart(5, "0")}`;
    const date = `2026-${String(1 + Math.floor(rand() * 9)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`;
    const count = () => (rand() < 0.15 ? 1 + Math.floor(rand() * 2) : 0);
    put("crash_facts", {
      collision_id: id, crash_date: date, borough: pick(boroughs), zip_code: pick(zips),
      lat: located ? Math.round((40.70 + rand() * 0.1) * 1e6) / 1e6 : null, lon: located ? Math.round((-74.0 + rand() * 0.1) * 1e6) / 1e6 : null,
      cell: null, corner: corner.key, corner_label: corner.label, severity,
      killed: severity === 2 ? 1 : 0, injured: severity ? 1 + count() : 0,
      ped_killed: count(), ped_injured: count(), cyc_killed: count(), cyc_injured: count(),
      erider_killed: count(), erider_injured: count(),
      who: Math.floor(rand() * 32), causes: Math.floor(rand() * 32768), maneuvers: Math.floor(rand() * 512), vehicles: Math.floor(rand() * 8192)
    });
    const named = [["on", on], ["cross", cross], ["off", off]].filter(([, s]) => s);
    for (const [field, s] of named) {
      db.prepare("INSERT OR IGNORE INTO crash_streets (street, street_base, collision_id, crash_date, field) VALUES (?, ?, ?, ?, ?)")
        .run(streetMatchKey(s[1]), streetBaseKey(streetMatchKey(s[1])), id, date, field);
    }
  }
  return db;
}

// What the Worker used to answer, from SQL (the reference the counting in JS must match).
function sqlView(all, query) {
  const { area } = query;
  const byBorough = all(boroughTotalsSql(query));
  const topBorough = area && area.kind !== "borough" ? all(areaBoroughSql(query))[0]?.borough ?? null : area?.borough ?? null;
  const here = area ? readTotals(all(totalsSql(query))[0]) : null;
  const boroughs = Object.fromEntries(byBorough.filter((r) => r.borough).map((r) => [r.borough, readTotals(r)]));
  const city = addTotals(byBorough.map((r) => readTotals(r)));
  let compareTo = null;
  if (area?.kind === "borough") compareTo = { kind: "city", label: "NYC" };
  else if (area) compareTo = topBorough && boroughs[topBorough] ? { kind: "borough", borough: topBorough, label: boroughLabel(topBorough) } : { kind: "city", label: "NYC" };
  const compare = compareTo ? (compareTo.kind === "borough" ? boroughs[compareTo.borough] : city) : null;
  const corner = area?.kind === "street" && area.streets.length === 2;
  let rank = null;
  if (corner && compareTo?.kind === "borough" && here.hurtCrashes) {
    const [r] = all(cornerRankSql(query, compareTo.borough, here.hurtCrashes));
    if (r?.total) rank = { label: compareTo.label, total: r.total, above: r.above };
  }
  return {
    summary: { area: area ? { kind: corner ? "corner" : area.kind, label: area.label } : null, compareTo, here: here ?? city, compare, city, boroughs,
      corners: readCorners(all(cornersSql(query))), rank },
    points: all(pointsSql(query)).map((p) => [p.lat, p.lon, p.severity, null, p.date, p.label])
  };
}

// Equal, with averaged coordinates allowed to differ in the last rounded place.
function assertSame(actual, expected, path = "") {
  if (typeof actual === "number" && typeof expected === "number" && !Number.isInteger(expected)) {
    assert.ok(Math.abs(actual - expected) <= 2e-5, `${path}: ${actual} vs ${expected}`);
  } else if (actual && expected && typeof actual === "object") {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    for (const k of Object.keys(expected)) assertSame(actual[k], expected[k], `${path}.${k}`);
  } else {
    assert.equal(actual, expected, path);
  }
}

const HOTSPOT_QUERIES = ["", "mode=walk", "mode=bike", "mode=drive", "boro=BROOKLYN", "boro=QUEENS&mode=bike", "zip=10023", "zip=11201&mode=walk",
  "zip=10467", "street=Broadway", "street=72 St", "street=W 72 St", "street=E 72 St&mode=walk", "street=Broadway&cross=W 72 St",
  "street=Broadway&cross=W 72 St&boro=MANHATTAN", "street=Atlantic Ave&cross=Flatbush Ave&boro=BROOKLYN&mode=bike", "street=Nowhere St",
  "lat=40.75&lon=-73.95", "lat=40.75&lon=-73.95&r=500&mode=walk", "lat=40.72&lon=-73.99&mode=bike", "lat=40.60&lon=-74.10"];

test("counting in JS: the same summary and map as the SQL, for every kind of place and mode, after a trip through JSON", () => {
  const db = syntheticDb();
  const all = (stmt) => db.prepare(stmt.sql).all(...stmt.params).map((r) => ({ ...r }));
  const rows = all(factsPageSql("", 1e6)).map((r) => ({ ...r, streets: r.streets ? r.streets.split(STREET_SEP) : [] }));
  const t = unpackFacts(JSON.parse(JSON.stringify(packFacts(rows, { dataThrough: "2026-09-28" }))));
  assert.equal(t.meta.dataThrough, "2026-09-28");
  let corners = 0, ranked = 0;
  for (const qs of HOTSPOT_QUERIES) {
    const query = q(qs);
    const want = sqlView(all, query);
    const summary = summarize(t, query);
    assertSame(summary, want.summary, qs || "(nyc)");
    corners += summary.corners.length;
    if (summary.rank) ranked++;
    const map = mapOf(t, query);
    const key = (p) => p.join("|");
    assert.deepEqual(map.points.map(key).sort(), want.points.map(key).sort(), `${qs} map`);
    assert.deepEqual(map.points.map((p) => [p[2], p[4]]), want.points.map((p) => [p[2], p[4]]), `${qs}: killed first, then newest`);
  }
  assert.ok(corners > 20 && ranked > 0, "the made-up data has ranked corners and an intersection's rank");
});

test("packing: a row's coordinates survive exactly; an id is never sent", () => {
  const rows = [
    { collision_id: "a", crash_date: "2026-01-02", borough: "QUEENS", zip_code: "11375", lat: 40.712345, lon: -73.98765, corner: null, corner_label: null, severity: 1, injured: 1, who: 1, causes: 0, maneuvers: 0, vehicles: 0, streets: [] },
    { collision_id: "b", crash_date: "2026-01-03", borough: null, zip_code: null, lat: null, lon: null, corner: null, corner_label: null, severity: 0, injured: 0, who: 0, causes: 0, maneuvers: 0, vehicles: 0, streets: [] },
    { collision_id: "c", crash_date: "2026-01-04", borough: "QUEENS", zip_code: "11375", lat: 40.1234567, lon: -73.1, corner: null, corner_label: null, severity: 2, injured: 0, who: 0, causes: 0, maneuvers: 0, vehicles: 0, streets: [] }
  ];
  const packed = packFacts(rows);
  assert.ok(!JSON.stringify(packed).includes('"a"'));
  const t = unpackFacts(JSON.parse(JSON.stringify(packed)));
  const coords = [...Array(t.n).keys()].map((i) => [t.lat[i], t.lon[i]]).filter(([a]) => !Number.isNaN(a)).sort();
  assert.deepEqual(coords, [[40.1234567, -73.1], [40.712345, -73.98765]]);
  assert.throws(() => unpackFacts({ ...packed, format: 0 }), /format/);
});

// RAW as the build's fetch would return it: only SOURCE_COLUMNS, every value a string (Socrata's JSON).
const asFetched = (raw = RAW) => Object.fromEntries(Object.entries(raw).map(([table, rows]) => [table, rows.map((r) =>
  Object.fromEntries(SOURCE_COLUMNS[table].filter((c) => r[c] != null).map((c) => [c, String(r[c])])))]));

test("facts from the source: one row per crash with its street keys, the same as the old database build", async () => {
  const { factsFromSource } = await import("./support/workers.js").then(() => import("../src/lib/server/crash-hotspots.js"));
  const rows = factsFromSource(asFetched());
  const want = facts();
  assert.equal(rows.length, want.length);
  for (const [i, r] of rows.entries()) {
    const { streets, ...row } = r;
    assert.deepEqual(row, want[i]);
    assert.deepEqual(streets, streetRows(crashRow(RAW.crashes[i])).map((s) => s.street));
  }
  // Vehicles whose crash is out of range are dropped, not counted somewhere else.
  const extra = asFetched({ ...RAW, vehicles: [...RAW.vehicles, { unique_id: "v9", collision_id: id(99), pre_crash: "Backing" }] });
  assert.equal(factsFromSource(extra).length, rows.length);
});

test("hotspots build: the views built ahead and the facts in KV match the SQL, passed through untouched", async () => {
  const { env, fakeKv } = await import("./support/workers.js");
  const { hotspotsJob, viewKey, FACTS_KEY, viewResponse, factsResponse, isPrebuilt } = await import("../src/lib/server/crash-hotspots.js");
  const { refreshDaily } = await import("../src/lib/server/cache.js");
  env.DATA_CACHE = fakeKv();
  try {
    // As the refresh runs it, with the source handed in instead of fetched.
    const built = await refreshDaily({ ...hotspotsJob, run: () => hotspotsJob.run(asFetched()) });
    assert.equal(built.crashes, RAW.crashes.length);
    assert.equal(built.dataThrough, "2025-05-02");
    assert.equal(built.views, 24, "all of NYC and five boroughs, each with no mode and three");
    assert.equal(env.DATA_CACHE.store.size, 27, "24 views, the facts, the job's value and its :at");

    const all = memoryDb();
    const rows = (stmt) => all(stmt).map((r) => ({ ...r }));
    for (const qs of ["", "mode=walk", "boro=MANHATTAN&mode=bike", "boro=BROOKLYN"]) {
      const query = q(qs);
      assert.ok(isPrebuilt(query));
      const view = JSON.parse(env.DATA_CACHE.store.get(viewKey(query)));
      assertSame(view.summary, { dataThrough: built.dataThrough, dateFrom: built.dateFrom, ...sqlView(rows, query).summary }, qs);
      assert.equal(view.map.points.length, sqlView(rows, query).points.length);
    }
    assert.ok(!isPrebuilt(q("zip=10023")) && !isPrebuilt(q("street=Broadway")) && !isPrebuilt(q("lat=40.75&lon=-73.95")));

    const url = new URL("https://example.test/api/crash-hotspots/view");
    const res = await viewResponse(q("boro=QUEENS"), url);
    assert.equal(res.headers.get("Content-Type"), "application/json; charset=utf-8");
    assert.equal(await res.text(), env.DATA_CACHE.store.get(viewKey(q("boro=QUEENS"))));
    const facts = await (await factsResponse(url)).json();
    assert.equal(facts.n, RAW.crashes.length);
    assert.equal(env.DATA_CACHE.store.get(FACTS_KEY), JSON.stringify(facts));
  } finally {
    delete env.DATA_CACHE;
  }
});

test("hotspots build: keeps the last build when the source suddenly has far fewer crashes", async () => {
  const { env, fakeKv } = await import("./support/workers.js");
  const { hotspotsJob } = await import("../src/lib/server/crash-hotspots.js");
  const last = { computedAt: new Date().toISOString(), value: { crashes: 100 } };
  env.DATA_CACHE = fakeKv({ [hotspotsJob.key]: JSON.stringify(last), [`${hotspotsJob.key}:at`]: last.computedAt });
  try {
    await assert.rejects(hotspotsJob.run(asFetched()), /keeping the last build/);
    assert.equal(env.DATA_CACHE.store.size, 2, "nothing written");
    await assert.rejects(hotspotsJob.run({ crashes: [], vehicles: [] }), /keeping the last build/);
  } finally {
    delete env.DATA_CACHE;
  }
});

test("fetching a year: only the needed columns, in Socrata's row order, one table at a time; a failed page is retried smaller", async () => {
  await import("./support/workers.js");
  const { fetchYear } = await import("../src/lib/server/crash-hotspots.js");
  const realFetch = globalThis.fetch, realTimeout = globalThis.setTimeout;
  const calls = [];
  let failedOnce = false;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0); // no real waits between retries
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams);
    calls.push({ id: u.pathname.split("/").at(-1).replace(".json", ""), ...p });
    if (!failedOnce) { failedOnce = true; return new Response("busy", { status: 503 }); }
    // Two pages for the vehicles table: a full one, then the rest (with a row repeated, as if republished mid-pull).
    if (u.pathname.includes("bm4k-52h4") && p.$offset === "0") {
      return Response.json(Array.from({ length: Number(p.$limit) }, (_, i) => ({ unique_id: `v${String(i).padStart(5, "0")}` })));
    }
    if (u.pathname.includes("bm4k-52h4")) return Response.json([{ unique_id: "v00007" }, { unique_id: "z" }]);
    return Response.json([{ unique_id: "z", collision_id: "1" }]);
  };
  try {
    const got = await fetchYear({ from: "2025-11-13", to: null });
    assert.deepEqual(Object.keys(got), ["crashes", "vehicles"], "the persons table isn't fetched");
    assert.deepEqual(calls.map((c) => c.id), ["h9gi-nx95", "h9gi-nx95", "bm4k-52h4", "bm4k-52h4"], "the 503 retried, then one table after another");
    assert.deepEqual(calls.map((c) => c.$limit), ["50000", "25000", "25000", "25000"], "half the size after a failure, and it sticks");
    assert.equal(got.vehicles.length, 25001, "the repeated row kept once");
    assert.deepEqual(calls.slice(-2).map((c) => c.$offset), ["0", "25000"]);
    assert.equal(calls[0].$select, SOURCE_COLUMNS.crashes.join(","));
    assert.equal(calls[0].$order, ":id");
    assert.equal(calls[0].$where, "crash_date >= '2025-11-13T00:00:00'");
    // Out of time: fails this job instead of running on.
    await assert.rejects(fetchYear({ from: "2025-11-13", to: null }, { budgetMs: -1 }), /out of time/);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realTimeout;
  }
});
