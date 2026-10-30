/*
 * Street Closures Near You logic: street names, purposes, building the block
 * index (dedupe, grouping, dates), time windows and their edge days, status
 * chips, distances, the summary numbers and the URL round-trip.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { streetKey, streetLabel, suggestStreets, resolveStreet } from "../src/lib/street-closures/streets.js";
import { describePurpose } from "../src/lib/street-closures/purposes.js";
import {
  calendarDate, windowRange, overlaps, buildIndex, selectBlocks, mergeSpans, blockStatus,
  blocksInView, windowCounts, purposeCounts, dailyCounts, topStreets, sortBlocks
} from "../src/lib/street-closures/closures.js";
import { distanceToLine } from "../src/lib/street-closures/geo.js";
import { normalizeQuery, queryToParams, searchParams, selection } from "../src/lib/street-closures/filter.js";
import { rangeLabel, blockTitle, timingText, chips, cardHtml, placeText, stripHtml, postedNote } from "../src/lib/street-closures/render.js";

const TODAY = "2026-10-30"; // a Friday

const line = (lat, lon) => ({ type: "MultiLineString", coordinates: [[[lon, lat], [lon + 0.001, lat + 0.001]]] });
const row = (over = {}) => ({
  uniqueid: "u1", segmentid: "100", onstreetname: "WEST    8 STREET", fromstreetname: "AVENUE S", tostreetname: "AVENUE T",
  borough_code: "B", work_start_date: "2026-10-28T00:00:00.000", work_end_date: "2026-11-05T00:00:00.000",
  purpose: "DOT IN-HOUSE PAVING", the_geom: line(40.6, -73.98), ...over
});

// ---------- Street names ----------

test("street names: one spelling for abbreviations, ordinals, directions, padding and Saint", () => {
  assert.equal(streetKey("WEST    8 STREET"), "WEST 8 STREET");
  assert.equal(streetKey("W 8th St"), "WEST 8 STREET");
  assert.equal(streetKey("e 47 st."), "EAST 47 STREET");
  assert.equal(streetKey("1st Ave"), "1 AVENUE");
  assert.equal(streetKey("First Avenue"), "1 AVENUE");
  assert.equal(streetKey("Francis Lewis Blvd"), "FRANCIS LEWIS BOULEVARD");
  assert.equal(streetKey("St. Marks Pl"), "ST MARKS PLACE", "a leading St is Saint, as the data spells it");
  assert.equal(streetKey("Saint Marks Place"), "ST MARKS PLACE");
  assert.equal(streetKey("Avenue S"), "AVENUE S", "a trailing letter is an avenue's name, not South");
  assert.equal(streetKey("B'way"), "BROADWAY");
  assert.equal(streetLabel("WEST    8 STREET"), "West 8th Street");
});

const STREETS = [
  { key: "WEST 8 STREET", label: "West 8th Street", blocks: 3 },
  { key: "EAST 8 STREET", label: "East 8th Street", blocks: 9 },
  { key: "WEST 18 STREET", label: "West 18th Street", blocks: 20 },
  { key: "8 AVENUE", label: "8th Avenue", blocks: 1 },
  { key: "MC DONALD AVENUE", label: "Mc Donald Avenue", blocks: 16 },
  { key: "BROADWAY", label: "Broadway", blocks: 75 }
];

test("autocomplete: matches from the start of a word, starts-with first, then busier streets", () => {
  assert.deepEqual(suggestStreets(STREETS, "8 st").map((s) => s.key), ["EAST 8 STREET", "WEST 8 STREET"], "not 18th Street");
  assert.deepEqual(suggestStreets(STREETS, "w 8").map((s) => s.key), ["WEST 8 STREET"]);
  assert.deepEqual(suggestStreets(STREETS, "8").map((s) => s.key), ["8 AVENUE", "EAST 8 STREET", "WEST 8 STREET"]);
  assert.deepEqual(suggestStreets(STREETS, "mcdonald ave").map((s) => s.key), ["MC DONALD AVENUE"]);
  assert.deepEqual(suggestStreets(STREETS, ""), []);
});

test("resolving a typed street: exact match, or the only suggestion, else nothing", () => {
  assert.equal(resolveStreet(STREETS, "W 8th Street").key, "WEST 8 STREET");
  assert.equal(resolveStreet(STREETS, "broad").key, "BROADWAY");
  assert.equal(resolveStreet(STREETS, "8 st"), null, "East and West 8th: ask");
  assert.equal(resolveStreet(STREETS, "Nowhere Lane"), null);
});

// ---------- Purposes ----------

test("purposes: plain labels and groups; protected-street suffixes, even cut short, share them", () => {
  assert.deepEqual(describePurpose("DOT IN-HOUSE PAVING"), { group: "paving", label: "Repaving by a DOT crew", protected: false });
  assert.deepEqual(describePurpose("MAJOR INSTALLATIONS - GAS-PROTECTED"), { group: "gas", label: "New gas lines", protected: true });
  assert.equal(describePurpose("DDC CONTRACTOR MAJOR RECONSTRUCTION-PROT").group, "reconstruction");
  assert.equal(describePurpose("PAVE STREET-W/ ENGINEERING & INSP FEE-P").protected, true);
  assert.equal(describePurpose("REPAIR WATER - SEWER - PROTECTED").label, "Sewer repair");
  assert.equal(describePurpose("PLACE EQUIPMENT OTHER THAN CRANE OR SHOV").group, "equipment");
  assert.deepEqual(describePurpose("SOMETHING NEW"), { group: "other", label: "Something new", protected: false });
  assert.equal(describePurpose("DOT IN-HOUSE MILLING").protected, false, "IN-HOUSE isn't a protected suffix");
});

// ---------- Index ----------

test("index: dates parsed as calendar days, duplicate uniqueids dropped, permits grouped by block", () => {
  assert.equal(calendarDate("2026-10-27T00:00:00.000"), "2026-10-27");
  assert.equal(calendarDate(""), null);
  const { blocks, streets, postedThrough } = buildIndex([
    row(),
    row(), // the same permit again, word for word
    row({ uniqueid: "u2", work_start_date: "2026-11-06T00:00:00.000", work_end_date: "2026-11-10T00:00:00.000", purpose: "REPAIR GAS" }),
    row({ uniqueid: "u3", work_end_date: "2026-10-29T00:00:00.000" }), // ended yesterday
    row({ uniqueid: "u4", segmentid: "200", onstreetname: "AVENUE S", fromstreetname: "WEST 7 STREET", tostreetname: "WEST 8 STREET" }),
    row({ uniqueid: "u5", segmentid: "300", the_geom: null }),
    row({ uniqueid: "u6", segmentid: "400", work_start_date: null })
  ], TODAY);
  assert.equal(blocks.length, 2);
  const w8 = blocks.find((b) => b.seg === "100");
  assert.deepEqual(w8.permits.map((p) => p.id), ["u1", "u2"]);
  assert.equal(w8.on, "WEST 8 STREET", "spaces collapsed");
  assert.equal(w8.onKey, "WEST 8 STREET");
  assert.deepEqual(w8.lines, [[[40.6, -73.98], [40.601, -73.979]]], "[lat, lon], rounded");
  assert.deepEqual(streets.map((s) => [s.key, s.blocks]), [["AVENUE S", 2], ["AVENUE T", 1], ["WEST 7 STREET", 1], ["WEST 8 STREET", 2]],
    "cross streets too, counted the way a street search finds them");
  assert.equal(postedThrough, "2026-11-06", "the latest start");
});

test("index: a street that's only ever a cross street can be searched, but DOT's stand-ins can't", () => {
  const { streets } = buildIndex([
    row({ onstreetname: "UNION TURNPIKE", fromstreetname: "BEND", tostreetname: "PROSPECT PLACE" }),
    row({ uniqueid: "u2", segmentid: "200", onstreetname: "ELM AVENUE", fromstreetname: "DEAD END", tostreetname: "WASHINGTON CEMETERY BOUNDARY" })
  ], TODAY);
  assert.deepEqual(streets.map((s) => s.key), ["ELM AVENUE", "PROSPECT PLACE", "UNION TURNPIKE"]);
  assert.equal(resolveStreet(streets, "Prospect Pl").key, "PROSPECT PLACE");
});

test("index: segments with the same names are one block only where they touch", () => {
  const far = (lat, lon) => ({ type: "MultiLineString", coordinates: [[[lon, lat], [lon + 0.001, lat]]] });
  const { blocks } = buildIndex([
    row({ uniqueid: "b1", segmentid: "1", onstreetname: "BRUCKNER BOULEVARD", fromstreetname: "PEDESTRIAN OVERPASS", tostreetname: "PEDESTRIAN OVERPASS", the_geom: far(40.824, -73.878) }),
    row({ uniqueid: "b2", segmentid: "2", onstreetname: "BRUCKNER BOULEVARD", fromstreetname: "PEDESTRIAN OVERPASS", tostreetname: "PEDESTRIAN OVERPASS", the_geom: far(40.848, -73.827) }), // 5 km away
    row({ uniqueid: "b3", segmentid: "3", onstreetname: "BRUCKNER BOULEVARD", fromstreetname: "PEDESTRIAN OVERPASS", tostreetname: "PEDESTRIAN OVERPASS", the_geom: far(40.824, -73.876) }), // starts 84 m past b1's end: apart for now
    row({ uniqueid: "b4", segmentid: "4", onstreetname: "BRUCKNER BOULEVARD", fromstreetname: "PEDESTRIAN OVERPASS", tostreetname: "PEDESTRIAN OVERPASS", the_geom: far(40.824, -73.877), purpose: "REPAIR GAS" }) // bridges b1 and b3
  ], TODAY);
  assert.deepEqual(blocks.map((b) => [b.seg, b.segs.slice().sort()]).sort(), [["1", ["1", "3", "4"]], ["2", ["2"]]]);
  const joined = blocks.find((b) => b.seg === "1");
  assert.deepEqual(joined.permits.map((p) => p.purpose), ["DOT IN-HOUSE PAVING", "REPAIR GAS"], "the bridged blocks' copies of a permit are one permit");
});

test("index: a block split into several segments is one block, and their copies of a permit are one permit", () => {
  const { blocks } = buildIndex([
    row({ uniqueid: "s1", segmentid: "115740" }),
    row({ uniqueid: "s2", segmentid: "53352", the_geom: line(40.601, -73.979) }), // same block, next segment, same work
    row({ uniqueid: "s3", segmentid: "53352", the_geom: line(40.601, -73.979), purpose: "REPAIR GAS" }),
    row({ uniqueid: "s4", segmentid: "777", fromstreetname: "AVENUE T", tostreetname: "AVENUE S" }), // cross streets the other way round
    row({ uniqueid: "s5", segmentid: "888", borough_code: "Q" }) // same names, other borough
  ], TODAY);
  assert.equal(blocks.length, 2);
  const b = blocks.find((x) => x.boro === "B");
  assert.equal(b.seg, "777", "the lowest segmentid names the block");
  assert.deepEqual(b.segs, ["115740", "53352", "777"]);
  assert.equal(b.lines.length, 3);
  assert.deepEqual(b.permits.map((p) => p.purpose), ["DOT IN-HOUSE PAVING", "REPAIR GAS"]);
});

test("selecting blocks: a street matches as the closed street or a cross street; borough narrows", () => {
  const { blocks } = buildIndex([
    row(),
    row({ uniqueid: "u4", segmentid: "200", onstreetname: "AVENUE S", fromstreetname: "WEST 7 STREET", tostreetname: "WEST 8 STREET" }),
    row({ uniqueid: "u7", segmentid: "500", borough_code: "M", onstreetname: "WEST 8 STREET", fromstreetname: "5 AVENUE", tostreetname: "6 AVENUE" })
  ], TODAY);
  assert.deepEqual(selectBlocks(blocks, { street: "WEST 8 STREET" }, TODAY).map((b) => b.seg), ["100", "200", "500"]);
  assert.deepEqual(selectBlocks(blocks, { street: "WEST 8 STREET", boro: "M" }, TODAY).map((b) => b.seg), ["500"]);
  assert.deepEqual(selectBlocks(blocks, { boro: "B" }, TODAY).map((b) => b.seg), ["100", "200"]);
  assert.equal(selectBlocks(blocks, {}, TODAY).length, 3);
  assert.equal(selectBlocks(blocks, {}, "2026-11-06").length, 0, "every permit has ended by then");
});

test("near me: blocks within the radius, nearest first, distance to the line not its ends", () => {
  // A line running east–west; the spot is 100 m north of its middle.
  const east = { type: "MultiLineString", coordinates: [[[-74.01, 40.7], [-73.99, 40.7]]] };
  const d = distanceToLine({ lat: 40.7 + 100 / 111195, lon: -74.0 }, [[40.7, -74.01], [40.7, -73.99]]);
  assert.ok(Math.abs(d - 100) < 0.5, `≈100 m, got ${d}`);
  const { blocks } = buildIndex([
    row({ the_geom: east }),
    row({ uniqueid: "u9", segmentid: "900", onstreetname: "AVENUE U", the_geom: line(40.72, -74.0) })
  ], TODAY);
  const near = selectBlocks(blocks, { near: { lat: 40.701, lon: -74.0, meters: 805 } }, TODAY);
  assert.deepEqual(near.map((b) => [b.seg, b.meters]), [["100", 111]]);
  const wide = selectBlocks(blocks, { near: { lat: 40.701, lon: -74.0, meters: 1609 * 2 } }, TODAY);
  assert.deepEqual(wide.map((b) => b.seg), ["100", "900"]);
});

// ---------- Windows ----------

test("windows: today, through Sunday, through month's end, 90 days, and open-ended", () => {
  assert.deepEqual(windowRange("today", TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(windowRange("week", TODAY), { from: TODAY, to: "2026-11-01" });
  assert.deepEqual(windowRange("week", "2026-11-01"), { from: "2026-11-01", to: "2026-11-01" }, "on Sunday the week is today");
  assert.deepEqual(windowRange("week", "2026-11-02"), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(windowRange("month", TODAY), { from: TODAY, to: "2026-10-31" });
  assert.deepEqual(windowRange("month", "2026-02-10"), { from: "2026-02-10", to: "2026-02-28" });
  assert.deepEqual(windowRange("90d", TODAY), { from: TODAY, to: "2027-01-27" });
  assert.deepEqual(windowRange("all", TODAY), { from: TODAY, to: null });
});

test("edge days: a permit that starts today or ends today is active today", () => {
  const today = windowRange("today", TODAY);
  assert.equal(overlaps({ start: TODAY, end: "2026-11-30" }, today), true);
  assert.equal(overlaps({ start: "2026-10-01", end: TODAY }, today), true);
  assert.equal(overlaps({ start: TODAY, end: TODAY }, today), true);
  assert.equal(overlaps({ start: "2026-10-01", end: "2026-10-29" }, today), false);
  assert.equal(overlaps({ start: "2026-10-31", end: "2026-11-02" }, today), false);
  assert.equal(overlaps({ start: "2026-10-31", end: "2026-11-02" }, windowRange("week", TODAY)), true);
});

// ---------- Status ----------

test("spans: overlapping and back-to-back permits merge, gaps don't", () => {
  assert.deepEqual(mergeSpans([
    { start: "2026-10-28", end: "2026-10-29" }, { start: "2026-10-22", end: "2026-10-27" }, { start: "2026-11-05", end: "2026-11-06" }
  ]), [{ start: "2026-10-22", end: "2026-10-29" }, { start: "2026-11-05", end: "2026-11-06" }]);
});

test("status: active, starts soon, later, ending soon and long-running", () => {
  assert.deepEqual(blockStatus([{ start: TODAY, end: TODAY }], TODAY),
    { state: "active", span: { start: TODAY, end: TODAY }, daysLeft: 0, endingSoon: true, longRunning: false });
  assert.equal(blockStatus([{ start: "2026-10-01", end: "2026-11-02" }], TODAY).endingSoon, true, "3 days out");
  assert.equal(blockStatus([{ start: "2026-10-01", end: "2026-11-03" }], TODAY).endingSoon, false, "4 days out");
  assert.equal(blockStatus([{ start: "2026-11-02", end: "2026-11-09" }], TODAY).state, "soon");
  assert.equal(blockStatus([{ start: "2026-11-03", end: "2026-11-09" }], TODAY).state, "later");
  assert.equal(blockStatus([{ start: "2026-08-01", end: "2026-10-29" }, { start: "2026-10-30", end: "2026-11-15" }], TODAY).longRunning, true,
    "back-to-back permits count as one long closure");
  assert.equal(blockStatus([{ start: "2026-10-01", end: "2026-12-29" }], TODAY).longRunning, false, "exactly 90 days isn't over 90");
  assert.equal(blockStatus([{ start: "2026-10-01", end: "2026-12-30" }], TODAY).longRunning, true);
});

test("cards: title, dates, timing and chips in words", () => {
  const b = { seg: "1", on: "WEST 8 STREET", from: "AVENUE S", to: "AVENUE T", boro: "B", onKey: "WEST 8 STREET" };
  assert.equal(blockTitle(b), "West 8th Street between Avenue S and Avenue T, Brooklyn");
  assert.equal(blockTitle({ ...b, to: "AVENUE S" }), "West 8th Street at Avenue S, Brooklyn");
  assert.equal(rangeLabel("2026-10-22", "2026-11-09"), "Oct 22 – Nov 9, 2026");
  assert.equal(rangeLabel("2026-12-20", "2027-01-05"), "Dec 20, 2026 – Jan 5, 2027");
  const s = blockStatus([{ start: TODAY, end: "2026-11-09" }], TODAY);
  assert.equal(timingText(s, TODAY), "Starts today · 10 days left");
  assert.equal(timingText(blockStatus([{ start: "2026-10-01", end: "2026-10-31" }], TODAY), TODAY), "Ends tomorrow");
  assert.equal(timingText(blockStatus([{ start: "2026-11-04", end: "2026-11-09" }], TODAY), TODAY), "Starts in 5 days");
  assert.deepEqual(chips(blockStatus([{ start: "2026-08-01", end: TODAY }], TODAY)).map((c) => c[1]), ["Active now", "Ending soon", "Long-running"]);
  const html = cardHtml({ ...b, permits: [{ id: "x", start: TODAY, end: "2026-11-09", purpose: "<b>REPAIR GAS</b>" }], status: s }, TODAY);
  assert.ok(html.includes("&#60;b&#62;"), "data is escaped");
  assert.ok(!html.includes("Film permits"), "no link until the Film Permits dashboard exists");
});

// ---------- Views ----------

const VIEW_BLOCKS = [
  { seg: "a", on: "BROADWAY", onKey: "BROADWAY", boro: "M", permits: [{ start: "2026-10-01", end: TODAY, purpose: "DOT IN-HOUSE PAVING" }] },
  { seg: "b", on: "BROADWAY", onKey: "BROADWAY", boro: "M", permits: [
    { start: "2026-11-02", end: "2026-11-04", purpose: "REPAIR GAS" }, { start: "2026-11-02", end: "2026-11-20", purpose: "PLACE CRANE OR SHOVEL ON STREET" }] },
  { seg: "c", on: "1 AVENUE", onKey: "1 AVENUE", boro: "M", permits: [{ start: "2026-11-10", end: "2026-11-12", purpose: "REPAIR GAS" }] },
  { seg: "d", on: "1 AVENUE", onKey: "1 AVENUE", boro: "M", permits: [{ start: "2027-01-15", end: "2027-03-01", purpose: "DOT IN-HOUSE PAVING" }] }
];

test("counts per window, and with a purpose picked", () => {
  assert.deepEqual(windowCounts(VIEW_BLOCKS, TODAY), { today: 1, week: 1, month: 1, "90d": 4, all: 4 });
  assert.deepEqual(windowCounts(VIEW_BLOCKS, TODAY, "gas"), { today: 0, week: 0, month: 0, "90d": 2, all: 2 });
  const view = blocksInView(VIEW_BLOCKS, windowRange("all", TODAY), "gas");
  assert.deepEqual(view.find((b) => b.seg === "b").inView.map((p) => p.purpose), ["REPAIR GAS"], "only the picked kind of work");
  // Block b: gas Nov 2–4 and a crane through Nov 20. With gas picked, the card is about the gas work.
  const [gas] = sortBlocks(view.filter((b) => b.seg === "b"), TODAY);
  assert.deepEqual(gas.status.span, { start: "2026-11-02", end: "2026-11-04" }, "status and dates follow the filter");
  assert.ok(cardHtml(gas, TODAY).includes("Nov 2 – Nov 4, 2026") && !cardHtml(gas, TODAY).includes("Nov 20"));
});

test("not posted yet: days past the latest posted start are marked, and windows past it get a note", () => {
  const days = dailyCounts(VIEW_BLOCKS, TODAY, null, 10);
  const html = stripHtml(days, windowRange("today", TODAY), "2026-11-06");
  assert.equal((html.match(/is-unposted/g) ?? []).length, 2, "Nov 7 and 8");
  assert.ok(html.includes("aren't fully posted yet"));
  assert.ok(!stripHtml(days, windowRange("today", TODAY), "2026-12-31").includes("is-unposted"));
  assert.equal(postedNote(windowRange("week", TODAY), "2026-11-06"), null, "this week ends Nov 1");
  assert.match(postedNote(windowRange("90d", TODAY), "2026-11-06"), /starts Nov 6, 2026/);
  assert.match(postedNote(windowRange("all", TODAY), "2026-11-06"), /aren’t listed yet/);
});

test("purpose bars count blocks, a block with two kinds of work in each", () => {
  assert.deepEqual(purposeCounts(VIEW_BLOCKS, windowRange("90d", TODAY)),
    [{ group: "paving", blocks: 2 }, { group: "gas", blocks: 2 }, { group: "equipment", blocks: 1 }], "ties in the groups' order");
});

test("per-day strip counts each block once a day, from today", () => {
  const days = dailyCounts(VIEW_BLOCKS, TODAY, null, 6);
  assert.deepEqual(days.map((d) => [d.day, d.blocks]), [
    ["2026-10-30", 1], ["2026-10-31", 0], ["2026-11-01", 0], ["2026-11-02", 1], ["2026-11-03", 1], ["2026-11-04", 1]
  ]);
});

test("most affected streets and card order", () => {
  assert.deepEqual(topStreets(VIEW_BLOCKS).map((s) => [s.label, s.blocks, s.boros]), [["1st Avenue", 2, ["M"]], ["Broadway", 2, ["M"]]]);
  assert.deepEqual(sortBlocks(VIEW_BLOCKS, TODAY).map((b) => b.seg), ["a", "b", "c", "d"], "active, then soon, then by start");
  const near = sortBlocks([{ ...VIEW_BLOCKS[3], meters: 50 }, { ...VIEW_BLOCKS[0], meters: 300 }], TODAY);
  assert.deepEqual(near.map((b) => b.seg), ["d", "a"], "near me: nearest first");
});

// ---------- URL ----------

const q = (s) => normalizeQuery(new URLSearchParams(s));

test("URL: modes, defaults and bad values", () => {
  assert.deepEqual(q(""), { mode: "city", street: null, boro: null, lat: null, lon: null, r: 0.5, when: "today", purpose: null });
  assert.equal(q("street=w 8th st&boro=b").street, "WEST 8 STREET");
  assert.equal(q("street=w 8th st&boro=b").boro, "B");
  assert.equal(q("boro=K").mode, "city", "Brooklyn is B in this dataset");
  assert.equal(q("boro=Q&when=week&purpose=gas").mode, "borough");
  assert.equal(q("when=forever&purpose=lasers").when, "today");
  const near = q("lat=40.71234&lon=-74.00611&r=1&street=BROADWAY");
  assert.deepEqual([near.mode, near.lat, near.lon, near.r, near.street], ["near", 40.712, -74.006, 1, null], "a spot wins");
  assert.equal(q("lat=51.5&lon=-0.12").mode, "city", "not in NYC");
  assert.equal(q("lat=40.7&lon=-74&r=3").r, 0.5);
});

test("URL round trip, and the API gets the place only", () => {
  for (const s of ["", "street=WEST+8+STREET&boro=B&when=week", "boro=Q&purpose=gas", "lat=40.712&lon=-74.006&r=0.25&when=all"]) {
    assert.equal(queryToParams(q(s)).toString(), s);
  }
  assert.equal(searchParams(q("boro=Q&when=week&purpose=gas")).toString(), "boro=Q");
  assert.deepEqual(selection(q("lat=40.712&lon=-74.006")), { near: { lat: 40.712, lon: -74.006, meters: 0.5 * 1609.344 } });
  assert.equal(placeText(q("street=BROADWAY&boro=M"), ""), "on or crossing Broadway in Manhattan");
  assert.equal(placeText(q("lat=40.712&lon=-74.006&r=1"), "your location"), "within 1 mile of your location");
});
