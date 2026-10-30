/*
 * Where can I get help near me? on the server: the search reads only what
 * the ETL stored in KV (src/lib/server/help-near-me.js loadSearch()), and the
 * API route's status codes and caching (src/pages/api/help-near-me/search.js).
 * Runs the real modules on a fake Workers env (tests/support/workers.js).
 *   npm test
 *
 * The server keeps what it read from KV in memory, so the tests run in order:
 * a directory missing first, then all seven.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { env, fakeKv } from "./support/workers.js";

const { helpNearMeDatasets } = await import("../src/lib/server/help-near-me.js");
const { GET } = await import("../src/pages/api/help-near-me/search.js");
const { RATE_LIMITED_TEXT } = await import("../src/lib/server/rate-limit.js");

const SPOT = { lat: 40.8463, lon: -73.8951 }; // Crotona Park East, the Bronx
const NOW = new Date().toISOString();

// One site per directory, a few blocks from the spot, as the ETL job stores it.
function storedEntry(ds, i) {
  const category = ds.id.replace("help-near-me-", "");
  const site = {
    id: `${category}:${i}`, category, name: `Site ${i}`, address: `${i} Main Street`, borough: "Bronx", zip: "10457",
    lat: SPOT.lat + i * 0.001, lon: SPOT.lon, phone: null, hours: null, services: [], provider: null, note: null,
    closed: false, sourceDatasetId: ds.datasetId, sourceUpdatedAt: NOW
  };
  return { computedAt: NOW, value: { computedAt: NOW, sourceUpdatedAt: NOW, rows: 1, sites: [site], notGeocoded: [], moved: [] } };
}

function kvWith(datasets) {
  const entries = {};
  datasets.forEach((ds) => {
    const i = helpNearMeDatasets.indexOf(ds);
    const job = ds.jobs[0];
    entries[job.key] = JSON.stringify(storedEntry(ds, i));
    entries[`${job.key}:at`] = NOW;
  });
  return fakeKv(entries);
}

const search = (lat, lon, clientAddress = "203.0.113.7") =>
  GET({ url: new URL(`https://example.test/api/help-near-me/search?lat=${lat}&lon=${lon}`), locals: { cfContext: {} }, clientAddress });

let fetches;
beforeEach(() => {
  fetches = [];
  // Nothing on a search should reach Socrata or GeoSearch.
  globalThis.fetch = async (url) => { fetches.push(String(url)); throw new Error(`unexpected fetch ${url}`); };
  delete env.HELP_RATE_LIMITER;
});

test("a directory the ETL hasn't built yet shows as failed; the search never builds it, and isn't cached", async () => {
  const [missing, ...built] = helpNearMeDatasets;
  env.DATA_CACHE = kvWith(built);

  const res = await search(SPOT.lat, SPOT.lon);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();

  assert.deepEqual(fetches, []);
  assert.equal(body.sources.find((s) => s.datasetId === missing.datasetId).error, true);
  assert.ok(body.sources.filter((s) => s.datasetId !== missing.datasetId).every((s) => !s.error));
  assert.equal(body.sites.length, built.length);
  assert.ok(!body.sites.some((s) => s.sourceDatasetId === missing.datasetId));
  assert.ok(!env.DATA_CACHE.store.has(missing.jobs[0].key)); // and nothing was written for it
});

test("all seven built: every site near the spot, at a rounded point, cached for an hour", async () => {
  env.DATA_CACHE = kvWith(helpNearMeDatasets);

  const res = await search(SPOT.lat, SPOT.lon);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=3600");
  const body = await res.json();

  assert.deepEqual(fetches, []);
  assert.deepEqual(body.point, { lat: 40.846, lon: -73.895 });
  assert.equal(body.sites.length, helpNearMeDatasets.length);
  assert.ok(body.sources.every((s) => !s.error && s.updatedAt === NOW));
  // Per-directory and ETL-only fields stay off the cards.
  assert.ok(body.sites.every((s) => !("sourceUpdatedAt" in s) && !("geocoded" in s) && typeof s.miles === "number"));
});

test("a client over its limit gets a 429 with words to show", async () => {
  env.DATA_CACHE = kvWith(helpNearMeDatasets);
  env.HELP_RATE_LIMITER = { limit: async () => ({ success: false }) };

  const res = await search(SPOT.lat, SPOT.lon);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await res.json(), { error: RATE_LIMITED_TEXT });
});

test("a spot outside NYC (Albany, Hoboken), or no spot, is a 400", async () => {
  for (const [lat, lon] of [[42.65, -73.75], [40.744, -74.0324], ["", ""], ["abc", "-73.9"]]) {
    const res = await search(lat, lon);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Pick a spot in New York City." });
  }
});
