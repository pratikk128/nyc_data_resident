/*
 * The address report (/address/): the URL spot, the links into each
 * dashboard, what each topic picks from its dashboard's API, and its
 * wording, in its section and in "At a glance".
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  spotFromParams, spotToParams, dashboardLinks, complaintsCard, complaintsStandouts, closuresCard, helpCard, restaurantsCard, neighborhoodName,
  nearestSchools, milesText, safetyCard, nearestParks
} from "../src/lib/address-report/report.js";
import {
  complaintsHtml, complaintsGlance, standoutsHtml, closuresHtml, closuresGlance, helpHtml, helpGlance, schoolsHtml, schoolsGlance,
  restaurantsHtml, restaurantsGlance, buildingHtml, buildingGlance, buildingAskGlance,
  safetyHtml, safetyGlance, parksHtml, parksGlance
} from "../src/lib/address-report/render.js";
import { reportHref, placeFromParams } from "../src/lib/address-report/link.js";
import { readTotals, readCorners } from "../src/lib/crashes/hotspot-sql.js";
import { addressOutcome } from "../src/lib/location/near-search.js";
import { placeToLocation, buildingBbl } from "../src/lib/complaints311/geocode.js";

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

test("back to the report: a dashboard's spot (Restaurant Inspections' lat/lng too) opens the report on it", () => {
  assert.deepEqual(spotFromParams(qs("lat=40.74844&lng=-73.98566&name=pizza")), EMPIRE);
  assert.equal(spotFromParams(qs("boro=BRONX&zip=10457")), null); // a borough or ZIP alone has no spot
  assert.equal(reportHref({ lat: 40.74844, lon: -73.98566 }), "/address/?lat=40.748&lon=-73.986");
  // A ZIP alone goes over as the landing page's box sends it; a spot wins over its ZIP; a ZIP outside NYC is nothing.
  assert.deepEqual(placeFromParams(qs("boro=BRONX&zip=10457")), { zip: "10457" });
  assert.equal(reportHref({ zip: "10457" }), "/address/#q=10457");
  assert.deepEqual(placeFromParams(qs("lat=40.74844&lon=-73.98566&zip=10001")), EMPIRE);
  assert.equal(placeFromParams(qs("zip=07302")), null);
  assert.equal(placeFromParams(qs("boro=BRONX")), null);
});

test("links: each dashboard opens on the same spot", () => {
  const links = dashboardLinks(EMPIRE);
  assert.equal(links.complaints, "/311-complaints/?lat=40.748&lon=-73.986&area=immediate");
  assert.equal(links.closures, "/street-closures/?lat=40.748&lon=-73.986&r=0.25");
  assert.equal(links.help, "/help-near-me/?lat=40.748&lon=-73.986");
  assert.equal(links.restaurants, "/restaurant-inspections/?lat=40.748&lng=-73.986");
  assert.equal(links.schools, "/school-quality/?view=map&lat=40.748&lon=-73.986");
  assert.equal(links.safety, "/crash-hotspots/?lat=40.748&lon=-73.986&r=250");
  assert.equal(links.parks, "/park-amenities/?lat=40.748&lon=-73.986");
  assert.equal(links.building, "/building-report/");
  assert.equal(dashboardLinks(EMPIRE, { bbl: "1008350041" }).building, "/building-report/?bbl=1008350041");
});

// ---------- Your building ----------

test("building: only a house-numbered address names one, and it rides along with the spot", () => {
  const place = { lat: 40.7, lon: -74, label: "1 Centre St", houseNumber: "1", bbl: "1001210001", borough: "MANHATTAN", zip: "10007" };
  assert.equal(buildingBbl(place), "1001210001");
  assert.equal(buildingBbl({ ...place, houseNumber: null }), null, "a spot GeoSearch picked along a street");
  assert.equal(placeToLocation(place).bbl, "1001210001");
  assert.equal("bbl" in placeToLocation({ ...place, houseNumber: null }), false);
  assert.equal(addressOutcome({ status: "resolved", location: placeToLocation(place) }).bbl, "1001210001");
});

const LOT = { bbl: "2031070036", address: "1 Main St", borough: "Bronx", hpd: true, units: 40, yearBuilt: 1931, bins: ["2012951"] };
const FLAGS = { active: false, any: false, activeVacates: [], aep: null, pendingCases: 0 };
const VIOLATIONS = (open) => ({ open: { A: 0, B: 0, C: 0, I: 0, total: 0, ...open }, ever: 12 });
const COMPLAINTS = { last12: 3, top: [{ label: "Heat/hot water" }], ever: 20 };
const DOB = { bins: ["2012951"], complaints12: 1, ecb: { open: 0, due: 0 } };
const parts = (over = {}) => ({ flags: FLAGS, violations: VIOLATIONS({}), complaints: COMPLAINTS, dob: DOB, ...over });

test("building: a serious warning leads the glance, then urgent repairs, then any open ones", () => {
  assert.deepEqual(buildingGlance(LOT, parts({ flags: { ...FLAGS, active: true, aep: { active: true } } })),
    { tone: "warn", text: "Serious warning on file for this building" });
  assert.deepEqual(buildingGlance(LOT, parts({ violations: VIOLATIONS({ C: 2, total: 5 }) })),
    { tone: "warn", text: "2 urgent repair orders open in your building" });
  assert.deepEqual(buildingGlance(LOT, parts({ violations: VIOLATIONS({ B: 1, total: 1 }) })),
    { tone: "info", text: "1 repair order open in your building" });
  assert.equal(buildingGlance(LOT, parts()).tone, "good");
  assert.match(buildingGlance({ ...LOT, hpd: false }, parts({ violations: { ...VIOLATIONS({}), ever: 0 } })).text, /No housing agency records/);
  assert.equal(buildingAskGlance().tone, "none");
});

test("building: four takeaways, and one that couldn't load says so on its own", () => {
  const html = buildingHtml(LOT, parts({ dob: null }));
  assert.match(html, /1 Main St, Bronx<\/strong> · 40 apartments, built 1931/);
  assert.equal(html.match(/class="br-take"/g).length, 4);
  assert.match(html, /Tenant complaints, last 12 months.*>3</);
  assert.match(html, /data-tone="none".*Couldn’t load this/);
});

// ---------- Street safety ----------

const crashSummary = (here, corners = []) => ({
  dateFrom: "2025-11-01", dataThrough: "2026-10-31", compareTo: { kind: "borough", label: "Manhattan" },
  here: readTotals(here), compare: readTotals({ crashes: 5000, hurt_crashes: 1500 }), city: readTotals({ crashes: 90000 }), boroughs: {},
  corners: readCorners(corners)
});
const corner = (label, hurt) => ({ corner: label, label, borough: "MANHATTAN", lat: 40.7, lon: -74, n: hurt + 2, hurt, injured: hurt, killed: 0, fatal: 0 });

test("street safety: crashes that hurt someone, the worst corners (3 at most), the date range", () => {
  const c = safetyCard(crashSummary({ crashes: 40, hurt_crashes: 12, injured: 15, killed: 1 },
    [corner("5 Ave & W 34 St", 6), corner("6 Ave & W 34 St", 4), corner("5 Ave & W 33 St", 3), corner("Madison Ave & E 34 St", 2)]));
  assert.equal(c.hurt, 12);
  assert.equal(c.corners.length, 3);
  assert.deepEqual(safetyGlance(c), { tone: "warn", text: "12 crashes hurt someone within about 3 blocks; 1 person killed" });
  const html = safetyHtml(c);
  assert.match(html, /5 Ave &#38; W 34 St<\/span><span class="ar-row-side">6 injury crashes/);
  assert.match(html, /Crashes that hurt someone \(12 in the last year\)/);
  assert.match(html, /People killed \(15 hurt\)/);
  assert.doesNotMatch(html, /Madison Ave/);
  assert.match(html, /Police-reported crashes, Nov 1, 2025 to Oct 31, 2026\./);
});

test("street safety: no one hurt is good news, and says how many crashes there were", () => {
  const c = safetyCard(crashSummary({ crashes: 4 }));
  assert.equal(safetyGlance(c).tone, "good");
  assert.match(safetyHtml(c), /No police-reported crash hurt anyone within about 3 blocks, out of 4 crashes reported\./);
  assert.equal(safetyGlance(safetyCard(crashSummary({ crashes: 9, hurt_crashes: 1 }))).text, "1 crash hurt someone within about 3 blocks");
});

// ---------- Parks ----------

const amenity = (id, category, miles, extra = {}) => ({ id, category, name: `Name ${id}`, parkName: "Bryant Park", borough: "Manhattan", lat: 40.75, lon: -73.98, details: {}, miles, sourceDataset: "x", ...extra });

test("parks: the nearest of each kind, nearest first, with only what the card shows", () => {
  const parks = nearestParks([amenity("p2", "playground", 0.4), amenity("f1", "fountain", 0.1), amenity("p1", "playground", 0.2), amenity("d1", "dog", 0.9)]);
  assert.deepEqual(parks.map((a) => a.id), ["f1", "p1", "d1"]);
  assert.equal("sourceDataset" in parks[0], false);
  // The playground leads the glance even when a fountain is closer.
  assert.deepEqual(parksGlance(parks), { tone: "info", text: "Nearest playground: 0.2 mi" });
  assert.deepEqual(parksGlance([parks[0]]), { tone: "info", text: "Nearest water fountain: 0.1 mi" });
  assert.equal(parksGlance([]).text, "No park amenities found nearby");
  assert.match(parksHtml(parks), /Playground<\/span> Name p1/);
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
  assert.match(html, /data-standouts/); // the city comparison fills in later
  assert.deepEqual(complaintsGlance(c), { tone: "info", text: "Most common 311 request: Noise from homes" });
  const none = complaintsCard({ total: 0, types: {}, status: { open: 0, closed: 0 } });
  assert.match(complaintsHtml(none), /No 311 requests/);
  assert.equal(complaintsGlance(none).tone, "good");
});

test("311: what's more common here than across the city", () => {
  const area = { total: 200, types: { "NOISE - RESIDENTIAL": 120, "HEAT/HOT WATER": 40, "ILLEGAL PARKING": 40 } };
  const city = { types: { "NOISE - RESIDENTIAL": 200, "HEAT/HOT WATER": 400, "ILLEGAL PARKING": 400 } };
  const s = complaintsStandouts(area, city);
  assert.equal(s.enough, true);
  assert.deepEqual(s.above.map((r) => r.key), ["NOISE - RESIDENTIAL"]);
  assert.ok(Math.abs(s.above[0].ratio - 3) < 1e-9);
  assert.match(standoutsHtml(s), /3\.0× the city/);
  const g = complaintsGlance(complaintsCard({ ...area, status: {} }), s);
  assert.match(g.text, /Stands out on 311: .+ \(3\.0× the city\)/);
  assert.equal(g.tone, "info"); // more common isn't worse
  // Too few requests to compare, nothing standing out, and no city numbers.
  assert.match(standoutsHtml(complaintsStandouts({ ...area, total: 50 }, city)), /Too few requests/);
  assert.match(standoutsHtml(complaintsStandouts(area, { types: area.types })), /Nothing stands out/);
  assert.match(standoutsHtml(null), /isn’t available/);
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
  assert.deepEqual(closuresGlance(c), { tone: "warn", text: "1 block closed today" });
  assert.deepEqual(closuresGlance({ today: 0, week: 2 }), { tone: "info", text: "2 blocks closing later this week" });
  assert.equal(closuresGlance({ today: 0, week: 0 }).tone, "good");
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
  assert.equal(helpGlance(picked).text, "2 kinds of city help within 1 mi");
  assert.equal(helpGlance([{ ...picked[0], miles: 1.4 }]).text, "1 kind of city help within 2 mi");
});

// ---------- Restaurants ----------

test("restaurants: grade mix and the nearest few", () => {
  const r = (camis, grade, miles) => ({ camis, name: `R${camis}`, cuisine: "Pizza", miles, grade: grade ? { grade, date: "2026-01-01" } : null });
  const c = restaurantsCard({ results: [r("1", "A", 0.05), r("2", "A", 0.1), r("3", "B", 0.2), r("4", "Z", 0.3), r("5", null, 0.4), r("6", "C", 0.45)], more: false });
  assert.deepEqual(c.grades, { A: 2, B: 1, C: 1, other: 2 });
  assert.equal(c.nearest.length, 5);
  const html = restaurantsHtml(c);
  assert.match(html, /Of 6 restaurants within about half a mile, <strong>2<\/strong> have an A\./);
  assert.match(html, /Not graded yet: 2/);
  assert.match(html, /href="\/restaurant-inspections\/\?camis=1"/);
  assert.match(restaurantsHtml(restaurantsCard({ results: [r("1", "A", 0.1)], more: true })), /Of the 1 nearest restaurants, <strong>1<\/strong> has an A/);
  assert.equal(restaurantsGlance(c).text, "2 of 6 nearby restaurants have an A");
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
  assert.equal(schoolsGlance(s).text, `Nearest public school: ${milesText(s[0].miles)}`);
});

test("place: the neighborhood from GeoSearch's reverse lookup, or nothing", () => {
  const f = (props) => ({ properties: props });
  assert.equal(neighborhoodName([f({ borough: "Manhattan" }), f({ neighbourhood: "Midtown West", borough: "Manhattan" })]), "Midtown West, Manhattan");
  assert.equal(neighborhoodName([f({ borough: "Queens" })]), null);
  assert.equal(neighborhoodName(undefined), null);
});

test("miles wording", () => {
  assert.equal(milesText(0.04), "under 0.1 mi");
  assert.equal(milesText(1.26), "1.3 mi");
});

test("cards escape what the data says", () => {
  const html = restaurantsHtml(restaurantsCard({ results: [{ camis: "1", name: "<img onerror=x>", cuisine: "", grade: null }] }));
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(buildingHtml({ ...LOT, address: "<img onerror=x>" }, parts()), /<img/);
  assert.doesNotMatch(parksHtml([amenity("x", "dog", 0.3, { name: "<img onerror=x>" })]), /<img/);
  assert.doesNotMatch(safetyHtml(safetyCard(crashSummary({ crashes: 3, hurt_crashes: 2 }, [corner("<img onerror=x>", 2)]))), /<img/);
});
