/*
 * Park Amenities Near Me logic: centroids, cleaning each dataset's rows into
 * one shape (on real rows, tests/fixtures/park-amenities.json), distances,
 * what the page shows, and the page script's URL and wording.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CATEGORIES, CATEGORY_KEYS, categoryOf, boroughName, DEFAULT_RADIUS } from "../src/lib/park-amenities/config.js";
import { centroid, normalizeRows, parkNameIndex } from "../src/lib/park-amenities/normalize.js";
import { byDistance, amenitiesNear, selectView, pagesFor, haversineMiles, milesPast, seasonOf, seasonOutdated } from "../src/lib/park-amenities/nearby.js";
import {
  normalizeQuery, queryToParams, pointQuery, searchKey, toggleCategory, summaryText, nearestText, emptyText, PARKS_ONLY
} from "../src/lib/park-amenities/page-state.js";
import { cardHtml, popupHtml, nearestHtml, directionsUrl, placeText } from "../src/lib/park-amenities/render.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/park-amenities.json", import.meta.url)));
const UPDATED = "2026-10-15";
const parkNames = parkNameIndex(FX["enfh-gkve"]);
const all = Object.fromEntries(CATEGORIES.map((c) => [c.key, normalizeRows(c, FX[c.datasetId], { parkNames, updatedAt: UPDATED })]));
const byId = (list, id) => list.find((a) => a.id === id);

// ---------- Geometry ----------

test("centroid: a point as it is, a square at its middle, either winding", () => {
  assert.deepEqual(centroid({ type: "Point", coordinates: [-73.97332, 40.745147] }), { lat: 40.745147, lon: -73.97332 });
  const square = [[-74, 40], [-73.99, 40], [-73.99, 40.01], [-74, 40.01], [-74, 40]];
  assert.deepEqual(centroid({ type: "Polygon", coordinates: [square] }), { lat: 40.005, lon: -73.995 });
  assert.deepEqual(centroid({ type: "Polygon", coordinates: [[...square].reverse()] }), { lat: 40.005, lon: -73.995 });
});

test("centroid: a multipolygon weighs its parts by area, and a hole pulls the middle away", () => {
  const big = [[0, 0], [3, 0], [3, 1], [0, 1], [0, 0]];       // area 3, middle (1.5, 0.5)
  const small = [[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]]; // area 1, middle (10.5, 0.5)
  const c = centroid({ type: "MultiPolygon", coordinates: [[big], [small]] });
  assert.equal(c.lon, 3.75); // (1.5·3 + 10.5·1) / 4
  assert.equal(c.lat, 0.5);
  // A 2×2 square with a 1×1 hole in its right half: the middle moves left.
  const outer = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const hole = [[1, 0.5], [2, 0.5], [2, 1.5], [1, 1.5], [1, 0.5]];
  const h = centroid({ type: "Polygon", coordinates: [outer, hole] });
  assert.ok(h.lon < 1 && Math.abs(h.lat - 1) < 1e-9);
});

test("centroid: no shape, an empty one, or a flat sliver", () => {
  assert.equal(centroid(null), null);
  assert.equal(centroid({ type: "MultiPolygon", coordinates: [] }), null);
  assert.equal(centroid({ type: "LineString", coordinates: [[0, 0], [1, 1]] }), null);
  assert.deepEqual(centroid({ type: "Polygon", coordinates: [[[-74, 40], [-73.98, 40], [-74, 40]]] }), { lat: 40, lon: -73.993333 });
});

// ---------- Normalizing real rows ----------

test("every amenity has the one shape, a point in the city, and its source", () => {
  for (const c of CATEGORIES) {
    assert.ok(all[c.key].length > 0, c.key);
    for (const a of all[c.key]) {
      assert.deepEqual(Object.keys(a), ["id", "category", "name", "parkName", "borough", "lat", "lon", "details", "sourceDataset", "sourceLastUpdated"]);
      assert.equal(a.category, c.key);
      assert.ok(a.id.startsWith(`${c.key}:`));
      assert.ok(a.lat > 40.4 && a.lat < 41 && a.lon > -74.3 && a.lon < -73.6, a.id);
      assert.equal(a.sourceDataset, c.datasetId);
      assert.equal(a.sourceLastUpdated, UPDATED);
    }
  }
});

test("playgrounds: a multipolygon becomes its centroid; the park name comes from Parks Properties", () => {
  const p = byId(all.playground, "playground:DCA-1080");
  assert.equal(p.name, "Midland Playground");
  assert.equal(p.parkName, "Franklin D. Roosevelt Boardwalk and Beach");
  assert.equal(p.borough, "Staten Island");
  // Inside the shape's bounding box.
  const pts = FX["j55h-3upk"].find((r) => r.system === "DCA-1080").shape.coordinates.flat(2);
  assert.ok(p.lon >= Math.min(...pts.map((x) => x[0])) && p.lon <= Math.max(...pts.map((x) => x[0])));
  assert.ok(p.lat >= Math.min(...pts.map((x) => x[1])) && p.lat <= Math.max(...pts.map((x) => x[1])));
  // An id Parks Properties doesn't have: no park name, nothing made up.
  assert.equal(byId(all.playground, "playground:DCA-0750").parkName, null);
});

test("dog runs: details from the row; a run with no id or park id keeps a point id", () => {
  const cooper = byId(all.dog, "dog:B025-DOGAREA0005");
  assert.equal(cooper.parkName, "Cooper Park");
  assert.deepEqual(categoryOf("dog").lines(cooper.details), ["Sand surface", "Has seating"]);
  const thames = all.dog.find((a) => a.name === "West Thames Street Dog Run");
  assert.match(thames.id, /^dog:40\.\d+,-74\.\d+$/);
  assert.equal(thames.parkName, null);
});

test("fountains: sinks left out; bottle fillers, dog bowls, two heights and indoor ones read from the type", () => {
  const ids = all.fountain.map((a) => a.id);
  assert.ok(!ids.includes("fountain:X307-DF0586")); // Food Prep Sink
  assert.equal(ids.length, FX["qnv7-p7a2"].length - 1);

  const filler = byId(all.fountain, "fountain:X182-DF0493");
  assert.equal(filler.name, `Bottle filler at ${filler.parkName}`); // named after its park, so a list of them differs
  assert.ok(filler.details.bottleFiller && !filler.details.indoor);
  assert.ok(categoryOf("fountain").seasonal(filler.details));

  const indoor = byId(all.fountain, "fountain:X307-DF0575");
  assert.equal(indoor.name, `Drinking fountain at ${indoor.parkName}`);
  assert.equal(indoor.parkName, FX["qnv7-p7a2"].find((r) => r.system === "X307-DF0575").propertyna); // the fountains name their own park
  assert.ok(indoor.details.indoor);
  assert.equal(categoryOf("fountain").seasonal(indoor.details), false);
  assert.ok(categoryOf("fountain").lines(indoor.details).includes("Indoors"));

  const dog = byId(all.fountain, "fountain:B055-DF1007");
  assert.ok(dog.details.dogBowl);
  assert.ok(categoryOf("fountain").lines(dog.details).includes("Dog bowl"));

  const highLow = byId(all.fountain, "fountain:R035-DF0177");
  assert.ok(highLow.details.twoHeights && highLow.details.bottleFiller);
});

test("pools: indoor or outdoor and the size; only outdoor ones are seasonal", () => {
  const chelsea = byId(all.pool, "pool:M260-POOL-0032");
  assert.equal(chelsea.parkName, "Chelsea Recreation Center");
  assert.ok(chelsea.details.indoor);
  assert.equal(categoryOf("pool").seasonal(chelsea.details), false);
  assert.equal(categoryOf("pool").lines(chelsea.details)[0], "Indoor");

  const totten = byId(all.pool, "pool:Q458-POOL-0015");
  assert.deepEqual(categoryOf("pool").lines(totten.details), ["Outdoor", "Intermediate and diving pool"]);
  assert.ok(categoryOf("pool").seasonal(totten.details));
});

test("rows with no shape, outside the city, or repeated are left out", () => {
  const pool = categoryOf("pool");
  const row = FX["y5rm-wagw"][0];
  const out = normalizeRows(pool, [row, row, { ...row, system: "NOWHERE", polygon: null }, { ...row, system: "NJ", polygon: { type: "Point", coordinates: [-74.07, 40.72] } }]);
  assert.deepEqual(out.map((a) => a.id), [`pool:${row.system}`]);
});

test("borough letters", () => {
  assert.equal(boroughName("X"), "Bronx");
  assert.equal(boroughName("r"), "Staten Island");
  assert.equal(boroughName(""), null);
});

// ---------- Distances and the view ----------

const SPOT = { lat: 40.7484, lon: -73.9857 }; // 350 5th Avenue
const at = (category, id, miles) => {
  // A point `miles` due north of the spot.
  const lat = SPOT.lat + miles / 69.05;
  return { id: `${category}:${id}`, category, name: id, parkName: null, borough: "Manhattan", lat, lon: SPOT.lon, details: {} };
};

test("amenitiesNear: everything within 1 mi, plus the nearest one of a kind with none that close", () => {
  const list = [at("fountain", "f1", 0.2), at("fountain", "f2", 0.7), at("fountain", "f3", 1.5), at("pool", "p1", 2.5), at("pool", "p2", 3), at("dog", "d1", 0.9)];
  const near = amenitiesNear(list, SPOT);
  assert.deepEqual(near.map((a) => a.id), ["fountain:f1", "fountain:f2", "dog:d1", "pool:p1"]);
  assert.ok(Math.abs(near[0].miles - 0.2) < 0.005);
  assert.ok(Math.abs(haversineMiles(SPOT, list[4]) - 3) < 0.01);
});

test("selectView: the radius, the chosen kinds, the nearest of each, paging", () => {
  const sorted = byDistance([at("fountain", "f1", 0.1), at("fountain", "f2", 0.3), at("playground", "g1", 0.4), at("pool", "p1", 0.8), at("dog", "d1", 2)], SPOT);
  const v = selectView(sorted, { categories: [...CATEGORY_KEYS], radius: 0.5 });
  assert.deepEqual(v.list.map((a) => a.id), ["fountain:f1", "fountain:f2", "playground:g1"]);
  assert.deepEqual(v.counts, { playground: 1, dog: 0, fountain: 2, pool: 0 });
  assert.deepEqual(v.nearest.map((n) => [n.key, n.amenity?.id, n.inRadius]), [
    ["playground", "playground:g1", true], ["dog", "dog:d1", false], ["fountain", "fountain:f1", true], ["pool", "pool:p1", false]
  ]);
  assert.equal(v.widenTo, null);

  const pools = selectView(sorted, { categories: ["pool"], radius: 0.5 });
  assert.deepEqual(pools.list, []);
  assert.equal(pools.widenTo, 1); // the pool at 0.8 mi
  assert.equal(selectView(sorted, { categories: ["dog"], radius: 0.5 }).widenTo, null); // 2 mi: past the widest

  // The nearest of each kind first: a lot of fountains don't push the playground and pool out.
  const crowd = byDistance([...Array.from({ length: 5 }, (_, i) => at("fountain", `f${i}`, 0.05 * (i + 1))), at("playground", "g1", 0.4), at("pool", "p1", 0.8)], SPOT);
  const paged = selectView(crowd, { categories: [...CATEGORY_KEYS], radius: 1, perCategory: 2 });
  assert.deepEqual(paged.list.map((a) => a.id), ["fountain:f0", "fountain:f1", "playground:g1", "pool:p1"]);
  assert.ok(paged.more);
  assert.equal(pagesFor(paged, "fountain:f4", 2), 3);
  assert.equal(pagesFor(paged, "pool:p1", 2), 1);
  assert.equal(pagesFor(paged, "dog:d1", 2), null);
  const q = { lat: 1, lon: 1, r: 1, cats: [...CATEGORY_KEYS] };
  assert.equal(summaryText(paged, q, ""), "7 amenities within 1 mi of the spot you picked. Showing the nearest of each kind first.");
  assert.equal(selectView(crowd, { categories: [...CATEGORY_KEYS], radius: 1, perCategory: 2, pages: 3 }).more, false);

  const none = selectView(sorted, { categories: [], radius: 0.5 });
  assert.deepEqual([none.list, none.nearest, none.widenTo], [[], [], null]);
});

// ---------- URL and wording ----------

test("URL: defaults left out; a spot outside the city or a bad radius ignored; categories in chip order", () => {
  const q = normalizeQuery(new URLSearchParams("lat=40.74843&lon=-73.98566"));
  assert.deepEqual(q, { lat: 40.748, lon: -73.986, r: DEFAULT_RADIUS, cats: CATEGORY_KEYS });
  assert.equal(queryToParams(q).toString(), "lat=40.748&lon=-73.986");
  assert.equal(searchKey(q), "lat=40.748&lon=-73.986");

  const some = normalizeQuery(new URLSearchParams("lat=40.74&lon=-73.98&r=1&cat=pool,dog,bogus,pool"));
  assert.deepEqual(some.cats, ["dog", "pool"]);
  assert.equal(queryToParams(some).toString(), "lat=40.74&lon=-73.98&r=1&cat=dog%2Cpool");

  assert.deepEqual(normalizeQuery(new URLSearchParams("cat=")).cats, []);
  assert.equal(queryToParams({ lat: null, lon: null, r: 0.5, cats: [] }).toString(), "cat=");
  assert.equal(normalizeQuery(new URLSearchParams("lat=40.72&lon=-74.07")).lat, null); // Jersey City
  assert.equal(normalizeQuery(new URLSearchParams("r=5")).r, DEFAULT_RADIUS);
  assert.equal(searchKey(normalizeQuery(new URLSearchParams(""))), "");
  assert.deepEqual(pointQuery(q, 40.70001, -73.9), { ...q, lat: 40.7, lon: -73.9 });
});

test("chips toggle, down to none", () => {
  assert.deepEqual(toggleCategory(CATEGORY_KEYS, "dog"), ["playground", "fountain", "pool"]);
  assert.deepEqual(toggleCategory(["pool"], "playground"), ["playground", "pool"]);
  assert.deepEqual(toggleCategory(["pool"], "pool"), []);
});

test("wording: the summary, the nearest cards and the empty list", () => {
  const sorted = byDistance([at("fountain", "f1", 0.1), at("pool", "p1", 0.8)], SPOT);
  const q = { lat: 1, lon: 1, r: 0.5, cats: [...CATEGORY_KEYS] };
  const v = selectView(sorted, { categories: q.cats, radius: 0.5 });
  assert.equal(summaryText(v, q, "350 5th Avenue"), "1 amenity within ½ mi of 350 5th Avenue, nearest first.");
  assert.equal(summaryText(v, q, ""), "1 amenity within ½ mi of the spot you picked, nearest first.");

  const [playground, , fountain, pool] = v.nearest;
  assert.deepEqual(nearestText(fountain, 0.5), { head: "Water fountain", dist: "0.1 mi", note: null });
  assert.deepEqual(nearestText(pool, 0.5), { head: "Pool", dist: "0.8 mi", note: "Outside ½ mi" });
  assert.deepEqual(nearestText(playground, 0.5), { head: "Playground", dist: "None listed", note: null });

  const pq = { ...q, cats: ["pool"] };
  const pv = selectView(sorted, { categories: pq.cats, radius: 0.5 });
  assert.equal(summaryText(pv, pq, ""), "Nothing within ½ mi of the spot you picked.");
  assert.deepEqual(emptyText(pv, pq), { text: "No pools within ½ mi. The nearest is 0.8 mi away.", note: PARKS_ONLY, widen: 1 });
  assert.match(PARKS_ONLY, /run by NYC Parks only/);
  const dq = { ...q, r: 1, cats: ["dog", "playground"] };
  assert.deepEqual(emptyText(selectView(sorted, { categories: dq.cats, radius: 1 }), dq), { text: "No playgrounds or dog runs within 1 mi.", note: PARKS_ONLY, widen: null });
  // No kinds picked: only the summary asks for one.
  const none = selectView(sorted, { categories: [], radius: 0.5 });
  assert.equal(summaryText(none, { ...q, cats: [] }, ""), "Pick at least one kind of amenity above.");
  assert.equal(emptyText(none, { ...q, cats: [] }), null);
});

// ---------- Cards ----------

const JULY = new Date("2026-07-15T12:00:00-04:00"), NOV = new Date("2026-11-02T12:00:00-05:00");

test("cards: distance, park, details, the season note only where it applies, directions to the point", () => {
  const [filler] = byDistance([byId(all.fountain, "fountain:X182-DF0493")], SPOT);
  const html = cardHtml(filler, JULY);
  assert.match(html, />Bottle filler at Millbrook Playground</);
  assert.match(html, /<p class="hn-addr">Bronx<\/p>/); // the park's in the name, so not again
  assert.match(html, /aria-label="Bottle filler at Millbrook Playground, \d+\.\d mi, Fills bottles: show on map"/);
  assert.match(html, /data-season="on">Outdoor fountain: usually on in the warmer months\. Check <a href="https:\/\/www\.nycgovparks\.org\/"[^>]*>NYC Parks<\/a> for current status\./);
  assert.match(html, new RegExp(`destination=${filler.lat},${filler.lon}`));
  assert.match(popupHtml(filler, NOV), /data-season="maybe">Outdoor fountains are turned off/);

  const [chelsea] = byDistance([byId(all.pool, "pool:M260-POOL-0032")], SPOT);
  assert.doesNotMatch(cardHtml(chelsea, NOV), /seasonal/i); // indoor
  assert.match(cardHtml(chelsea), /Chelsea Recreation Center, Manhattan/);
  const [playground] = byDistance([byId(all.playground, "playground:DCA-1001")], SPOT);
  assert.doesNotMatch(cardHtml(playground, NOV), /seasonal/i);
  // A playground's spot in its park is its place line, not a tag.
  const where = playground.details.where;
  assert.ok(where);
  assert.match(cardHtml(playground), new RegExp(`<p class="hn-addr">${where.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, `));
  assert.doesNotMatch(cardHtml(playground), /hn-tags/);
  // A park named like the amenity isn't said twice.
  assert.equal(placeText(byId(all.pool, "pool:X236-POOL-0027")), "Mapes Pool, Bronx"); // Mapes Wading Pool
  assert.equal(placeText({ name: "Stop & Go Playground", parkName: "Stop & Go Playground", borough: "Bronx" }), "Bronx");
  assert.equal(directionsUrl({ lat: 40.1, lon: -73.9 }), "https://www.google.com/maps/dir/?api=1&destination=40.1,-73.9");
});

test("cards escape what the data says", () => {
  const a = { ...at("dog", "x", 0.1), name: `<img src=x onerror="1">`, parkName: "A & B", miles: 0.1 };
  const html = cardHtml(a) + popupHtml(a) + nearestHtml({ key: "dog", amenity: a, inRadius: true }, 0.5);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /A &#38; B/);
});

test("nearest cards: a button that shows it on the map, in the radius or outside it; plain when none", () => {
  const [p] = byDistance([at("pool", "p1", 0.8)], SPOT);
  assert.match(nearestHtml({ key: "pool", amenity: p, inRadius: true }, 1), /^<li><button[^>]*data-locate="pool:p1"/);
  assert.match(nearestHtml({ key: "pool", amenity: p, inRadius: false }, 0.5), /^<li><button[^>]*data-locate="pool:p1"[^>]*aria-label="[^"]*outside your radius\. Show on map"/);
  assert.match(nearestHtml({ key: "pool", amenity: null, inRadius: false }, 0.5), /^<li><span[^>]*>.*None listed/);
});

test("season: outdoor pools and fountains by the New York date; indoor ones never", () => {
  const pool = byId(all.pool, "pool:Q458-POOL-0015"); // outdoor
  const fountain = byId(all.fountain, "fountain:X182-DF0493"); // outdoor
  const day = (iso) => new Date(`${iso}T12:00:00Z`);
  assert.equal(seasonOf(pool, day("2026-07-15")).state, "on");
  assert.equal(seasonOf(pool, day("2026-09-16")).state, "maybe");
  assert.equal(seasonOf(pool, day("2026-11-02")).state, "off");
  assert.equal(seasonOf(pool, day("2026-11-02")).short, "Closed for the season");
  assert.equal(seasonOf(pool, day("2026-07-15")).short, null);
  assert.equal(seasonOf(fountain, day("2026-11-02")).state, "maybe");
  assert.equal(seasonOf(fountain, day("2027-01-20")).state, "off");
  assert.equal(seasonOf(fountain, day("2026-05-10")).state, "maybe");
  // 1 a.m. UTC on Sept 14 is still Sept 13 in New York: the pool season's last day.
  assert.equal(seasonOf(pool, new Date("2026-09-14T01:00:00Z")).state, "on");
  // Another year: the usual season (July to Labor Day for sure), not 2026's dates.
  assert.equal(seasonOf(pool, day("2026-06-28")).state, "on");
  assert.equal(seasonOf(pool, day("2027-06-28")).state, "maybe");
  assert.equal(seasonOf(pool, day("2027-07-15")).state, "on");
  assert.equal(seasonOf(pool, day("2027-09-10")).state, "maybe");
  assert.equal(seasonOutdated(categoryOf("pool"), day("2026-12-31")), false);
  assert.equal(seasonOutdated(categoryOf("pool"), day("2027-01-02")), true);
  assert.equal(seasonOutdated(categoryOf("fountain"), day("2030-01-02")), false); // no published dates to update
  assert.equal(seasonOf(byId(all.pool, "pool:M260-POOL-0032"), day("2026-11-02")), null); // indoor
  assert.equal(seasonOf(byId(all.playground, "playground:DCA-1001"), day("2026-11-02")), null);
});

test("nearest card: an outdoor pool out of season says it's closed", () => {
  const [p] = byDistance([byId(all.pool, "pool:Q458-POOL-0015")], SPOT);
  const off = nearestHtml({ key: "pool", amenity: p, inRadius: false }, 1, NOV);
  assert.match(off, /<span class="pa-near-note" data-season="off">Closed for the season<\/span>/);
  assert.match(off, /aria-label="Nearest pool: [^"]+, closed for the season, outside your radius/);
  assert.doesNotMatch(nearestHtml({ key: "pool", amenity: p, inRadius: false }, 1, JULY), /Closed for the season/);
  assert.match(cardHtml(p, NOV), /data-season="off">Closed for the season\. NYC Parks outdoor pools usually open in late June\./);
});

test("a distance past the radius never reads as inside it", () => {
  assert.equal(milesPast(0.51, 0.5), "0.51 mi");
  assert.equal(milesPast(0.5001, 0.5), "0.51 mi");
  assert.equal(milesPast(1.038, 1), "1.04 mi");
  assert.equal(milesPast(0.56, 0.5), "0.6 mi"); // already reads as past it
  assert.equal(milesPast(2.5, 1), "2.5 mi");

  const sorted = byDistance([at("fountain", "f1", 0.51)], SPOT);
  const q = { lat: 1, lon: 1, r: 0.5, cats: [...CATEGORY_KEYS] };
  const v = selectView(sorted, { categories: q.cats, radius: 0.5 });
  const fountain = v.nearest.find((n) => n.key === "fountain");
  assert.deepEqual(nearestText(fountain, 0.5), { head: "Water fountain", dist: "0.51 mi", note: "Outside ½ mi" });
  assert.equal(emptyText(v, q).text, "No park amenities within ½ mi. The nearest is 0.51 mi away.");
  assert.match(nearestHtml(fountain, 0.5), /, 0\.51 mi, outside your radius/);
});

test("fountains a few metres apart in one park are one spot; indoor and outdoor ones, or other parks, stay apart", () => {
  const fountain = categoryOf("fountain");
  const row = (system, lon, extra = {}) => ({
    system, fountainty: "A", position: "Out in Open", propertyna: "Some Park", borough: "M",
    the_geom: { type: "Point", coordinates: [lon, 40.75] }, ...extra
  });
  const out = normalizeRows(fountain, [
    row("F1", -73.98),
    row("F2", -73.98003, { fountainty: "Bottle Filler" }),          // ~2.5 m east
    row("F3", -73.98003, { position: "Indoor" }),                    // same spot, indoors
    row("F4", -73.98, { propertyna: "Other Park" }),                 // same spot, another park
    row("F5", -73.9801)                                              // ~8 m west
  ]);
  assert.deepEqual(out.map((a) => a.id), ["fountain:F1", "fountain:F3", "fountain:F4", "fountain:F5"]);
  const f1 = out[0];
  assert.equal(f1.details.count, 2);
  assert.ok(f1.details.bottleFiller);
  assert.ok(fountain.lines(f1.details).includes("2 fountains together"));
});
