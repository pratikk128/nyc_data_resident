/*
 * Where can I get help near me? logic: cleaning each directory's rows into
 * one shape (on real rows, tests/fixtures/help-near-me.json), hours and
 * phone formats, geocoding the rows with no point, distances, what the list
 * shows, and the page script's URL and wording.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  tidy, normBorough, normPhone, addressKey, usableAddress, agingDay, dayText, weekHours, dedupeSites,
  normalizeSnap, normalizeHomebase, normalizeDropIn, normalizeComputers, normalizeYouth, normalizeAging, normalizeNycha,
  isNychaRowKept, NORMALIZERS
} from "../src/lib/help-near-me/normalize.js";
import { haversineMiles, byDistance, sitesNear, sitesInBorough, selectView, milesText } from "../src/lib/help-near-me/distance.js";
import { geocodeMissing, lookupText } from "../src/lib/help-near-me/geocode-sites.js";
import {
  normalizeQuery, queryToParams, pointQuery, boroughQuery, searchKey, toggleCategory, summaryText, missingNotes, radiusFor, chipLabel,
  moreText, radiusNote, lowerFirst
} from "../src/lib/help-near-me/page-state.js";
import { cardHtml, directionsUrl } from "../src/lib/help-near-me/render.js";
import { inCityLimits } from "../src/lib/help-near-me/in-city.js";
import { CATEGORIES, HOURS_MISSING } from "../src/lib/help-near-me/config.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/help-near-me.json", import.meta.url)));
const UPDATED = "2026-10-01";
const byId = (sites, id) => sites.find((s) => s.id === id);

// ---------- Cleaners ----------

test("borough names: the directories' spellings → one", () => {
  assert.equal(normBorough("STATEN IS"), "Staten Island");
  assert.equal(normBorough("staten island"), "Staten Island");
  assert.equal(normBorough("BRONX"), "Bronx");
  assert.equal(normBorough("New York"), "Manhattan");
  assert.equal(normBorough(""), null);
  assert.equal(normBorough("Yonkers"), null);
});

test("phones: one display format and a tel: number; not a phone → null", () => {
  assert.deepEqual(normPhone("718-414-1050"), { display: "(718) 414-1050", tel: "+17184141050" });
  assert.deepEqual(normPhone("(212) 281-1349"), { display: "(212) 281-1349", tel: "+12122811349" });
  assert.deepEqual(normPhone("1.212.555.0100 x12"), { display: "(212) 555-0100 ext. 12", tel: "+12125550100,12" });
  assert.equal(normPhone("311"), null);
  assert.equal(normPhone(null), null);
});

test("names: all caps get title case (ordinals and acronyms kept); mixed case stays", () => {
  assert.equal(tidy("RISEBORO COMMUNITY PARTNERSHIP INC"), "Riseboro Community Partnership Inc");
  assert.equal(tidy("ISABELLA GERIATRIC FT GEORGE VISTAS NORC"), "Isabella Geriatric Ft George Vistas NORC");
  assert.equal(tidy("221 WEST 107TH STREET"), "221 West 107th Street");
  assert.equal(tidy("Grant Sq OAC"), "Grant Sq OAC");
  assert.equal(tidy("  "), null);
  assert.equal(tidy("MCDONALD HOUSES"), "McDonald Houses");
  assert.equal(tidy("PS 123 JOHN TYLER"), "PS 123 John Tyler");
  assert.equal(tidy("THIS IS HOME"), "This Is Home", "a prefix only before a number");
});

test("addresses: the same building however it's written; a P.O. box isn't a place", () => {
  assert.equal(addressKey("771 9th Avenue, 2nd Fl"), addressKey("771 9 AVE."));
  assert.equal(addressKey("17 FT. GEORGE HILL"), "17 FT GEORGE HILL");
  assert.equal(addressKey("120 W 14th St Suite 4"), addressKey("120 West 14 Street"));
  assert.ok(usableAddress("1910 Monterey Avenue, 5th Fl."));
  assert.ok(!usableAddress("P.O. Box 123"));
  assert.ok(!usableAddress("Citywide"));
  assert.ok(!usableAddress(null));
  assert.equal(tidy("114 West 14th\u00c2\u00a0Street"), "114 West 14th Street");
});

// ---------- Hours ----------

test("NYC Aging hours: 12-hour clock with no AM/PM; closing at or before opening is afternoon", () => {
  assert.equal(agingDay("09:00", "05:00"), "9 AM – 5 PM");
  assert.equal(agingDay("08:30", "04:30"), "8:30 AM – 4:30 PM");
  assert.equal(agingDay("08:00", "3 :00"), "8 AM – 3 PM", "a stray space in the data");
  assert.equal(agingDay("11:00", "08:00"), "11 AM – 8 PM");
  assert.equal(agingDay("00:00", "00:00"), "Closed");
  assert.equal(agingDay(null, null), null);
});

test("computer center hours: the common spellings read as a range; anything else as written", () => {
  assert.equal(dayText("10am - 6pm"), "10 AM – 6 PM");
  assert.equal(dayText("10:00AM - 6:00PM"), "10 AM – 6 PM");
  assert.equal(dayText("8:30 AM - 4:30 PM"), "8:30 AM – 4:30 PM");
  assert.equal(dayText("12:00 PM - 8:00 PM"), "12 PM – 8 PM");
  assert.equal(dayText("Closed - Closed"), "Closed");
  assert.equal(dayText("By appointment"), "By appointment");
  assert.equal(dayText(""), null);
  assert.equal(dayText("N/A"), null);
});

test("a week of hours: runs of the same hours joined; days not listed left out", () => {
  const nineToFive = "9 AM – 5 PM";
  assert.equal(weekHours([nineToFive, nineToFive, nineToFive, nineToFive, nineToFive, "Closed", "Closed"]), "Mon–Fri 9 AM – 5 PM · Sat–Sun Closed");
  assert.equal(weekHours(Array(7).fill(nineToFive)), "Every day 9 AM – 5 PM");
  assert.equal(weekHours(Array(7).fill("Closed")), null, "closed every day means no hours listed");
  assert.equal(weekHours(["A", "B", "A", null, null, null, null]), "Mon A · Tue B · Wed A");
  assert.equal(weekHours(Array(7).fill(null)), null);
});

// ---------- One fixture per directory ----------

test("every directory has a normalizer, and every site has the common shape", () => {
  const keys = ["id", "category", "name", "address", "borough", "zip", "lat", "lon", "phone", "hours", "services", "sourceDatasetId", "sourceUpdatedAt"];
  for (const c of CATEGORIES) {
    const sites = NORMALIZERS[c.datasetId](FX[c.datasetId], UPDATED);
    assert.ok(sites.length, `${c.datasetId} gave sites`);
    for (const s of sites) {
      for (const k of keys) assert.ok(k in s, `${c.datasetId} site has ${k}`);
      assert.equal(s.category, c.key);
      assert.equal(s.sourceDatasetId, c.datasetId);
      assert.equal(s.sourceUpdatedAt, UPDATED);
      assert.ok(Array.isArray(s.services));
    }
  }
});

test("SNAP centers: hours from comments, no phone (left null, never filled in)", () => {
  const sites = normalizeSnap(FX["tc6u-8rnp"], UPDATED);
  assert.equal(sites.length, 3);
  const s = byId(sites, "snap:2011826");
  assert.equal(s.name, "Crotona SNAP Center");
  assert.equal(s.address, "1910 Monterey Avenue, 5th Fl.");
  assert.equal(s.borough, "Bronx");
  assert.equal(s.zip, "10457");
  assert.equal(s.lat, 40.846932);
  assert.equal(s.lon, -73.895099);
  assert.equal(s.hours, "Monday-Friday 8:30am to 5:00pm");
  assert.equal(s.phone, null);
});

test("Homebase: phone, borough 'STATEN IS', which areas it serves; no hours", () => {
  const sites = normalizeHomebase(FX["ntcm-2w4k"], UPDATED);
  assert.equal(sites.length, 2);
  const s = sites[0];
  assert.equal(s.borough, "Staten Island");
  assert.match(s.name, /^Homebase: /);
  assert.ok(s.phone?.tel.startsWith("+1"));
  assert.equal(s.hours, null);
  assert.match(s.note, /^Serves people who live in /);
});

test("Drop-in centers: the street part of 'Street; Borough, NY ZIP', hours from comments", () => {
  const sites = normalizeDropIn(FX["bmxf-3rd4"], UPDATED);
  const living = byId(sites, "dropin:2006002");
  assert.equal(living.address, "800 Barretto Street");
  assert.equal(living.hours, "Open 24 hours");
  assert.equal(living.phone, null);
});

test("Computer centers: day-by-day hours, service flags as tags, temporarily closed flagged", () => {
  const sites = normalizeComputers(FX["sejx-2gn3"], UPDATED);
  const closed = byId(sites, "computers:3337407");
  assert.equal(closed.closed, true);
  assert.equal(closed.address, "4200 7th Avenue", "the borough, ZIP and state after the street are dropped");
  assert.equal(closed.note, "Temporarily closed");
  const lib = byId(sites, "computers:4107201");
  assert.equal(lib.closed, false);
  assert.match(lib.hours, /^Mon 10 AM – 6 PM · Tue 1 PM – 6 PM/);
  assert.ok(lib.services.includes("Borrow a laptop or tablet"));
  assert.equal(lib.provider, "Queens Public Library (QPL)");
  assert.equal(lib.phone.display, "(718) 767-8010");
});

test("DYCD: summer job worksites and youth shelters left out; one site per building, programs as tags", () => {
  const rows = FX["ebkm-iyma"];
  const sites = normalizeYouth(rows, UPDATED);
  assert.ok(rows.some((r) => r.program_area === "SYEP"), "the fixture has a SYEP row");
  assert.ok(rows.some((r) => /Transitional|Crisis/.test(r.program_type)), "and RHY shelter rows");
  assert.equal(sites.length, 2);
  const school = byId(sites, "youth:1005974");
  assert.equal(rows.filter((r) => r.bin === "1005974").length, 3, "three programs share the building");
  assert.deepEqual(school.services.slice(0, 2), ["After-school & summer programs", "School-based community center"], "plain-words program areas first");
  assert.ok(school.services.includes("Grades 6–8"));
  assert.equal(school.phone, null);
  assert.equal(school.hours, null);
  const door = byId(sites, "youth:2001397");
  assert.equal(door.services[0], "Runaway & homeless youth drop-in", "RHY drop-in centers stay");
});

test("NYC Aging: services that come to your home and out-of-city offices left out; one site per building", () => {
  const rows = FX["cqc8-am9x"];
  const sites = normalizeAging(rows, UPDATED);
  assert.ok(rows.some((r) => r.programcity === "WHITE PLAINS"));
  assert.ok(rows.some((r) => r.providertype === "FRIENDLY VISITING CONTRACTS"));
  assert.equal(sites.length, 1);
  const s = sites[0];
  assert.equal(s.id, "older:1064067", "'17 FT. GEORGE HILL' and '17 Fort George Hill' are one building");
  assert.deepEqual(s.services, ["Support for older adults in their building (NORC)", "Case management"]);
  assert.equal(s.hours, "Mon–Fri 9 AM – 5 PM · Sat–Sun Closed");
  assert.equal(s.phone.display, "(212) 304-1064");
});

test("NYCHA: only occupied spaces with a program; NYCHA's own shops and storage left out", () => {
  const rows = FX["crns-fw6u"];
  const sites = normalizeNycha(rows, UPDATED);
  assert.equal(sites.length, 3);
  assert.ok(!sites.some((s) => s.address === "1005 Tinton Avenue"), "vacant left out");
  assert.ok(isNychaRowKept({ status: "Occupied", program_type: "Food Pantry/Storage" }), "a food pantry with storage stays");
  assert.ok(!isNychaRowKept({ status: "Occupied", program_type: "Carpenter Shop and Storage" }));
  assert.ok(!isNychaRowKept({ status: "Occupied", program_type: "TA USE" }));
  assert.ok(!isNychaRowKept({ status: "Vacant", program_type: "Senior Center" }));
  const s = byId(sites, "nycha:2095219");
  assert.equal(s.name, "Highbridge Gardens community space");
  assert.deepEqual(s.services, ["Older adult center"]);
  assert.equal(s.provider, "Presbyterian Senior Services");
  assert.equal(s.hours, null);
  assert.equal(s.phone, null);
});

test("dedupe: the first row's details win, gaps filled from the others, open if any program is", () => {
  const a = { id: "x:1", name: "A", address: "1 Main St", hours: null, phone: null, services: ["one"], closed: true };
  const b = { id: "x:1", name: "B", address: "1 Main St", hours: "9–5", phone: { display: "p", tel: "t" }, services: ["two", "one"], closed: false };
  const [s] = dedupeSites([a, b]);
  assert.equal(s.name, "A");
  assert.equal(s.hours, "9–5");
  assert.deepEqual(s.services, ["one", "two"]);
  assert.equal(s.closed, false);
});

// ---------- Geocoding ----------

test("geocoding: sites with no point are looked up by street address; misses are logged and left out", async () => {
  const sites = [
    { name: "Has point", address: "1 Main St", lat: 40.7, lon: -73.9 },
    { name: "Found", address: "1105 Teller Avenue - community room", borough: "Bronx", zip: "10456", lat: null, lon: null },
    { name: "Lost", address: "99 Nowhere Lane, 2nd Fl", borough: "Queens", zip: null, lat: null, lon: null }
  ];
  const asked = [];
  const resolve = async (parsed) => {
    asked.push(parsed);
    return parsed.text.startsWith("1105")
      ? { status: "resolved", location: { kind: "point", lat: 40.83, lon: -73.91 } }
      : { status: "not-found" };
  };
  const logs = [];
  const { sites: out, failed } = await geocodeMissing(sites, { resolve, log: (m) => logs.push(m), label: "test" });
  assert.deepEqual(out.map((s) => s.name), ["Has point", "Found"]);
  assert.equal(out[1].lat, 40.83);
  assert.deepEqual(failed.map((f) => f.name), ["Lost"]);
  assert.equal(asked[1].text, "99 Nowhere Lane", "the floor after the comma isn't part of the lookup");
  assert.equal(asked[1].borough, "QUEENS");
  assert.match(logs[0], /1 site\(s\) not geocoded: Lost/);
});

test("geocoding: a point far from its own ZIP is checked against its address, in its borough only", async () => {
  const zips = { "10035": [40.7976, -73.9339] };
  const sus = { name: "Homebase: SUS", address: "2322 3rd Ave, 3rd fl", borough: "Manhattan", zip: "10035", lat: 40.7366655, lon: -73.9849393 };
  const near = { name: "Near", address: "1 Ok St", borough: "Manhattan", zip: "10035", lat: 40.798, lon: -73.934 };
  const asked = [];
  const resolve = async (parsed) => { asked.push(parsed); return { status: "resolved", location: { kind: "point", lat: 40.8018, lon: -73.9371 } }; };
  const { sites, moved } = await geocodeMissing([sus, near], { resolve, zips, log: () => {} });
  assert.equal(asked.length, 1, "only the far one is looked up");
  assert.equal(asked[0].text, "2322 3rd Ave");
  assert.equal(asked[0].zip, undefined, "its ZIP might be the typo, so it isn't used");
  assert.equal(sites[0].lat, 40.8018);
  assert.equal(moved[0].name, "Homebase: SUS");

  const { sites: kept } = await geocodeMissing([sus], { resolve: async () => ({ status: "not-found" }), zips, log: () => {} });
  assert.equal(kept[0].lat, 40.7366655, "no match: the city's point stays");
});

test("geocoding: the part of an address GeoSearch can match", () => {
  assert.equal(lookupText("1910 Monterey Avenue, 5th Fl."), "1910 Monterey Avenue");
  assert.equal(lookupText("2972 / 2968 Bronx Park East"), "2972 Bronx Park East");
  assert.equal(lookupText("80 Avenue D / 807 East 6th Street"), "80 Avenue D");
  assert.equal(lookupText("800 Barretto Street; Bronx, NY 10474"), "800 Barretto Street");
});

// ---------- Distances and the list ----------

test("haversine: a degree of latitude is about 69 miles; Empire State to Times Square about 0.6", () => {
  assert.ok(Math.abs(haversineMiles({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 69.09) < 0.01);
  const d = haversineMiles({ lat: 40.748817, lon: -73.985428 }, { lat: 40.758, lon: -73.9855 });
  assert.ok(d > 0.6 && d < 0.67, `got ${d}`);
  assert.equal(haversineMiles({ lat: 40.7, lon: -74 }, { lat: 40.7, lon: -74 }), 0);
  assert.equal(milesText(0.04), "Under 0.1 mi");
  assert.equal(milesText(1.26), "1.3 mi");
});

// A spot and sites at known distances north of it (0.01° latitude ≈ 0.69 mi).
const SPOT = { lat: 40.7, lon: -73.95 };
const at = (id, category, dLat, name = id) => ({ id, category, name, lat: SPOT.lat + dLat, lon: SPOT.lon });

test("byDistance: nearest first, ties by name, sites with no point left out", () => {
  const sorted = byDistance([at("b", "snap", 0.02), at("a", "snap", 0.01, "Zeta"), at("c", "snap", 0.01, "Aardvark"), { id: "x", category: "snap", lat: null, lon: null }], SPOT);
  assert.deepEqual(sorted.map((s) => s.id), ["c", "a", "b"]);
  assert.ok(Math.abs(sorted[1].miles - 0.691) < 0.01);
});

test("selectView: temporarily closed sites after the open ones, and left out of the counts", () => {
  const sorted = byDistance([{ ...at("shut", "snap", 0.001), closed: true }, at("open", "snap", 0.01)], SPOT);
  const v = selectView(sorted, { categories: [], radius: 2 });
  assert.deepEqual(v.list.map((s) => s.id), ["open", "shut"]);
  assert.equal(v.counts.snap, 1);
  assert.equal(summaryText(v, { r: 2 }, "350 5th Avenue"), "1 place within 2 mi of 350 5th Avenue, plus 1 temporarily closed.");
});

test("selectView: nearest per category within the radius, capped, with Show more", () => {
  const sites = [
    ...Array.from({ length: 7 }, (_, i) => at(`o${i}`, "older", 0.001 * (i + 1))),
    at("s1", "snap", 0.005),
    at("s-far", "snap", 0.05) // ~3.5 mi
  ];
  const sorted = byDistance(sites, SPOT);
  const v = selectView(sorted, { categories: [], radius: 2 });
  assert.equal(v.widened, null);
  assert.equal(v.list.length, 6, "5 older-adult sites + 1 SNAP");
  assert.deepEqual(v.list.map((s) => s.id), ["o0", "o1", "o2", "o3", "o4", "s1"], "nearest first; o4 and s1 tie, by name");
  assert.ok(v.more);
  assert.deepEqual(v.moreOf, ["older"]);
  assert.equal(moreText(v), "Show more: Older adults", "only one kind has more: say which");
  assert.equal(moreText({ moreOf: ["older", "snap"] }), "Show more of each kind");
  assert.equal(v.counts.older, 7);
  assert.equal(v.counts.snap, 1);
  assert.equal(v.inRadius.length, 8);
  assert.deepEqual(v.missing.map((m) => m.key).sort(), ["computers", "dropin", "homebase", "nycha", "youth"], "every chosen kind with nothing near");

  const page2 = selectView(sorted, { categories: [], radius: 2, pages: 2 });
  assert.equal(page2.list.length, 8);
  assert.ok(!page2.more);

  const snapOnly = selectView(sorted, { categories: ["snap"], radius: 2 });
  assert.deepEqual(snapOnly.list.map((s) => s.id), ["s1"]);
  assert.deepEqual(snapOnly.missing, []);
});

test("selectView: nothing inside the radius widens to the next one with something, or to the nearest anywhere", () => {
  const sorted = byDistance([at("d1", "dropin", 0.02), at("d2", "dropin", 0.2)], SPOT); // ~1.4 mi, ~13.8 mi
  const v = selectView(sorted, { categories: ["dropin"], radius: 0.5 });
  assert.equal(v.widened, "radius");
  assert.equal(v.radius, 2);
  assert.deepEqual(v.list.map((s) => s.id), ["d1"]);

  const far = byDistance([at("d2", "dropin", 0.2)], SPOT);
  const w = selectView(far, { categories: ["dropin"], radius: 2 });
  assert.equal(w.widened, "anywhere");
  assert.deepEqual(w.list.map((s) => s.id), ["d2"]);
  assert.equal(w.counts.dropin, 0);

  const none = selectView([], { categories: ["dropin"], radius: 2 });
  assert.equal(none.widened, null);
  assert.deepEqual(none.list, []);
  assert.deepEqual(none.missing, [{ key: "dropin", miles: null }]);
});

test("sitesNear: everything within 2 mi, plus the nearest few of a category with none that close", () => {
  const sites = [at("o1", "older", 0.01), at("d1", "dropin", 0.2), at("d2", "dropin", 0.3), at("d3", "dropin", 0.4), at("d4", "dropin", 0.5), at("o-far", "older", 0.3)];
  const near = sitesNear(sites, SPOT);
  assert.deepEqual(near.map((s) => s.id), ["o1", "d1", "d2", "d3"], "older has one close, so its far one stays home; three nearest drop-ins");
  // ~3.5 mi used to be inside the widest radius; now it's only sent as a far one.
  const mid = sitesNear([at("o1", "older", 0.01), at("o-mid", "older", 0.05)], SPOT);
  assert.ok(!mid.some((s) => s.id === "o-mid"));
});

test("sitesInBorough: by the borough field, or the ZIP's when it's blank, A to Z, no distances", () => {
  const sites = [
    { ...at("b", "snap", 0), name: "Bronx Works", borough: "Bronx", zip: "10457" },
    { ...at("a", "older", 0), name: "Aging Center", borough: null, zip: "10451" },
    { ...at("k", "snap", 0), name: "Brooklyn Site", borough: "Brooklyn", zip: "11217" },
    { ...at("n", "snap", 0), name: "No Point", borough: "Bronx", lat: null, lon: null }
  ];
  const bronx = sitesInBorough(sites, "Bronx");
  assert.deepEqual(bronx.map((s) => s.id), ["a", "b"]);
  assert.ok(bronx.every((s) => s.miles === undefined));

  const v = selectView(bronx, { categories: [], radius: null });
  assert.equal(v.widened, null);
  assert.equal(v.radius, null);
  assert.deepEqual(v.list.map((s) => s.id), ["a", "b"], "every site counts, by name");
  assert.equal(v.counts.snap, 1);
  assert.equal(v.inRadius.length, 2);
  const q = { boro: "bronx", r: 2 };
  assert.equal(summaryText(v, q, ""), "2 places in the Bronx.");
  assert.equal(missingNotes(v, q).find((n) => n.key === "dropin").text, "No Drop-In Centers listed in the Bronx.");
  assert.equal(radiusNote(v, q), null);
  assert.equal(chipLabel("Older Adults", 1, q), "Older Adults: 1 place in the Bronx");
  assert.equal(chipLabel("Older Adults", 3, {}), "Older Adults: 3 places nearby");
  assert.doesNotMatch(cardHtml({ ...bronx[0], services: [] }), /hn-dist/, "no distance on a borough card");

  const many = sitesInBorough(Array.from({ length: 7 }, (_, i) => ({ ...at(`o${i}`, "older", 0), name: `Center ${i}`, borough: "Bronx" })), "Bronx");
  const page1 = selectView(many, { categories: [], radius: null });
  assert.equal(page1.list.length, 5);
  assert.equal(summaryText(page1, q, ""), "7 places in the Bronx. Showing a few of each kind first, A to Z.");
});

// ---------- Page state ----------

test("URL: spot rounded and kept in NYC, radius from the list, categories validated", () => {
  const q = normalizeQuery(new URLSearchParams("lat=40.84693&lon=-73.89509&r=1&cat=snap,older,bogus"));
  assert.deepEqual(q, { lat: 40.847, lon: -73.895, boro: null, r: 1, cats: ["snap", "older"] });
  assert.equal(queryToParams(q).toString(), "lat=40.847&lon=-73.895&r=1&cat=snap%2Colder");
  assert.deepEqual(normalizeQuery(new URLSearchParams("lat=34&lon=-118&r=3")), { lat: null, lon: null, boro: null, r: 2, cats: [] });
  assert.equal(normalizeQuery(new URLSearchParams("lat=40.847&lon=-73.895&r=5")).r, 2, "5 mi is gone: an old link gets the default");
  assert.equal(queryToParams(normalizeQuery(new URLSearchParams(""))).toString(), "");
});

test("URL: a borough instead of a spot, never both", () => {
  const b = normalizeQuery(new URLSearchParams("boro=staten-island&lat=40.847&lon=-73.895&r=1&cat=snap"));
  assert.deepEqual(b, { lat: null, lon: null, boro: "staten-island", r: 1, cats: ["snap"] });
  assert.equal(queryToParams(b).toString(), "boro=staten-island&cat=snap", "no radius for a borough");
  assert.equal(searchKey(b), "boro=staten-island");
  assert.equal(normalizeQuery(new URLSearchParams("boro=jersey")).boro, null);
  const p = pointQuery(b, 40.84693, -73.89509);
  assert.equal(p.boro, null);
  assert.equal(searchKey(p), "lat=40.847&lon=-73.895");
  assert.deepEqual(boroughQuery(p, "bronx"), { ...p, lat: null, lon: null, boro: "bronx" });
  assert.equal(searchKey({ lat: null, lon: null, boro: null }), "");
});

test("in the city: the outline, not the box, so New Jersey and Nassau are out", () => {
  const inside = {
    "Times Square": [40.758, -73.9855], "Battery Park": [40.7033, -74.017], "Chelsea Piers": [40.7466, -74.009],
    "Roosevelt Island": [40.7614, -73.951], "Riverdale": [40.89, -73.912], "City Island": [40.8468, -73.7868],
    "Glen Oaks": [40.747, -73.711], "Rosedale": [40.662, -73.735], "Far Rockaway": [40.605, -73.755],
    "Tottenville": [40.509, -74.24]
  };
  const outside = {
    "Jersey City": [40.7178, -74.0431], "Hoboken": [40.744, -74.0324], "Fort Lee": [40.8509, -73.9701],
    "Bayonne": [40.6687, -74.1143], "Valley Stream": [40.6643, -73.7085], "Floral Park": [40.7237, -73.7051],
    "Great Neck": [40.8007, -73.7285], "Yonkers": [40.9312, -73.8988], "Los Angeles": [34, -118]
  };
  for (const [name, [lat, lon]] of Object.entries(inside)) assert.ok(inCityLimits(lat, lon), name);
  for (const [name, [lat, lon]] of Object.entries(outside)) assert.ok(!inCityLimits(lat, lon), name);
  assert.deepEqual(normalizeQuery(new URLSearchParams("lat=40.7178&lon=-74.0431")), { lat: null, lon: null, boro: null, r: 2, cats: [] }, "Jersey City in the URL");
});

test("chips: 'All' clears; toggling every kind on, or the last one off, is 'All' again", () => {
  assert.deepEqual(toggleCategory(["snap"], "all"), []);
  assert.deepEqual(toggleCategory([], "older"), ["older"]);
  assert.deepEqual(toggleCategory(["older"], "snap"), ["snap", "older"], "kept in chip order");
  assert.deepEqual(toggleCategory(["older"], "older"), []);
  const allButOne = CATEGORIES.map((c) => c.key).filter((k) => k !== "nycha");
  assert.deepEqual(toggleCategory(allButOne, "nycha"), []);
});

test("words: summary, widening and how far the nearest missing kind is", () => {
  const sorted = byDistance([at("d1", "dropin", 0.02), at("s1", "snap", 0.001)], SPOT);
  const v = selectView(sorted, { categories: [], radius: 0.5 });
  assert.equal(summaryText(v, { r: 0.5 }, "350 5th Avenue"), "1 place within ½ mi of 350 5th Avenue.");
  const notes = missingNotes(v);
  const drop = notes.find((n) => n.key === "dropin");
  assert.equal(drop.text, "No Drop-In Centers within ½ mi. The nearest is 1.4 mi away.");
  assert.equal(radiusFor(drop.miles), 2);
  assert.equal(radiusFor(12), null);

  const widened = selectView(sorted, { categories: ["dropin"], radius: 0.5 });
  assert.equal(summaryText(widened, { r: 0.5 }, ""), "Nothing within ½ mi, so we looked farther: 1 place within 2 mi of the spot you picked.");
});

test("words: the note by the radius buttons when the list is for another radius", () => {
  const sorted = byDistance([at("d1", "dropin", 0.02), at("d2", "dropin", 0.2)], SPOT); // ~1.4 mi, ~13.8 mi
  assert.equal(radiusNote(selectView(sorted, { categories: ["dropin"], radius: 2 }), { r: 2 }), null);
  assert.equal(radiusNote(selectView(sorted, { categories: ["dropin"], radius: 0.5 }), { r: 0.5 }), "Nothing within ½ mi, so showing 2 mi");
  const far = byDistance([at("d2", "dropin", 0.2)], SPOT);
  assert.equal(radiusNote(selectView(far, { categories: ["dropin"], radius: 1 }), { r: 1 }), "Nothing within 2 mi, so showing the nearest anywhere");
});

test("words: a short label mid-sentence keeps its acronyms", () => {
  assert.equal(lowerFirst("Drop-in centers"), "drop-in centers");
  assert.equal(lowerFirst("NYCHA community centers"), "NYCHA community centers");
});

test("card: hours and phone fall back to plain words; tap-to-call and directions links", () => {
  const [s] = byDistance(normalizeSnap(FX["tc6u-8rnp"], UPDATED).slice(0, 1), SPOT);
  const html = cardHtml(s);
  assert.match(html, /Monday-Friday 8:30am to 5:00pm/);
  assert.match(html, /No phone listed/);
  assert.match(html, /google\.com\/maps\/dir\/\?api=1&#38;destination=1910%20Monterey%20Avenue/);
  const [h] = byDistance(normalizeHomebase(FX["ntcm-2w4k"], UPDATED).slice(0, 1), SPOT);
  const hHtml = cardHtml(h);
  assert.match(hHtml, new RegExp(HOURS_MISSING.replace("/", "\\/")));
  assert.match(hHtml, /href="tel:\+1\d{10}"/);
  assert.equal(directionsUrl({ address: null, lat: 40.1, lon: -73.9 }), "https://www.google.com/maps/dir/?api=1&destination=40.1%2C-73.9");
  assert.doesNotMatch(cardHtml({ ...s, name: "<b>x</b>" }), /<b>x<\/b>/, "data is escaped");
});
