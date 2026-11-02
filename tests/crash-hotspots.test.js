/*
 * NYC Crash Hotspots: the crash groups and severity (facts.js), the URL
 * (hotspot-query.js), the SQL on an in-memory database (hotspot-sql.js), the
 * sync's facts diff, and what the page says (hotspot-view.js, hotspot-render.js).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { WHO, CAUSES, MANEUVERS, VEHICLES, DIMENSIONS, causeKey, maneuverKey, maskOf, keysOf, personSeverity, factsRow, cornerOf, cellOf, dayOfWeek, byCrash } from "../src/lib/crashes/facts.js";
import { readQuery, queryToParams, queryKey, placeFromText, hasFilters } from "../src/lib/crashes/hotspot-query.js";
import { totalsSql, readTotals, hoursSql, monthsSql, cornersSql, readCorners, areaBoroughSql, cellsSql, pointsSql } from "../src/lib/crashes/hotspot-sql.js";
import { statCards, watchFor, breakdown, hourGrid, busiestHour, groupTitle, toCsv, WATCH } from "../src/lib/crashes/hotspot-view.js";
import { watchHtml, cornerRowsHtml, breakdownHtml } from "../src/lib/crashes/hotspot-render.js";
import { crashRow, streetRows, vehicleRow, personRow } from "../src/lib/crashes/rows.js";
import { TABLES, INDEXES, COLUMNS } from "../src/lib/crashes/schema.js";
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
  // Stored in D1: changing one of these silently relabels every crash until a full rebuild.
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

test("severity: killed, seriously hurt from the injury or state, hurt; bystanders don't count", () => {
  const p = (x) => ({ involved: 1, ...x });
  assert.equal(personSeverity(p({ injury: "Killed" })), 3);
  assert.equal(personSeverity(p({ injury: "Injured", complaint: "Fracture - Distorted - Dislocation" })), 2);
  assert.equal(personSeverity(p({ injury: "Injured", complaint: "Severe Lacerations" })), 2);
  assert.equal(personSeverity(p({ injury: "Unspecified", emotional_status: "Apparent Death" })), 2);
  assert.equal(personSeverity(p({ injury: "Injured", complaint: "Complaint of Pain or Nausea", emotional_status: "Conscious" })), 1);
  assert.equal(personSeverity(p({ injury: "Injured", complaint: "Minor Burn" })), 1);
  assert.equal(personSeverity(p({ injury: "Unspecified" })), 0);
  assert.equal(personSeverity({ involved: 0, injury: "Killed" }), 0);
});

test("places: corners either way round, a grid square, Monday first", () => {
  const a = cornerOf("BROADWAY", "WEST 72 STREET"), b = cornerOf("W 72nd St", "Broadway");
  assert.equal(a.key, b.key);
  assert.equal(a.label, "Broadway & West 72nd Street");
  assert.deepEqual(cornerOf("BROADWAY", null), { key: null, label: null });
  assert.deepEqual(cornerOf("BROADWAY", "BROADWAY"), { key: null, label: null });
  assert.equal(cellOf(40.7781, -73.9817), cellOf(40.7785, -73.9812));
  assert.equal(cellOf(null, -73.98), null);
  assert.equal(dayOfWeek("2025-06-16"), 0); // a Monday
  assert.equal(dayOfWeek("2025-06-15"), 6);
});

// ---------- Fixtures ----------

const id = (n) => n.toString(16).padStart(32, "0");
const day = (d) => `${d}T00:00:00.000`;
const RAW = {
  crashes: [
    // Broadway & W 72: a car turning left hits a pedestrian, seriously hurt
    { collision_id: id(1), crash_date: day("2025-03-03"), crash_time: "17:40", borough: "MANHATTAN", zip_code: "10023", latitude: "40.7781", longitude: "-73.9817",
      on_street_name: "BROADWAY", cross_street_name: "WEST 72 STREET", number_of_persons_injured: "1", number_of_pedestrians_injured: "1",
      contributing_factor_vehicle_1: "Failure to Yield Right-of-Way" },
    // Same corner, written the other way round: speeding, an e-bike rider hurt
    { collision_id: id(2), crash_date: day("2025-03-04"), crash_time: "23:15", borough: "MANHATTAN", zip_code: "10023", latitude: "40.7782", longitude: "-73.9816",
      on_street_name: "W 72 ST", cross_street_name: "BROADWAY", number_of_persons_injured: "1", contributing_factor_vehicle_1: "Unsafe Speed" },
    // Same corner, nobody hurt, a truck backing
    { collision_id: id(3), crash_date: day("2025-04-10"), crash_time: "9:05", borough: "MANHATTAN", zip_code: "10023", latitude: "40.7780", longitude: "-73.9818",
      on_street_name: "BROADWAY", cross_street_name: "WEST 72 STREET", contributing_factor_vehicle_1: "Backing Unsafely" },
    // Brooklyn, no vehicle or person rows: the crash's own counts and codes stand in; someone killed
    { collision_id: id(4), crash_date: day("2025-05-01"), crash_time: "2:30", borough: "BROOKLYN", zip_code: "11201", latitude: "40.6887", longitude: "-73.9806",
      on_street_name: "ATLANTIC AVENUE", number_of_persons_killed: "1", number_of_cyclist_killed: "1", vehicle_type_code1: "Bike", vehicle_type_code2: "Sedan" },
    // No location at all
    { collision_id: id(5), crash_date: day("2025-05-02"), borough: "QUEENS" }
  ],
  vehicles: [
    { unique_id: "v1", collision_id: id(1), crash_date: day("2025-03-03"), vehicle_type: "Sedan", pre_crash: "Making Left Turn", contributing_factor_1: "Driver Inattention/Distraction" },
    { unique_id: "v2", collision_id: id(2), crash_date: day("2025-03-04"), vehicle_type: "Station Wagon/Sport Utility Vehicle", pre_crash: "Going Straight Ahead" },
    { unique_id: "v3", collision_id: id(2), crash_date: day("2025-03-04"), vehicle_type: "E-Bike", pre_crash: "Going Straight Ahead" },
    { unique_id: "v4", collision_id: id(3), crash_date: day("2025-04-10"), vehicle_type: "Box Truck", pre_crash: "Backing" }
  ],
  persons: [
    { unique_id: "p1", collision_id: id(1), crash_date: day("2025-03-03"), person_type: "Pedestrian", ped_role: "Pedestrian", person_injury: "Injured", complaint: "Fracture - Distorted - Dislocation" },
    { unique_id: "p2", collision_id: id(1), crash_date: day("2025-03-03"), vehicle_id: "v1", person_type: "Occupant", ped_role: "Driver", person_injury: "Unspecified" },
    { unique_id: "p3", collision_id: id(1), crash_date: day("2025-03-03"), vehicle_id: "v1", person_type: "Occupant", ped_role: "Witness", person_injury: "Killed" },
    { unique_id: "p4", collision_id: id(2), crash_date: day("2025-03-04"), vehicle_id: "v3", person_type: "Bicyclist", ped_role: "Driver", person_injury: "Injured", complaint: "Abrasion" },
    { unique_id: "p5", collision_id: id(3), crash_date: day("2025-04-10"), vehicle_id: "v4", person_type: "Occupant", ped_role: "Driver", person_injury: "Unspecified" }
  ]
};

function facts(raw = RAW) {
  const vehicles = byCrash(raw.vehicles.map(vehicleRow));
  const persons = byCrash(raw.persons.map(personRow));
  return raw.crashes.map(crashRow).map((c) => factsRow(c, vehicles.get(c.collision_id), persons.get(c.collision_id)));
}

test("facts row: who was hurt, how badly, the causes, maneuvers and vehicles", () => {
  const [f1, f2, f3, f4, f5] = facts();
  assert.equal(f1.severity, 2, "a fracture is serious; the witness on the report doesn't count");
  assert.equal(f1.serious, 1);
  assert.deepEqual(keysOf(WHO, f1.who), ["pedestrian"]);
  assert.deepEqual(keysOf(CAUSES, f1.causes).sort(), ["distracted", "yield"]);
  assert.deepEqual(keysOf(MANEUVERS, f1.maneuvers), ["left-turn"]);
  assert.deepEqual(keysOf(VEHICLES, f1.vehicles), ["sedan"]);
  assert.equal(f1.hour, 17);
  assert.equal(f1.corner, f2.corner, "the same corner written either way round");

  assert.equal(f2.severity, 1);
  assert.deepEqual(keysOf(WHO, f2.who), ["e-rider"], "a 'Bicyclist' on an e-bike is an e-rider");
  assert.deepEqual(keysOf(VEHICLES, f2.vehicles).sort(), ["e-bike", "suv"]);

  assert.equal(f3.severity, 0);
  assert.deepEqual(keysOf(MANEUVERS, f3.maneuvers), ["backing"]);
  assert.deepEqual(keysOf(VEHICLES, f3.vehicles), ["truck"]);

  assert.equal(f4.severity, 3);
  assert.equal(f4.killed, 1);
  assert.deepEqual(keysOf(WHO, f4.who), ["cyclist"], "without person rows, the crash's counts say who");
  assert.deepEqual(keysOf(VEHICLES, f4.vehicles).sort(), ["bike", "sedan"]);
  assert.equal(f4.corner, null);

  assert.equal(f5.lat, null);
  assert.equal(f5.cell, null);
  assert.equal(f5.hour, null);
});

test("facts row: the hash changes when a vehicle or person changes", () => {
  const before = facts()[0].h;
  const changed = { ...RAW, persons: RAW.persons.map((p) => (p.unique_id === "p1" ? { ...p, complaint: "Minor Bleeding" } : p)) };
  const after = facts(changed)[0];
  assert.notEqual(after.h, before);
  assert.equal(after.severity, 1);
});

// ---------- URL ----------

test("query: filters and a place read from the URL, round-trip in one order", () => {
  const r = q("veh=truck,bus,nope&who=pedestrian&sev=serious&time=night&zip=11211");
  assert.deepEqual(r.filters.veh, ["truck", "bus"]);
  assert.equal(r.filters.sev, "serious");
  assert.deepEqual(r.area, { kind: "zip", zip: "11211", label: "ZIP 11211" });
  assert.equal(queryToParams(r).toString(), "zip=11211&who=pedestrian&veh=bus%2Ctruck&sev=serious&time=night");
  assert.equal(queryKey(q("veh=bus,truck&zip=11211")), queryKey(q("zip=11211&veh=truck,bus")));
  assert.equal(hasFilters(q("").filters), false);
  assert.equal(hasFilters(r.filters), true);
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
  assert.deepEqual(readQuery(queryToParams({ area: corner, filters: q("").filters })).area, corner);
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

test("SQL: totals and per-group counts follow the place and filters", () => {
  const all = memoryDb();
  const city = readTotals(all(totalsSql(q("")))[0]);
  assert.equal(city.crashes, 5);
  assert.equal(city.killed, 1);
  assert.equal(city.serious, 1);
  assert.equal(city.ksiCrashes, 2);
  assert.equal(city.groups.who.pedestrian.n, 1);
  assert.equal(city.groups.who.pedestrian.ksi, 1);
  assert.equal(city.groups.maneuvers["left-turn"].n, 1);

  assert.equal(readTotals(all(totalsSql(q("who=pedestrian,cyclist")))[0]).crashes, 2, "any of a group's picks");
  assert.equal(readTotals(all(totalsSql(q("who=pedestrian&cause=speeding")))[0]).crashes, 0, "every group must match");
  assert.equal(readTotals(all(totalsSql(q("sev=hurt")))[0]).crashes, 3);
  assert.equal(readTotals(all(totalsSql(q("sev=serious")))[0]).crashes, 2);
  assert.equal(readTotals(all(totalsSql(q("time=night")))[0]).crashes, 2, "11:15 pm and 2:30 am");
  assert.equal(readTotals(all(totalsSql(q("zip=10023")))[0]).crashes, 3);
  assert.equal(readTotals(all(totalsSql(q("boro=BROOKLYN")))[0]).crashes, 1);
  assert.equal(readTotals(all(totalsSql(q("street=Broadway&cross=W 72 St")))[0]).crashes, 3, "either order on the report");
  assert.equal(readTotals(all(totalsSql(q("street=72 St")))[0]).crashes, 3, "72 St without West takes in West 72nd");
  assert.equal(readTotals(all(totalsSql(q("street=E 72 St")))[0]).crashes, 0, "East isn't West");
  assert.equal(readTotals(all(totalsSql(q("lat=40.7781&lon=-73.9817&r=250")))[0]).crashes, 3);
  assert.equal(readTotals(all(totalsSql(q("lat=40.7900&lon=-73.9817&r=250")))[0]).crashes, 0, "1.3 km north is outside 250 m");
  assert.deepEqual(readTotals(undefined).crashes, 0);
});

test("SQL: hours, months, corners, the area's borough, the map", () => {
  const all = memoryDb();
  const hours = all(hoursSql(q("")));
  assert.equal(hours.reduce((s, r) => s + r.n, 0), 4, "the crash with no time is left out");
  assert.deepEqual(all(monthsSql(q(""))).map((r) => [r.month, r.n]), [["2025-03", 2], ["2025-04", 1], ["2025-05", 2]]);
  const corners = readCorners(all(cornersSql(q(""))));
  assert.equal(corners.length, 1);
  assert.equal(corners[0].n, 3);
  assert.equal(corners[0].ksi, 1);
  assert.equal(corners[0].borough, "MANHATTAN");
  assert.ok(["yield", "speeding", "backing", "distracted"].includes(corners[0].topCause));
  assert.equal(all(cornersSql(q("sev=hurt"))).length, 0, "fewer than 3 crashes isn't listed");
  assert.equal(all(cornersSql(q(""), "ksi")).length, 1);
  assert.equal(all(areaBoroughSql(q("zip=10023")))[0].borough, "MANHATTAN");
  const cells = all(cellsSql(q("")));
  assert.equal(cells.reduce((s, c) => s + c.n, 0), 4, "the crash with no location isn't on the map");
  assert.equal(cells.find((c) => c.n === 3).ksi, 1);
  assert.deepEqual(all(pointsSql(q(""))).map((p) => p.severity), [3, 2], "killed first");
  // A corner from the table, back through the URL, finds the same crashes.
  const [street, cross] = corners[0].label.split(" & ");
  assert.equal(readTotals(all(totalsSql(q(new URLSearchParams({ street, cross, boro: corners[0].borough }).toString())))[0]).crashes, 3);
});

test("SQL: places are bound parameters; filter values never reach the SQL text", () => {
  const stmt = totalsSql(q("street=Broadway'; DROP TABLE crashes;--&veh=truck"));
  assert.ok(!stmt.sql.includes("DROP"));
  assert.ok(stmt.params.length <= 100);
  assert.ok(stmt.params.every((p) => typeof p === "string" || typeof p === "number"));
});

// ---------- Sync ----------

test("sync: facts rows written only for crashes that changed, deleted for crashes gone", async () => {
  const { diffFacts } = await import("./support/workers.js").then(() => import("../src/lib/server/crashes-sync.js"));
  const stored = facts().map((f) => ({ id: f.collision_id, h: f.h }));
  stored[1].h = "old";
  stored.push({ id: id(99), h: "x" });
  const { upserts, deletes } = diffFacts(RAW, stored);
  assert.deepEqual(upserts.map((r) => r.collision_id), [id(2)]);
  assert.deepEqual(deletes, [id(99)]);
  // A person changing rewrites their crash's row.
  const changed = { ...RAW, persons: RAW.persons.map((p) => (p.unique_id === "p4" ? { ...p, person_injury: "Killed" } : p)) };
  assert.deepEqual(diffFacts(changed, facts().map((f) => ({ id: f.collision_id, h: f.h }))).upserts.map((r) => r.collision_id), [id(2)]);
});

// ---------- What the page says ----------

const groupsWith = (counts) => {
  const groups = {};
  for (const d of DIMENSIONS) {
    groups[d.column] = {};
    for (const g of d.groups) groups[d.column][g.key] = { n: counts[`${d.column}:${g.key}`] ?? 0, ksi: 0 };
  }
  return groups;
};
const totals = (crashes, counts, extra = {}) => ({ crashes, injured: 0, killed: 0, serious: 0, hurtCrashes: 0, ksiCrashes: 0, groups: groupsWith(counts), ...extra });

test("watch for: clearly more common here, enough of them, biggest gap first, filtered kinds left out", () => {
  const summary = {
    compareTo: { kind: "borough", label: "Brooklyn" },
    here: totals(100, { "maneuvers:left-turn": 30, "causes:speeding": 12, "who:pedestrian": 4, "causes:distracted": 30, "maneuvers:straight": 80 }),
    compare: totals(1000, { "maneuvers:left-turn": 100, "causes:speeding": 60, "who:pedestrian": 10, "causes:distracted": 290, "maneuvers:straight": 100 })
  };
  const items = watchFor(summary);
  assert.deepEqual(items.map((i) => i.id), ["maneuvers:left-turn", "causes:speeding"],
    "distracted is about the same; 4 pedestrians is too few; going straight is never listed");
  assert.equal(items[0].title, "A vehicle turning left");
  assert.ok(items[0].tip);
  assert.deepEqual(watchFor(summary, { move: ["left-turn"] }).map((i) => i.id), ["causes:speeding"]);
  assert.deepEqual(watchFor({ ...summary, compare: null }), []);
  assert.ok(WATCH.minLocal > 1);
  const html = watchHtml(items, { compareLabel: "Brooklyn", areaLabel: "ZIP 11211", enough: true });
  assert.match(html, /30%<\/strong> of crashes here vs 10% across Brooklyn/);
  assert.match(watchHtml([], { compareLabel: "Brooklyn", enough: true }), /Nothing stands out/);
  assert.match(watchHtml([], { compareLabel: "Brooklyn", areaLabel: "<b>", enough: false }), /&#60;b&#62;/);
});

test("stat cards, breakdowns, hours and CSV", () => {
  const summary = {
    dateFrom: "2024-06-01", dataThrough: "2025-05-31",
    compareTo: { kind: "borough", label: "Brooklyn" },
    here: totals(730, { "causes:speeding": 73 }, { injured: 400, killed: 2, serious: 8, hurtCrashes: 365, ksiCrashes: 10 }),
    compare: totals(10000, { "causes:speeding": 500 }, { hurtCrashes: 4000, ksiCrashes: 50 }),
    hours: [[0, 17, 9, 1], [4, 17, 3, 0], [5, 23, 10, 0]]
  };
  const cards = statCards(summary);
  assert.equal(cards[0].value, "730");
  assert.match(cards[0].context, /About 2 a day/);
  assert.match(cards[1].context, /50% of crashes hurt someone\. vs 40% across Brooklyn/);
  assert.equal(cards[2].value, "10");
  assert.equal(cards[3].value, "1 in 73");
  assert.match(cards[3].context, /2\.7× the rate across Brooklyn \(1 in 200\)/);
  const rows = breakdown(summary, "causes");
  assert.deepEqual(rows.map((r) => [r.key, r.share, r.baseShare]), [["speeding", 0.1, 0.05]]);
  assert.match(breakdownHtml(rows, { compareLabel: "Brooklyn" }), /vs 5\.0% across Brooklyn/);
  const grid = hourGrid(summary.hours);
  assert.equal(grid.max, 10);
  assert.deepEqual(grid.peak, { dow: 5, hour: 23 });
  assert.equal(busiestHour(summary.hours), "5 pm", "hours add up across days");
  assert.equal(toCsv(["a", "b"], [["x, y", 'say "hi"']]), 'a,b\n"x, y","say ""hi"""');
  assert.equal(groupTitle("vehicles", VEHICLES.find((v) => v.key === "suv")), "An SUV involved");
  assert.equal(groupTitle("vehicles", VEHICLES.find((v) => v.key === "e-bike")), "An e-bike involved");
  assert.equal(groupTitle("who", WHO[0]), "Pedestrians hurt");
});

test("corner rows: escaped, with the place for the click", () => {
  const html = cornerRowsHtml([{ corner: "A&B", label: "Broadway & West 72nd <St>", borough: "MANHATTAN", n: 5, injured: 2, killed: 0, ksi: 1, topCause: "speeding" }]);
  assert.match(html, /data-corner-street="Broadway"/);
  assert.match(html, /data-corner-cross="West 72nd &#60;St&#62;"/);
  assert.match(html, /Speeding/);
  assert.match(cornerRowsHtml([]), /3 or more crashes/);
});
