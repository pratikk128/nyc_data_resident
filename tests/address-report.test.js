/*
 * The address report (/address/): the URL spot, the links into each
 * dashboard, what each card picks from its dashboard's API, and the cards'
 * wording.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  spotFromParams, spotToParams, dashboardLinks, complaintsCard, closuresCard, helpCard, nearestStation, restaurantsCard, nearestSchools, milesText
} from "../src/lib/address-report/report.js";
import {
  complaintsHtml, closuresHtml, helpHtml, schoolsHtml, restaurantsHtml, waterHtml
} from "../src/lib/address-report/render.js";

const TODAY = "2026-10-30"; // a Friday
const EMPIRE = { lat: 40.748, lon: -73.986 };
const qs = (s) => new URLSearchParams(s);

// ---------- URL ----------

test("spot: rounded to about a block, and only inside the city", () => {
  assert.deepEqual(spotFromParams(qs("lat=40.74844&lon=-73.98566")), { lat: 40.748, lon: -73.986 });
  assert.equal(spotFromParams(qs("lat=40.7178&lon=-74.0431")), null); // Jersey City
  assert.equal(spotFromParams(qs("lat=abc&lon=-73.98")), null);
  assert.equal(spotFromParams(qs("")), null);
  assert.equal(spotToParams({ lat: 40.74844, lon: -73.98566 }).toString(), "lat=40.748&lon=-73.986");
});

test("links: each dashboard opens on the same spot", () => {
  const links = dashboardLinks(EMPIRE, { waterSite: "1S03B" });
  assert.equal(links.complaints, "/311-complaints/?lat=40.748&lon=-73.986&area=immediate");
  assert.equal(links.closures, "/street-closures/?lat=40.748&lon=-73.986&r=0.25");
  assert.equal(links.help, "/help-near-me/?lat=40.748&lon=-73.986");
  assert.equal(links.water, "/drinking-water/near-me?lat=40.748&lon=-73.986&sites=1S03B");
  assert.equal(dashboardLinks(EMPIRE).water, "/drinking-water/near-me?lat=40.748&lon=-73.986");
});

// ---------- 311 ----------

test("311: total, top three types, share still open", () => {
  const c = complaintsCard({ total: 100, types: { "NOISE - RESIDENTIAL": 50, "HEAT/HOT WATER": 30, "ILLEGAL PARKING": 15, "RODENT": 5 }, status: { open: 25, closed: 75 } });
  assert.equal(c.total, 100);
  assert.deepEqual(c.top.map((t) => t.count), [50, 30, 15]);
  assert.equal(c.openShare, 0.25);
  const html = complaintsHtml(c);
  assert.match(html, /100 requests/);
  assert.match(html, /25% are still open/);
  assert.match(complaintsHtml(complaintsCard({ total: 0, types: {}, status: { open: 0, closed: 0 } })), /No 311 requests/);
});

// ---------- Street closures ----------

const block = (seg, start, end, meters) =>
  ({ seg, on: "BROADWAY", from: "WEST 34 STREET", to: "WEST 35 STREET", boro: "M", onKey: "BROADWAY", meters, permits: [{ start, end, purpose: "REPAIR GAS" }] });

test("closures: closed today, closed this week, nearest first", () => {
  const c = closuresCard({ today: TODAY, blocks: [
    block("far", TODAY, "2026-11-05", 380),
    block("near", "2026-11-01", "2026-11-02", 40), // Sunday: this week, not today
    block("later", "2026-11-20", "2026-11-21", 10) // not this week
  ] });
  assert.equal(c.today, 1);
  assert.equal(c.week, 2);
  assert.deepEqual(c.nearest.map((b) => b.seg), ["near", "far"]);
  assert.match(closuresHtml(c), /1 block<\/strong> closed today within ¼ mile, and 1 block later this week\./);
  assert.match(closuresHtml({ ...c, week: 1 }), /closed today within ¼ mile\.<\/p>/);
  assert.match(closuresHtml(closuresCard({ today: TODAY, blocks: [] })), /No street closures/);
});

// ---------- Help ----------

test("help: the nearest open site of each kind within 2 miles", () => {
  const sites = [
    { id: "1", category: "snap", name: "Far SNAP", miles: 1.5, address: "1 Main St", borough: "Bronx", zip: "10457" },
    { id: "2", category: "snap", name: "Near SNAP", miles: 0.4, address: "2 Main St", borough: "Bronx", zip: "10457" },
    { id: "3", category: "older", name: "Closed center", miles: 0.1, closed: true },
    { id: "4", category: "youth", name: "Too far", miles: 3 },
    { id: "5", category: "computers", name: "Library", miles: 0.2, address: "3 Main St", borough: "Bronx" }
  ];
  const picked = helpCard(sites);
  assert.deepEqual(picked.map((s) => s.name), ["Library", "Near SNAP"]);
  assert.equal(picked[1].kind, "Food & cash benefits");
  assert.match(helpHtml(picked), /Directions/);
  assert.match(helpHtml([]), /No city help sites/);
});

// ---------- Water ----------

test("water: the nearest station, and a card with no samples says so", () => {
  const stations = [{ site: "A", lat: 40.76, lon: -73.98 }, { site: "B", lat: 40.749, lon: -73.986 }];
  const s = nearestStation(stations, EMPIRE);
  assert.equal(s.site, "B");
  assert.equal(nearestStation([], EMPIRE), null);
  assert.match(waterHtml(null, null), /No active sampling station/);
  assert.match(waterHtml({ ...s, borough: null }, { months: [], stations: {} }), /no routine samples/);
});

// ---------- Restaurants ----------

test("restaurants: grade mix and the nearest few", () => {
  const r = (camis, grade, miles) => ({ camis, name: `R${camis}`, cuisine: "Pizza", miles, grade: grade ? { grade, date: "2026-01-01" } : null });
  const c = restaurantsCard({ results: [r("1", "A", 0.05), r("2", "A", 0.1), r("3", "B", 0.2), r("4", "Z", 0.3), r("5", null, 0.4), r("6", "C", 0.45)], more: false });
  assert.deepEqual(c.grades, { A: 2, B: 1, C: 1, other: 2 });
  assert.equal(c.nearest.length, 5);
  const html = restaurantsHtml(c);
  assert.match(html, /6 restaurants within about half a mile: 2 A, 1 B, 1 C, 2 not graded yet or pending/);
  assert.match(html, /href="\/restaurant-inspections\/\?camis=1"/);
  assert.match(restaurantsHtml(restaurantsCard({ results: [r("1", "A", 0.1)], more: true })), /The 1 nearest restaurants/);
});

// ---------- Schools ----------

test("schools: nearest three, with the zoning caveat", () => {
  const points = [
    [40.76, -73.98, "02M001", "Far School", "high-school"],
    [40.7485, -73.986, "02M002", "Near School", "elementary"],
    [40.75, -73.986, "02M003", "Mid School", "middle"],
    [40.80, -73.95, "03M004", "Very Far", "middle"]
  ];
  const s = nearestSchools(points, EMPIRE);
  assert.deepEqual(s.map((x) => x.dbn), ["02M002", "02M003", "02M001"]);
  assert.equal(s[0].href, "/school-quality/02M002/");
  const html = schoolsHtml(s);
  assert.match(html, /Elementary/);
  assert.match(html, /may not be the nearest one/);
});

test("miles wording", () => {
  assert.equal(milesText(0.04), "under 0.1 mi");
  assert.equal(milesText(1.26), "1.3 mi");
});

test("cards escape what the data says", () => {
  const html = restaurantsHtml(restaurantsCard({ results: [{ camis: "1", name: "<img onerror=x>", cuisine: "", grade: null }] }));
  assert.doesNotMatch(html, /<img/);
});
