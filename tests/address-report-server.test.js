/*
 * The address report's nearest water station, help, schools and park amenities in one small
 * response (src/lib/server/address-report.js, src/pages/api/address/nearest.js).
 * Runs the real modules on a fake Workers env (tests/support/workers.js).
 *   npm test
 *
 * The server keeps what it read from KV in memory, so the tests run in order:
 * the school index missing first, then everything built.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { env, fakeKv } from "./support/workers.js";

const { helpNearMeDatasets } = await import("../src/lib/server/help-near-me.js");
const { parkAmenitiesDatasets } = await import("../src/lib/server/park-amenities.js");
const { indexJob } = await import("../src/lib/server/schools.js");
const { monthlyJob, detectionsJob, stationsJob } = await import("../src/lib/server/water.js");
const { GET } = await import("../src/pages/api/address/nearest.js");
const { RATE_LIMITED_TEXT } = await import("../src/lib/server/rate-limit.js");

const SPOT = { lat: 40.8252, lon: -73.8433 }; // Zerega Ave, the Bronx: next to water station 10150
const NOW = new Date().toISOString();
const MONTHS = ["2026-08", "2026-09"];

const stored = (value) => JSON.stringify({ computedAt: NOW, value: { computedAt: NOW, ...value } });

function helpEntry(ds, i) {
  const category = ds.id.replace("help-near-me-", "");
  const site = {
    id: `${category}:${i}`, category, name: `Site ${i}`, address: `${i} Main Street`, borough: "Bronx", zip: "10461",
    lat: SPOT.lat + i * 0.001, lon: SPOT.lon, phone: "212-555-0100", hours: "9–5", services: ["Food"], provider: null, note: null,
    closed: false, sourceDatasetId: ds.datasetId, sourceUpdatedAt: NOW
  };
  return stored({ sourceUpdatedAt: NOW, rows: 1, sites: [site], notGeocoded: [], moved: [] });
}

// Five schools, one a block further than the last.
const school = (i) => ({
  dbn: `08X00${i}`, name: `P.S. ${i}`, boro: "Bronx", district: "District 8", current: true,
  loc: { address: `${i} Zerega Ave`, zip: "10461", neighborhood: "Westchester Square", lat: SPOT.lat + i * 0.002, lon: SPOT.lon },
  types: ["elementary"], reports: [], values: {}
});

// Two of each kind of park amenity, the second a few blocks further.
function parkEntry(ds) {
  const category = ds.id.replace("park-amenities-", "");
  const amenity = (i) => ({
    id: `${category}:${i}`, category, name: `${category} ${i}`, parkName: "Zerega Park", parkId: "X001", borough: "Bronx",
    lat: SPOT.lat + 0.001 + i * 0.004, lon: SPOT.lon, details: {}, sourceDataset: ds.datasetId, sourceLastUpdated: NOW
  });
  return stored({ sourceUpdatedAt: NOW, rows: 2, amenities: [amenity(0), amenity(1)] });
}

function kv({ schools = true } = {}) {
  const entries = {
    [monthlyJob.key]: stored({ latestDate: "2026-09-30", completeMonth: "2026-09", gaps: [], months: [] }),
    [detectionsJob.key]: stored({ detections: [] }),
    [stationsJob.key]: stored({
      months: MONTHS,
      sites: { 10150: [["2026-09", 4, 0.6, 0.7, 4, 0, 0]], 10250: [["2026-09", 4, 0.5, 0.6, 4, 0, 0]] },
      totals: { 10150: { n: 4 }, 10250: { n: 4 } },
      city: null
    })
  };
  if (schools) entries[indexJob.key] = stored({ latestYear: 2025, years: [2025], schools: [1, 2, 3, 4, 5].map(school), cityAvg: {} });
  helpNearMeDatasets.forEach((ds, i) => { entries[ds.jobs[0].key] = helpEntry(ds, i); });
  parkAmenitiesDatasets.filter((ds) => ds.id !== "park-amenities-park-names").forEach((ds) => { entries[ds.jobs[0].key] = parkEntry(ds); });
  for (const key of Object.keys(entries)) entries[`${key}:at`] = NOW;
  return fakeKv(entries);
}

const get = (qs) =>
  GET({ url: new URL(`https://example.test/api/address/nearest?${qs}`), locals: { cfContext: {} }, clientAddress: "203.0.113.7" });
const nearest = () => get(`lat=${SPOT.lat}&lon=${SPOT.lon}`);

let fetches;
beforeEach(() => {
  fetches = [];
  // Nothing here should reach Socrata.
  globalThis.fetch = async (url) => { fetches.push(String(url)); throw new Error(`unexpected fetch ${url}`); };
  delete env.HELP_RATE_LIMITER;
  delete env.SCHOOL_SEARCH_RATE_LIMITER;
});

test("a part that fails says so on its own; the rest still come back, and nothing is cached", async () => {
  env.DATA_CACHE = kv({ schools: false });

  const res = await nearest();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.deepEqual(body.schools, { failed: true, error: null });
  assert.equal(body.water.station.site, "10150");
  assert.equal(body.help.sites.length, helpNearMeDatasets.length);
});

test("only what the cards show: the nearest station with its months, the nearest help of each kind, 3 schools, the nearest park amenity of each kind", async () => {
  env.DATA_CACHE = kv();

  const res = await nearest();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=3600");
  const body = await res.json();
  assert.deepEqual(fetches, []);

  const { station, data } = body.water;
  assert.equal(station.site, "10150");
  assert.ok(station.miles < 0.1 && station.place);
  assert.deepEqual(Object.keys(data.stations), ["10150"]);
  assert.deepEqual(data.months, MONTHS);

  assert.equal(body.help.sites.length, helpNearMeDatasets.length);
  assert.deepEqual(Object.keys(body.help.sites[0]).sort(), ["address", "borough", "kind", "lat", "lon", "miles", "name", "zip"]);
  assert.deepEqual(body.help.sites.map((s) => s.miles), [...body.help.sites.map((s) => s.miles)].sort((a, b) => a - b));

  assert.deepEqual(body.schools.schools.map((s) => s.dbn), ["08X001", "08X002", "08X003"]);

  assert.deepEqual(body.parks.parks.map((a) => a.id).sort(), ["dog:0", "fountain:0", "playground:0", "pool:0"]);
  assert.deepEqual(Object.keys(body.parks.parks[0]).sort(), ["borough", "category", "details", "id", "lat", "lon", "miles", "name", "parkName"]);
  assert.equal(body.parks.partial, false);

  // The whole answer is a few KB, not every station, help site, school and amenity.
  assert.ok(JSON.stringify(body).length < 5000);
});

test("a client over a dashboard's limit gets that part's words to show", async () => {
  env.DATA_CACHE = kv();
  env.HELP_RATE_LIMITER = { limit: async () => ({ success: false }) };

  const body = await (await nearest()).json();
  assert.deepEqual(body.help, { failed: true, error: RATE_LIMITED_TEXT });
  assert.equal(body.water.station.site, "10150");
});

test("a spot outside NYC, or no spot, is a 400", async () => {
  for (const qs of ["lat=42.65&lon=-73.75", "lat=40.744&lon=-74.0324", "", "lat=abc&lon=-73.9"]) {
    const res = await get(qs);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Pick a spot in New York City." });
  }
});
