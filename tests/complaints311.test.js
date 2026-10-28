/*
 * 311 dashboard logic: share and ratio math, the low-data fallback, labels,
 * input parsing and location resolution (with canned GeoSearch results).
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  shares, ratio, compareShares, comparisonArea, typeCounts, locationCounts, statusCounts,
  topTypes, openShare, locationComparison, ratioText,
  circleDistributions, cityRank, cityRankText
} from "../src/lib/complaints311/stats.js";
import { typeKey, typeLabel, locationGroup, OTHER_LOCATION } from "../src/lib/complaints311/labels.js";
import {
  parseLocationInput, isNycZip, prettyStreet, placeLabel, locationFromParams, locationToParams
} from "../src/lib/complaints311/location-input.js";
import { chooseMatch, resolveLocation, streetMatches } from "../src/lib/complaints311/geocode.js";
import { windowStart, windowChunks, circle, heatmapParams, baselineParams } from "../src/lib/complaints311/soql.js";
import { MIN_IMMEDIATE_REQUESTS, RADII } from "../src/lib/complaints311/config.js";
import { comparisonView } from "../src/lib/complaints311/view.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ---------- Shares and ratios ----------

test("shares divide each count by the total", () => {
  const s = shares({ NOISE: 30, RODENT: 10, PARKING: 60 });
  close(s.NOISE, 0.3);
  close(s.RODENT, 0.1);
  close(s.PARKING, 0.6);
  assert.deepEqual(shares({}), {});
});

test("ratio is local share over baseline share; no baseline share means no ratio", () => {
  close(ratio(0.2, 0.1), 2);
  close(ratio(0.05, 0.1), 0.5);
  assert.equal(ratio(0.2, 0), null);
});

test("compareShares compares shares, not raw counts", () => {
  // A small area with 100 requests vs a city with 10,000: rodents are 20% here, 5% citywide.
  const local = { RODENT: 20, NOISE: 50, PARKING: 30 };
  const city = { RODENT: 500, NOISE: 5000, PARKING: 4500 };
  const { above, below } = compareShares(local, city);
  assert.equal(above.length, 1);
  assert.equal(above[0].key, "RODENT");
  close(above[0].ratio, 4);
  close(above[0].localShare, 0.2);
  close(above[0].baseShare, 0.05);
  // Parking is 30% here vs 45% citywide: 0.67×, and the city share predicts 45 here.
  assert.deepEqual(below.map((r) => r.key), ["PARKING"]);
});

test("above average needs ratio ≥ 1.25 and at least 20 requests here", () => {
  const city = { A: 100, B: 100, C: 800 };
  // A: 19 of 100 = 19% vs 10% → 1.9× but only 19 requests: left out.
  // B: 25 of 100 = 25% vs 10% → 2.5× with 25: kept.
  const local = { A: 19, B: 25, C: 56 };
  const { above } = compareShares(local, city);
  assert.deepEqual(above.map((r) => r.key), ["B"]);
  // Exactly 1.25× counts.
  const edge = compareShares({ X: 25, Y: 75 }, { X: 20, Y: 80 });
  assert.deepEqual(edge.above.map((r) => r.key), ["X"]);
});

test("below average skips types the baseline would barely expect here", () => {
  // Z is 1% citywide, so 100 local requests would expect 1: too few to call "less common".
  const { below } = compareShares({ Y: 100 }, { Y: 990, Z: 10 });
  assert.deepEqual(below, []);
  // With 5,000 local requests the city share predicts 50 Z, and there are none.
  const big = compareShares({ Y: 5000 }, { Y: 990, Z: 10 });
  assert.deepEqual(big.below.map((r) => r.key), ["Z"]);
  assert.equal(big.below[0].ratio, 0);
});

test("above is sorted highest ratio first, below lowest first", () => {
  const city = { A: 100, B: 100, C: 100, D: 700 };
  const local = { A: 300, B: 200, D: 500 };
  const { above } = compareShares(local, city);
  assert.deepEqual(above.map((r) => r.key), ["A", "B"]);
});

test("ratio text", () => {
  assert.equal(ratioText(2.345), "2.3×");
  assert.equal(ratioText(1.25), "1.3×");
  assert.equal(ratioText(12.4), "12×");
  assert.equal(ratioText(0.6), "0.6×");
  assert.equal(ratioText(0.01), "<0.1×");
});

// ---------- Low-data fallback ----------

test("comparisons use the 1 mile by default", () => {
  assert.deepEqual(comparisonArea(5000), { area: "neighborhood", immediateOk: true, lowData: false });
});

test("the ¼ mile is used only when picked and it has enough requests", () => {
  assert.equal(comparisonArea(MIN_IMMEDIATE_REQUESTS, "immediate").area, "immediate");
  const low = comparisonArea(MIN_IMMEDIATE_REQUESTS - 1, "immediate");
  assert.equal(low.area, "neighborhood");
  assert.equal(low.lowData, true);
  assert.equal(low.immediateOk, false);
  // The threshold is configurable.
  assert.equal(comparisonArea(30, "immediate", 25).area, "immediate");
  assert.equal(comparisonArea(0, "immediate").area, "neighborhood");
});

// ---------- Folding rows ----------

test("complaint types merge across spellings", () => {
  const counts = typeCounts([
    { complaint_type: "HEAT/HOT WATER", n: "10" },
    { complaint_type: "Heat/Hot Water", n: "5" },
    { complaint_type: "Noise", n: "2" }
  ]);
  assert.deepEqual(counts, { "HEAT/HOT WATER": 15, NOISE: 2 });
  assert.equal(typeLabel("HEAT/HOT WATER"), "No heat or hot water");
  assert.equal(typeLabel("Some New Type"), "Some new type");
  assert.equal(typeKey("  Noise  -  Park "), "NOISE - PARK");
});

test("location types fold into plain groups, blanks into Other / Not specified", () => {
  assert.equal(locationGroup("RESIDENTIAL BUILDING"), "Residential building");
  assert.equal(locationGroup("3+ Family Apt. Building"), "Residential building");
  assert.equal(locationGroup("Street/Sidewalk"), "Street or sidewalk");
  assert.equal(locationGroup("Comercial"), "Store or business");
  assert.equal(locationGroup("Building (Non-Residential)"), "Store or business");
  assert.equal(locationGroup("Club/Bar/Restaurant"), "Restaurant, bar or food vendor");
  assert.equal(locationGroup("Park/Playground"), "Park or playground");
  assert.equal(locationGroup("House of Worship"), OTHER_LOCATION);
  assert.equal(locationGroup("Construction Site"), OTHER_LOCATION);
  assert.equal(locationGroup(null), OTHER_LOCATION);
  assert.equal(locationGroup("N/A"), OTHER_LOCATION);
  const counts = locationCounts([
    { location_type: "RESIDENTIAL BUILDING", n: "7" }, { location_type: "Residential Building/House", n: "3" }, { n: "4" }
  ]);
  assert.deepEqual(counts, { "Residential building": 10, [OTHER_LOCATION]: 4 });
});

test("only Closed counts as closed", () => {
  const s = statusCounts([
    { status: "Closed", n: "90" }, { status: "Open", n: "5" }, { status: "In Progress", n: "3" }, { status: "Pending", n: "2" }
  ]);
  assert.deepEqual(s, { closed: 90, open: 10 });
  close(openShare(s), 0.1);
  assert.equal(openShare({ open: 0, closed: 0 }), 0);
});

test("topTypes sorts by count, then name", () => {
  assert.deepEqual(topTypes({ B: 2, A: 2, C: 5 }, 2).map((t) => t.key), ["C", "A"]);
});

// ---------- Location types ----------

test("location comparison keeps the top groups and folds the rest into Other", () => {
  const local = { "Residential building": 60, "Street or sidewalk": 30, Park: 5, School: 5 };
  const city = { "Residential building": 40, "Street or sidewalk": 35, Park: 12.5, School: 12.5 };
  const rows = locationComparison(local, null, city, 3);
  assert.deepEqual(rows.map((r) => r.key), ["Residential building", "Street or sidewalk", OTHER_LOCATION]);
  close(rows[2].here, 0.1);
  close(rows[2].city, 0.25);
  assert.equal(rows[0].borough, null);
});

// ---------- Queries ----------

test("window cutoffs are calendar days, clamped to the month's end", () => {
  assert.equal(windowStart("12m", new Date("2026-10-28T15:00:00Z")), "2025-10-28");
  assert.equal(windowStart("3m", new Date("2026-05-31T00:00:00Z")), "2026-02-28");
  assert.throws(() => windowStart("all"));
});

test("radius queries use within_circle on the location point", () => {
  assert.equal(circle(40.7484, -73.9857, RADII.immediate), "within_circle(location, 40.74840, -73.98570, 402)");
  assert.equal(RADII.neighborhood, 1609);
});

// ---------- Input parsing ----------

test("a ZIP alone, in the text or the ZIP field", () => {
  assert.deepEqual(parseLocationInput({ text: "11211" }), { kind: "zip", zip: "11211" });
  assert.deepEqual(parseLocationInput({ zip: "10003" }), { kind: "zip", zip: "10003" });
  assert.equal(parseLocationInput({ text: "90210" }).kind, "error");
  assert.equal(parseLocationInput({ zip: "1121" }).kind, "error");
  assert.ok(isNycZip("11697"));
  assert.ok(!isNycZip("07030"));
});

test("a borough alone", () => {
  assert.deepEqual(parseLocationInput({ text: "Queens" }), { kind: "borough", borough: "QUEENS" });
  assert.deepEqual(parseLocationInput({ text: "the Bronx" }), { kind: "borough", borough: "BRONX" });
  assert.deepEqual(parseLocationInput({ borough: "STATEN ISLAND" }), { kind: "borough", borough: "STATEN ISLAND" });
  assert.equal(parseLocationInput({ text: "NYC" }).kind, "error");
  assert.deepEqual(parseLocationInput({}), { kind: "empty" });
});

test("an address: house number, street, borough or ZIP split off the end", () => {
  assert.deepEqual(parseLocationInput({ text: "350 5th Ave, Manhattan" }),
    { kind: "address", houseNumber: "350", text: "350 5th Ave", borough: "MANHATTAN" });
  assert.deepEqual(parseLocationInput({ text: "41-41 Kissena Blvd" }),
    { kind: "address", houseNumber: "41-41", text: "41-41 Kissena Blvd" });
  assert.deepEqual(parseLocationInput({ text: "350 5th Ave, New York, NY 10118" }),
    { kind: "address", houseNumber: "350", text: "350 5th Ave", borough: "MANHATTAN", zip: "10118" });
});

test("a street, alone or with a borough or ZIP", () => {
  assert.deepEqual(parseLocationInput({ text: "Broadway" }), { kind: "street", text: "Broadway" });
  assert.deepEqual(parseLocationInput({ text: "Atlantic Ave, Brooklyn" }), { kind: "street", text: "Atlantic Ave", borough: "BROOKLYN" });
  assert.deepEqual(parseLocationInput({ text: "Bedford Ave", zip: "11211" }), { kind: "street", text: "Bedford Ave", zip: "11211" });
  assert.deepEqual(parseLocationInput({ text: "5th Ave" }), { kind: "street", text: "5th Ave" });
  // Borough words inside a street name stay put.
  assert.deepEqual(parseLocationInput({ text: "Queens Blvd" }), { kind: "street", text: "Queens Blvd" });
  assert.deepEqual(parseLocationInput({ text: "Bronx River Ave" }), { kind: "street", text: "Bronx River Ave" });
  // The borough field wins over a name typed at the end.
  assert.equal(parseLocationInput({ text: "Broadway, Queens", borough: "MANHATTAN" }).borough, "MANHATTAN");
});

test("street names read like people write them", () => {
  assert.equal(prettyStreet("5 AVENUE"), "5th Avenue");
  assert.equal(prettyStreet("EAST 112 STREET"), "East 112th Street");
  assert.equal(prettyStreet("B'WAY"), "Broadway");
  assert.equal(prettyStreet("WEST 23 STREET"), "West 23rd Street");
  assert.equal(placeLabel({ houseNumber: "350", street: "5 AVENUE", borough: "MANHATTAN", zip: "10118" }), "350 5th Avenue, Manhattan 10118");
});

test("the location round-trips through the URL", () => {
  const loc = { kind: "point", lat: 40.74844, lon: -73.98566, label: "350 5th Avenue, Manhattan 10118", borough: "MANHATTAN", zip: "10118" };
  const params = locationToParams(loc, { window: "3m", area: "immediate", vs: "city" });
  const back = locationFromParams(params);
  assert.deepEqual(back, { window: "3m", area: "immediate", vs: "city", location: loc });
  assert.deepEqual(locationFromParams(new URLSearchParams("zip=11211")).location, { kind: "zip", zip: "11211", borough: null });
  assert.deepEqual(locationFromParams(new URLSearchParams("boro=QUEENS")).location, { kind: "borough", borough: "QUEENS" });
  // Outside NYC or junk falls back to nothing chosen; the default window is 12 months.
  const outside = locationFromParams(new URLSearchParams("lat=34.05&lon=-118.24&window=99y"));
  assert.equal(outside.location, null);
  assert.equal(outside.window, "12m");
});

// ---------- Resolution (canned GeoSearch results) ----------

const place = (houseNumber, street, borough, zip, lat = 40.7, lon = -73.9) => ({
  houseNumber, street, name: `${houseNumber} ${street}`, borough, zip, lat, lon,
  label: placeLabel({ houseNumber, street, borough, zip })
});

test("an exact address in one borough resolves", () => {
  const parsed = parseLocationInput({ text: "350 5th Ave, Manhattan" });
  const r = chooseMatch(parsed, [place("350", "5 AVENUE", "MANHATTAN", "10118"), place("350", "5 AVENUE", "BROOKLYN", "11215")]);
  assert.equal(r.status, "resolved");
  assert.equal(r.place.label, "350 5th Avenue, Manhattan 10118");
});

test("the same address in two boroughs asks which", () => {
  const parsed = parseLocationInput({ text: "350 5th Ave" });
  const r = chooseMatch(parsed, [place("350", "5 AVENUE", "MANHATTAN", "10118"), place("350", "5 AVENUE", "BROOKLYN", "11215")]);
  assert.equal(r.status, "choose");
  assert.equal(r.reason, "ambiguous");
  assert.equal(r.suggestions.length, 2);
});

test("a house number GeoSearch didn't find is offered as suggestions, not picked", () => {
  // GeoSearch's answer for "1600 Pennsylvania Ave Washington DC".
  const parsed = parseLocationInput({ text: "1600 Pennsylvania Ave Washington DC" });
  const r = chooseMatch(parsed, [place("218", "PENNSYLVANIA AVENUE", "BROOKLYN", "11207")]);
  assert.equal(r.status, "choose");
  assert.equal(r.reason, "inexact");
});

test("a street with a borough takes the top match in that borough", () => {
  const parsed = parseLocationInput({ text: "Atlantic Ave, Brooklyn" });
  const r = chooseMatch(parsed, [place("600", "ATLANTIC AVENUE", "QUEENS", "11416"), place("71", "ATLANTIC AVENUE", "BROOKLYN", "11201")]);
  assert.equal(r.status, "resolved");
  assert.equal(r.place.borough, "BROOKLYN");
  assert.equal(r.onStreet, true);
});

test("matches on a different street don't count", () => {
  assert.equal(streetMatches("Atlantic Ave", place("71", "ATLANTIC AVENUE", "BROOKLYN", "11201")), true);
  assert.equal(streetMatches("5th Ave", place("350", "5 AVENUE", "MANHATTAN", "10118")), true);
  assert.equal(streetMatches("Broadway", place("1306", "B'WAY", "BROOKLYN", "11221")), true);
  assert.equal(streetMatches("Asdfgh", place("1", "MAIN STREET", "QUEENS", "11354")), false);
  const parsed = parseLocationInput({ text: "Asdfgh, Queens" });
  assert.equal(chooseMatch(parsed, [place("1", "MAIN STREET", "QUEENS", "11354")]).status, "not-found");
});

test("a street in several boroughs is searched in each, then the reader picks", async () => {
  const searched = [];
  const search = async (text) => {
    searched.push(text);
    if (text.endsWith("Manhattan")) return [place("23", "B'WAY", "MANHATTAN", "10004")];
    if (text.endsWith("Brooklyn")) return [place("1306", "B'WAY", "BROOKLYN", "11221")];
    if (text.endsWith("Staten Island")) return [place("1204", "B'WAY", "QUEENS", "11106")]; // GeoSearch falls back to Queens
    return [];
  };
  const r = await resolveLocation(parseLocationInput({ text: "Broadway" }), { search });
  assert.equal(searched.length, 5);
  assert.equal(r.status, "choose");
  assert.deepEqual(r.suggestions.map((p) => p.borough), ["MANHATTAN", "BROOKLYN"]);
});

test("a place in only one borough resolves without asking", async () => {
  const search = async (text) => (text.endsWith("Staten Island") ? [{ ...place(null, null, "STATEN ISLAND", "10307"), name: "TOTTENVILLE MARINA", label: "Tottenville Marina, Staten Island 10307" }] : []);
  const r = await resolveLocation(parseLocationInput({ text: "Tottenville" }), { search });
  assert.equal(r.status, "resolved");
  assert.equal(r.location.borough, "STATEN ISLAND");
});

test("ZIPs and boroughs resolve without GeoSearch", async () => {
  const search = async () => { throw new Error("should not be called"); };
  assert.deepEqual(await resolveLocation(parseLocationInput({ text: "11211" }), { search }),
    { status: "resolved", location: { kind: "zip", zip: "11211", borough: null } });
  assert.deepEqual(await resolveLocation(parseLocationInput({ text: "Queens" }), { search }),
    { status: "resolved", location: { kind: "borough", borough: "QUEENS" } });
});

test("nothing found", async () => {
  const r = await resolveLocation(parseLocationInput({ text: "Asdfgh" }), { search: async () => [] });
  assert.equal(r.status, "not-found");
});

// ---------- Against the rest of the city ----------

test("windowChunks cuts a window into consecutive pieces, newest open-ended", () => {
  const today = new Date("2026-10-28T12:00:00Z");
  assert.deepEqual(windowChunks("12m", 3, today), [
    { since: "2025-10-28", until: "2026-01-28" },
    { since: "2026-01-28", until: "2026-04-28" },
    { since: "2026-04-28", until: "2026-07-28" },
    { since: "2026-07-28", until: null }
  ]);
  assert.deepEqual(windowChunks("3m", 3, today), [{ since: "2026-07-28", until: null }]);
});

test("circleDistributions sums the cells within each radius of every cell with requests", () => {
  // Cells are 1/1000 degree: ~111 m north–south, ~84 m east–west in NYC.
  const cells = [
    { y: 40750, x: -73990, n: 10 },
    { y: 40751, x: -73990, n: 5 },   // ~111 m north: inside 200 m
    { y: 40750, x: -73987, n: 1 },   // ~253 m east: outside 200 m
    { y: 0, x: 0, n: 999 }           // junk coordinates: dropped
  ];
  const d = circleDistributions(cells, { small: 200, big: 1000 }, { quantiles: 3 });
  assert.equal(d.samples, 3);
  // Within 200 m: 15, 15 and 1 → sorted [1, 15, 15].
  assert.deepEqual(d.small, [1, 15, 15]);
  assert.deepEqual(d.big, [16, 16, 16]);
});

test("cityRank and cityRankText place a count among the quantiles", () => {
  const q = Array.from({ length: 101 }, (_, i) => i * 10); // 0, 10, ..., 1000
  const r = cityRank(q, 725);
  close(r.below, 73 / 101);
  close(r.above, 28 / 101);
  assert.deepEqual(cityRankText(r), { more: true, pct: 72 });
  // A quiet spot reads the other way round.
  assert.deepEqual(cityRankText(cityRank(q, 95)), { more: false, pct: 90 });
  // Never "100%".
  assert.deepEqual(cityRankText(cityRank(q, 5000)), { more: true, pct: 99 });
  assert.equal(cityRank([], 5), null);
});

// ---------- Heat map ----------

test("heatmapParams counts per grid cell in the area, filtered on normalized complaint types", () => {
  const all = heatmapParams("2025-10-28", "within_circle(location, 40.748, -73.986, 1609)");
  assert.equal(all.$group, "y, x");
  assert.ok(!all.$where.includes("complaint_type"));
  const some = heatmapParams("2025-10-28", "x", ["Noise - Residential", "O'BRIEN"]);
  assert.match(some.$where, /upper\(trim\(complaint_type\)\) IN \('NOISE - RESIDENTIAL', 'O''BRIEN'\)$/);
});

// ---------- Baselines and the comparison view ----------

test("baselineParams counts only requests with a location, like the radius counts", () => {
  assert.match(baselineParams("2025-10-28", "complaint_type").$where, /^created_date >= '2025-10-28T00:00:00' AND location IS NOT NULL$/);
});

test("comparisonView falls back to the 1 mile and says why when the ¼ mile failed", () => {
  const ready = (data) => ({ status: "ready", data, error: null });
  const area = { total: 500, types: { NOISE: 500 }, locations: {}, status: { open: 0, closed: 500 } };
  const state = {
    location: { kind: "point", lat: 40.7, lon: -73.9 }, window: "12m", area: "immediate", vs: "city", borough: null,
    immediate: { status: "error", data: null, error: new Error("upstream") },
    neighborhood: ready(area), zip: { status: "idle" },
    baseline: ready({ city: area, borough: null })
  };
  const failed = comparisonView(state);
  assert.equal(failed.area, "neighborhood");
  assert.equal(failed.immediateFailed, true);
  const low = comparisonView({ ...state, immediate: ready({ ...area, total: 10 }) });
  assert.equal(low.immediateFailed, false);
  assert.equal(low.immediateOk, false);
});
