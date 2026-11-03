/*
 * Shop Local: categories, the URL query, search and ranking, the detail's
 * fields (no procurement data, street only for walk-in businesses), the
 * cards and the page script's decisions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { KINDS, CATEGORIES } from "../src/lib/shop-local/config.js";
import {
  normalizeQuery, queryToParams, searchLocal, kindOf, ownersOf, ownerLabels, placeName, localDetail
} from "../src/lib/shop-local/filter.js";
import { cardsHtml, detailHtml, distanceText, statusText, businessMeta, placeLine } from "../src/lib/shop-local/render.js";
import { pageUrl, formQuery, zipState, popstateAction, closeAction, nearestZip, startQuery } from "../src/lib/shop-local/page-state.js";
import { indexRecord } from "../src/lib/shop-diverse/clean.js";

const TODAY = "2026-11-02";
const q = (s) => normalizeQuery(new URLSearchParams(s)).query;
const ZIPS = { "11216": [40.6805, -73.9493], "11225": [40.6629, -73.9541], "10001": [40.7507, -73.9971], "11105": [40.7788, -73.9063] };

const vendor = (over) => ({
  id: "1", name: "Acme", certs: ["WBE"], title: "Full-Service Restaurants", sector: "Accommodation and Food Services",
  borough: "Brooklyn", city: "Brooklyn", state: "NY", zip: "11216", excerpt: "A family restaurant serving Caribbean food.",
  ...over
});

test("every NAICS title maps to one category, and labels are plain", () => {
  const seen = new Set();
  for (const c of CATEGORIES) for (const t of c.titles) {
    assert.ok(!seen.has(t.title) || KINDS.get(t.title).cat === c.key, `${t.title} is in two categories`);
    seen.add(t.title);
    assert.ok(t.label && t.label.length < 45);
  }
  assert.deepEqual(kindOf({ title: "Beauty Salons" }), { cat: "beauty", label: "Hair or beauty salon", walk: true });
  assert.equal(kindOf({ title: "Commercial and Institutional Building Construction" }), null);
  assert.equal(kindOf({ title: "All Other Personal Services" }), null);
  assert.equal(KINDS.get("Child Care Services").walk, false);
});

test("normalizeQuery keeps known values and makes equal URLs", () => {
  assert.deepEqual(q("what=eat&own=black,women,martian&near=11216&boro=queens&page=2"),
    { what: "eat", own: ["women", "black"], q: "", near: "11216", boro: "", outside: false, page: 2 });
  assert.equal(q("what=nope").what, "");
  // A ZIP outside NYC is dropped
  assert.equal(q("near=07030").near, "");
  // A borough turns off "outside NYC"
  assert.equal(q("boro=bronx&outside=1").outside, false);
  assert.equal(queryToParams(q("own=black&own=women&what=eat")).toString(), "what=eat&own=women%2Cblack");
  assert.match(normalizeQuery(new URLSearchParams({ q: "x".repeat(61) })).error, /under 60/);
});

test("owners and place names", () => {
  assert.deepEqual(ownersOf({ certs: ["WBE", "MBE"], ethnicity: "Black" }), ["women", "black"]);
  assert.deepEqual(ownerLabels({ certs: ["WBE", "MBE"], ethnicity: "Hispanic" }), ["Women-owned", "Hispanic-owned"]);
  assert.deepEqual(ownerLabels({ certs: ["MBE"], ethnicity: null }), ["Minority-owned"]);
  assert.deepEqual(ownerLabels({ certs: ["WBE"], ethnicity: "Non-minority" }), ["Women-owned"]);
  assert.equal(placeName({ borough: "Queens", city: "Astoria" }), "Astoria, Queens");
  assert.equal(placeName({ borough: "Manhattan", city: "New York" }), "Manhattan");
  assert.equal(placeName({ borough: "Staten Island", city: "Staten Is" }), "Staten Island");
  assert.equal(placeName({ city: "Newark", state: "NJ" }), "Newark, NJ");
});

test("searchLocal keeps resident businesses in NYC with current certifications", () => {
  const vendors = [
    vendor({ id: "1" }),
    vendor({ id: "2", title: "Engineering Services" }),
    vendor({ id: "3", borough: undefined, city: "Newark", state: "NJ", zip: "07102" }),
    vendor({ id: "4", renewals: ["2025-01-01"], certs: ["MBE"], ethnicity: "Black" }),
    vendor({ id: "5", title: "Beauty Salons", certs: ["MBE"], ethnicity: "Black", zip: "11225" })
  ];
  const d = searchLocal(vendors, q(""), { today: TODAY, zips: ZIPS });
  assert.deepEqual(d.results.map((r) => r.id).sort(), ["1", "5"]);
  assert.equal(d.all, 2);
  assert.equal(d.facets.outside, 1);
  assert.equal(d.facets.what.eat, 1);
  assert.equal(d.facets.what.beauty, 1);
  assert.equal(searchLocal(vendors, q("outside=1"), { today: TODAY, zips: ZIPS }).total, 3);
  // Facets follow the other filters, not their own
  const black = searchLocal(vendors, q("own=black"), { today: TODAY, zips: ZIPS });
  assert.deepEqual(black.results.map((r) => r.id), ["5"]);
  assert.equal(black.facets.own.women, 1);
  assert.equal(black.facets.what.eat, 0);
});

test("a ZIP sorts nearest first, with distances", () => {
  const vendors = [
    vendor({ id: "far", zip: "10001", borough: "Manhattan", city: "New York" }),
    vendor({ id: "near", zip: "11225" }),
    vendor({ id: "same", zip: "11216" }),
    vendor({ id: "nozip", zip: "11299" })
  ];
  const d = searchLocal(vendors, q("near=11216"), { today: TODAY, zips: ZIPS });
  assert.deepEqual(d.results.map((r) => r.id), ["same", "near", "far", "nozip"]);
  assert.equal(d.results[0].miles, 0);
  assert.ok(d.results[1].miles > 1 && d.results[1].miles < 2);
  assert.equal(d.results[3].miles, undefined);
});

test("places customers visit rank ahead of contractors, after distance", () => {
  const electrician = vendor({ id: "1", title: "Electrical Contractors and Other Wiring Installation Contractors", website: "https://a.example.com", phone: { tel: "+17185550100" } });
  const salon = vendor({ id: "2", title: "Beauty Salons" });
  const ids = (vendors, s) => searchLocal(vendors, q(s), { today: TODAY, zips: ZIPS }).results.map((r) => r.id);
  assert.deepEqual(ids([electrician, salon], ""), ["2", "1"], "a salon with no website beats an electrician with one");
  const farSalon = { ...salon, zip: "10001", borough: "Manhattan", city: "New York" };
  assert.deepEqual(ids([electrician, farSalon], "near=11216"), ["1", "2"], "distance still comes first");
});

test("cards show the street only for walk-in businesses", () => {
  const vendors = [
    vendor({ id: "1", address1: "12 Nostrand Ave" }),
    vendor({ id: "2", title: "Child Care Services", address1: "99 Home St", phone: { tel: "+17185550100" } })
  ];
  const [a, b] = searchLocal(vendors, q("near=11216"), { today: TODAY, zips: ZIPS }).results.sort((x, y) => x.id.localeCompare(y.id));
  assert.equal(a.street, "12 Nostrand Ave");
  assert.equal(b.street, undefined);
  const html = cardsHtml([a, b], (id) => `/shop-local/?biz=${id}`);
  assert.match(html, /Directions<span class="sr-only"> Acme/);
  assert.equal((html.match(/Directions/g) ?? []).length, 1);
  assert.match(html, /href="tel:\+17185550100"/);
  assert.doesNotMatch(html, /99 Home St/);
  assert.match(html, /In your ZIP/);
});

test("indexRecord keeps the street only when asked", () => {
  const v = { id: "1", name: "A", address1: "1 Main St", address2: "Fl 2", description: "" };
  assert.equal(indexRecord(v).address1, undefined);
  assert.equal(indexRecord(v, { street: true }).address2, "Fl 2");
});

test("localDetail leaves out procurement fields and home addresses", () => {
  const full = vendor({
    id: "9", dba: "Acme Kitchen", contact: "Jane Doe", bonding: 1e6, nigp: ["91800"], naics: "722511",
    address1: "12 Nostrand Ave", phone: { display: "(718) 555-0100", tel: "+17185550100" },
    description: "We cook.", established: "2011-05-01", renewals: ["2027-03-31"], jobs: [{ client: "DOE" }]
  });
  const d = localDetail(full, TODAY);
  assert.equal(d.name, "Acme Kitchen");
  assert.equal(d.legalName, "Acme");
  assert.equal(d.street, "12 Nostrand Ave");
  assert.equal(d.since, "2011");
  assert.equal(d.years, 15);
  for (const k of ["contact", "bonding", "nigp", "naics", "jobs"]) assert.equal(d[k], undefined);
  assert.equal(localDetail({ ...full, title: "Child Care Services" }, TODAY).street, undefined);
  assert.equal(localDetail({ ...full, title: "Engineering Services" }, TODAY), null);
  assert.equal(localDetail({ ...full, renewals: ["2025-01-01"] }, TODAY), null);
  const html = detailHtml(localDetail({ ...full, title: "Child Care Services" }, TODAY));
  assert.match(html, /don’t show the street/);
  assert.doesNotMatch(html, /Nostrand/);
  assert.match(businessMeta(d).description, /^Acme Kitchen: restaurant in Brooklyn\. Women-owned/);
  assert.match(businessMeta({ ...d, kind: "Accountant (CPA)", place: "" }).description, /^Acme Kitchen: accountant \(CPA\)\./);
  const outside = detailHtml({ ...d, place: "Bloomfield, NJ", zip: "07003" });
  assert.match(outside, /Bloomfield, NJ 07003/);
  assert.doesNotMatch(outside, /NJ, NY/);
});

test("text helpers", () => {
  assert.equal(distanceText(0), "In your ZIP");
  assert.equal(distanceText(1.44), "About 1.4 mi away");
  assert.equal(distanceText(12.6), "About 13 mi away");
  assert.equal(distanceText(null), "");
  assert.equal(statusText({ total: 38, pages: 2, page: 1 }, q("near=11216")), "38 businesses · nearest to 11216 first · page 1 of 2");
  assert.equal(statusText({ total: 1, pages: 1, page: 1 }, q("boro=queens"), "Queens"), "1 business in Queens");
  assert.equal(statusText({ total: 0 }, q("")), "No matches.");
  assert.equal(placeLine("Astoria, Queens", "11105"), "Astoria, Queens, NY 11105");
  assert.equal(placeLine("Bloomfield, NJ", "07003"), "Bloomfield, NJ 07003");
});

test("page state", () => {
  assert.equal(pageUrl(q("")), "/shop-local/");
  assert.equal(pageUrl(q("what=eat"), { biz: "12" }), "/shop-local/?what=eat&biz=12");
  assert.equal(formQuery([["near", "112"], ["what", "eat"]]).query.near, "");
  assert.equal(formQuery([["near", "11216"], ["boro", "queens"]]).query.boro, "");
  assert.equal(zipState(""), "");
  assert.equal(zipState("112"), "short");
  assert.equal(zipState("07030"), "outside");
  assert.equal(zipState("11216"), "ok");
  assert.equal(nearestZip(40.681, -73.95, ZIPS), "11216");
  const state = { query: q("what=eat"), currentId: null, dialogOpen: false };
  assert.deepEqual(popstateAction("?what=eat&biz=5", state), { query: null, open: "5", close: false });
  assert.equal(popstateAction("?what=shop", state).query.what, "shop");
  assert.equal(closeAction("?biz=5", { fromList: true }), "back");
  assert.equal(closeAction("?biz=5", null), "replace");
  assert.equal(closeAction("", null), null);
  assert.equal(startQuery({ query: q("what=eat"), loaded: true }, q("what=eat")), null);
  assert.equal(startQuery({ query: q("what=eat"), loaded: true }, q("what=shop")).what, "shop");
});
