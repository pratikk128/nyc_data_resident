/*
 * A Building Report Card page's lot (lotForPage() in
 * src/lib/server/building-report.js, /api/building-report/lot): a slow lot
 * doesn't hold up the page, and the browser's request for it shares the
 * lookup the page started. Socrata is a fake fetch that answers when told.
 *   npm test
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./support/workers.js";

const { lotForPage } = await import("../src/lib/server/building-report.js");
const { GET } = await import("../src/pages/api/building-report/lot.js");

const BBL = "2031070036";
const pageUrl = (bbl) => new URL(`https://example.test/building-report/?bbl=${bbl}`);
const PLUTO = [{ bbl: BBL, address: "1967 MARMION AVENUE", zipcode: "10460", unitsres: "40", latitude: "40.84", longitude: "-73.88" }];

// Each Socrata request waits until release() (or answers at once when fast).
let fetches, waiting, fast;
const release = () => { for (const go of waiting.splice(0)) go(); };
beforeEach(() => {
  fetches = [];
  waiting = [];
  fast = false;
  globalThis.fetch = async (url) => {
    fetches.push(String(url));
    if (!fast) await new Promise((go) => waiting.push(go));
    const rows = String(url).includes("64uk-42ks") ? PLUTO : [];
    return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
  };
});

test("a lot that answers in time comes with the page", async () => {
  fast = true;
  const { bbl, lot, error } = await lotForPage(pageUrl(BBL), null, "1.2.3.4");
  assert.equal(bbl, BBL);
  assert.equal(error, null);
  assert.equal(lot.address, "1967 Marmion Avenue");
});

test("a slow lot sends the page without it, and the browser's request shares the lookup", async () => {
  const page = await lotForPage(pageUrl(BBL), null, "1.2.3.4", { waitMs: 10 });
  assert.deepEqual(page, { bbl: BBL, lot: null, error: null });
  assert.equal(fetches.length, 3); // PLUTO, footprints, HPD buildings, still out

  const api = GET({ url: new URL(`https://example.test/api/building-report/lot?bbl=${BBL}`), locals: {}, clientAddress: "1.2.3.4" });
  release();
  const res = await api;
  assert.equal(res.status, 200);
  assert.equal((await res.json()).lot.address, "1967 Marmion Avenue");
  assert.equal(fetches.length, 3); // no second lookup
});

test("an unknown lot is not-found, on the page and from the API", async () => {
  const other = "3012340056"; // every fake dataset is empty for it
  globalThis.fetch = async (url) => { fetches.push(String(url)); return new Response("[]"); };
  assert.equal((await lotForPage(pageUrl(other), null, "")).error, "not-found");
  const res = await GET({ url: new URL(`https://example.test/api/building-report/lot?bbl=${other}`), locals: {}, clientAddress: "" });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not-found" });
});

test("no ?bbl= is the search page; a malformed one is not-found without a lookup", async () => {
  assert.deepEqual(await lotForPage(new URL("https://example.test/building-report/"), null, ""), { bbl: null, lot: null, error: null });
  assert.equal((await lotForPage(pageUrl("12345"), null, "")).error, "not-found");
  assert.deepEqual(fetches, []);
});
