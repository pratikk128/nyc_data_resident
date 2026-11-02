/*
 * Park Amenities Near Me on the server: the search reads what the ETL stored
 * in KV and builds it only when KV has none (src/lib/server/park-amenities.js
 * loadSearch()), and the API route's status codes and caching
 * (src/pages/api/park-amenities/search.js). Runs the real modules on a fake
 * Workers env (tests/support/workers.js).
 *   npm test
 *
 * The server keeps what it read or built in memory, so the tests run in order:
 * a dataset that fails to build first (the pools), then all four in KV, where
 * only the pools are new to the isolate.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { env, fakeKv } from "./support/workers.js";

const { parkAmenitiesDatasets } = await import("../src/lib/server/park-amenities.js");
const { GET } = await import("../src/pages/api/park-amenities/search.js");
const { DATASETS } = await import("../src/lib/server/etl.js");

const FX = JSON.parse(readFileSync(new URL("./fixtures/park-amenities.json", import.meta.url)));
const SPOT = { lat: 40.7484, lon: -73.9857 }; // 350 5th Avenue
const NOW = new Date().toISOString();

const get = (qs) =>
  GET({ url: new URL(`https://example.test/api/park-amenities/search?${qs}`), locals: { cfContext: {} }, clientAddress: "203.0.113.7" });

// Socrata, from the fixture: metadata for every dataset, rows for each $select.
let fetches;
let failing = new Set();
beforeEach(() => {
  fetches = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    fetches.push(u.pathname);
    const id = u.pathname.match(/\/(?:resource|api\/views)\/([a-z0-9-]{9})/)[1];
    if (failing.has(id)) return new Response("nope", { status: 500 });
    if (u.pathname.startsWith("/api/views/")) return Response.json({ name: id, rowsUpdatedAt: Date.parse("2026-10-15T13:18:29Z") / 1000 });
    const offset = Number(u.searchParams.get("$offset") ?? 0);
    return Response.json(offset ? [] : FX[id] ?? []);
  };
});

test("every dataset is in the ETL, each with its metadata and one job", () => {
  for (const ds of parkAmenitiesDatasets) {
    assert.ok(DATASETS.includes(ds), ds.id);
    assert.equal(ds.dashboard, "park-amenities");
    assert.equal(ds.jobs.length, 1);
  }
  assert.deepEqual(parkAmenitiesDatasets.map((d) => d.datasetId), ["j55h-3upk", "hxx3-bwgv", "qnv7-p7a2", "y5rm-wagw", "enfh-gkve"]);
});

test("a spot outside the city, or none, is a 400", async () => {
  env.DATA_CACHE = fakeKv();
  for (const qs of ["lat=40.72&lon=-74.07", "lat=abc&lon=1", "lon=-73.98", ""]) {
    const res = await get(qs);
    assert.equal(res.status, 400, qs);
  }
  assert.deepEqual(fetches, []);
});

test("empty KV: built from Socrata on the first search; a dataset that fails shows as failed and isn't cached", async () => {
  env.DATA_CACHE = fakeKv();
  failing = new Set(["y5rm-wagw"]);
  const res = await get(`lat=${SPOT.lat}&lon=${SPOT.lon}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.deepEqual(body.point, { lat: 40.748, lon: -73.986 });
  assert.equal(body.sources.find((s) => s.key === "pool").error, true);
  assert.ok(body.sources.filter((s) => s.key !== "pool").every((s) => !s.error && s.updatedAt === "2026-10-15"));
  assert.ok(!body.amenities.some((a) => a.category === "pool"));
  // The fixture is spread over the city, so each other kind is there as its nearest one.
  for (const k of ["playground", "dog", "fountain"]) assert.ok(body.amenities.some((a) => a.category === k), k);
  assert.ok(body.amenities.every((a, i, xs) => i === 0 || xs[i - 1].miles <= a.miles));
  // The amenities and park names are in KV now.
  assert.ok(env.DATA_CACHE.store.has("park-amenities:amenities:qnv7-p7a2:v1"));
  assert.ok(env.DATA_CACHE.store.has("park-amenities:park-names:enfh-gkve:v1"));
  failing = new Set();
});

test("all four in KV: the search reads them without calling Socrata, cached for an hour", async () => {
  // The other three are still in memory from the last test; the pool comes from KV.
  const entries = {};
  for (const ds of parkAmenitiesDatasets.slice(0, 4)) {
    const category = ds.id.replace("park-amenities-", "");
    const a = { id: `${category}:1`, category, name: "Near", parkName: "Some Park", borough: "Manhattan", lat: SPOT.lat + 0.002, lon: SPOT.lon, details: {}, sourceDataset: ds.datasetId, sourceLastUpdated: "2026-10-15" };
    const entry = { computedAt: NOW, value: { computedAt: NOW, sourceUpdatedAt: "2026-10-15", rows: 1, amenities: [a] } };
    entries[ds.jobs[0].key] = JSON.stringify(entry);
    entries[`${ds.jobs[0].key}:at`] = NOW;
  }
  env.DATA_CACHE = fakeKv(entries);
  const res = await get(`lat=${SPOT.lat}&lon=${SPOT.lon}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=3600");
  const body = await res.json();
  assert.deepEqual(fetches, []);
  assert.ok(body.sources.every((s) => !s.error));
  const pool = body.amenities.find((a) => a.category === "pool");
  assert.equal(pool.id, "pool:1");
  assert.ok(pool.miles > 0.1 && pool.miles < 0.2);
  assert.equal(body.amenities[0], pool); // the nearest of everything
});
