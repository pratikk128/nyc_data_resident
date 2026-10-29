/*
 * Shop Diverse NYC logic: cleaning the SBS rows (names, phones, websites,
 * ZIPs, boroughs, dates), the Recommended ranking and the other sorts, and
 * the filters, counts and URL round-trip.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  titleCase, businessName, phone, website, zip, boroughFromZip, certifications, renewalDates, pastDate, ethnicity,
  cleanVendor, indexRecord, keywordWords, extraWords, excerpt
} from "../src/lib/shop-diverse/clean.js";
import {
  POINTS, certStatus, yearsInBusiness, haystack, keywordMatch, scoreBusiness, tieBreak, rankBusinesses
} from "../src/lib/shop-diverse/ranking.js";
import { normalizeQuery, queryToParams, searchBusinesses, outsideShare } from "../src/lib/shop-diverse/filter.js";
import { contactText, mapsUrl, detailHtml, kpisHtml } from "../src/lib/shop-diverse/render.js";

const TODAY = "2026-10-28";
const q = (s = "") => normalizeQuery(new URLSearchParams(s)).query;

// ---------- Cleaning ----------

test("names: junk prefixes go, shouting is title-cased, mixed case is left alone", () => {
  assert.equal(businessName("=---T. M. Kilduff Consulting, Inc."), "T. M. Kilduff Consulting, Inc.");
  assert.equal(businessName("ACME PLUMBING OF NY, LLC"), "Acme Plumbing of NY, LLC");
  assert.equal(businessName("O'BRIEN & SONS HVAC"), "O'Brien & Sons HVAC");
  assert.equal(businessName("JOE'S DELI"), "Joe's Deli");
  assert.equal(businessName("iHeart Media"), "iHeart Media");
  assert.equal(businessName("  N/A "), "");
  assert.equal(businessName("“I AM” EHS Management LLC"), "I AM EHS Management LLC");
  assert.equal(businessName("\"Bright Star\" Cleaning"), "Bright Star Cleaning");
  assert.equal(businessName("“Unclosed Inc"), "Unclosed Inc");
  assert.equal(titleCase("THE BEST OF THE BRONX"), "The Best of the Bronx");
  assert.equal(titleCase("720 ST. MARKS AVENUE, 5G"), "720 St. Marks Avenue, 5G", "apartment numbers keep their letter upper-case");
  assert.equal(titleCase("1ST CLASS 3D PRINTING ON 41ST"), "1st Class 3D Printing on 41st");
});

test("phones: ten digits are formatted with a tel: link; anything else is shown as written", () => {
  assert.deepEqual(phone("718.740.8400"), { display: "(718) 740-8400", tel: "+17187408400" });
  assert.deepEqual(phone("718 8159200"), { display: "(718) 815-9200", tel: "+17188159200" });
  assert.deepEqual(phone("1-212-555-0100"), { display: "(212) 555-0100", tel: "+12125550100" });
  assert.deepEqual(phone("555-0100"), { display: "555-0100", tel: null });
  assert.equal(phone(""), null);
});

test("websites: the scheme is kept, https:// added to bare ones, placeholders and company names dropped", () => {
  assert.equal(website("www.example.com"), "https://www.example.com");
  assert.equal(website("http://www.IAMEHS.com"), "http://www.iamehs.com", "an http-only site would break behind https");
  assert.equal(website("HTTPS://DJPINDUTRIAL.COM/"), "https://djpindutrial.com");
  assert.equal(website("https://example.org/about-us"), "https://example.org/about-us");
  assert.equal(website("N/A"), null);
  assert.equal(website("http://Under Construction"), null);
  assert.equal(website("http://A & E Contracting of NY, Inc"), null);
  assert.equal(website("http://Baanyan"), null);
});

test("ZIPs get their leading zero back; boroughs come from NYC ZIPs only", () => {
  assert.equal(zip("7724"), "07724");
  assert.equal(zip("10009"), "10009");
  assert.equal(zip("112161234"), "11216");
  assert.equal(zip(""), "");
  assert.equal(boroughFromZip("10009"), "Manhattan");
  assert.equal(boroughFromZip("11216"), "Brooklyn");
  assert.equal(boroughFromZip("11101"), "Queens");
  assert.equal(boroughFromZip("11004"), "Queens");
  assert.equal(boroughFromZip("11003"), null); // Elmont, Nassau
  assert.equal(boroughFromZip("11550"), null); // Hempstead
  assert.equal(boroughFromZip("10314"), "Staten Island");
  assert.equal(boroughFromZip("10451"), "Bronx");
});

test("certifications, renewal dates, establishment dates and ethnicity", () => {
  assert.deepEqual(certifications("MBE,WBE"), ["WBE", "MBE"]);
  assert.deepEqual(certifications("MBE,WBE,EBE"), ["WBE", "MBE", "EBE"]);
  assert.deepEqual(renewalDates("11/30/2026;11/30/2026"), ["2026-11-30"]);
  assert.deepEqual(renewalDates("3/31/2029"), ["2029-03-31"]);
  assert.deepEqual(renewalDates(""), []);
  assert.equal(pastDate("2014-12-16T00:00:00.000", TODAY), "2014-12-16");
  assert.equal(pastDate("2996-07-19T00:00:00.000", TODAY), null);
  assert.equal(ethnicity("NATIVE AMERICAN"), "Native American");
  assert.equal(ethnicity("NON-MINORITY"), "Non-minority");
  assert.equal(ethnicity("/A"), null);
});

const ROW = {
  account_number: "377031", vendor_formal_name: "000 Architecture PLLC", vendor_dba: "000 ARCHITECTURE PLLC",
  first_name: "Jedy", last_name: "Lau", telephone: "2012561092", business_description: "000 Architecture PLLC is an architectural studio.",
  certification: "MBE", cert_renewal_date: "3/31/2030", ethnicity: "ASIAN", address1: "616 E9th Street", address2: "Storefront East",
  city: "New York", state: "NY", zip: "10009", website: "N/A", date_of_establishment: "2023-07-05T00:00:00.000",
  id6_digit_naics_code: "541310", naics_sector: "Professional, Scientific, and Technical Services",
  naics_subsector: "Architectural, Engineering, and Related Services", naics_title: "Architectural Services",
  nigp_codes: "90600 | 90700", name_of_client_job_exp_1: "One Nest LLC", largest_value_of_contract: "140000",
  percent_self_performed_job_exp_1: "100", date_of_work_job_exp_1: "2023-08-02T00:00:00.000",
  aggregate_bonding_limit: "0", enrolled_in_passport: "Yes", borough: "MANHATTAN"
};

test("cleanVendor: a full row, with empty fields left out", () => {
  const v = cleanVendor(ROW, TODAY);
  assert.equal(v.id, "377031");
  assert.equal(v.dba, undefined, "a DBA that repeats the legal name is dropped");
  assert.equal(v.website, undefined, "N/A isn't a website");
  assert.equal(v.bonding, undefined, "a zero bonding limit isn't shown");
  assert.equal(v.borough, "Manhattan");
  assert.deepEqual(v.nigp, ["90600", "90700"]);
  assert.deepEqual(v.jobs, [{ client: "One Nest LLC", value: 140000, selfPerformed: 100, date: "2023-08-02" }]);
  assert.equal(v.largestContract, 140000);
  assert.equal(v.passport, true);
  assert.equal(v.contact, "Jedy Lau");
  assert.equal(cleanVendor({ account_number: "1" }, TODAY), null);
});

test("cleanVendor: a NY address with no borough gets one from its ZIP; out of state stays outside", () => {
  assert.equal(cleanVendor({ ...ROW, borough: "", zip: "11216" }, TODAY).borough, "Brooklyn");
  assert.equal(cleanVendor({ ...ROW, borough: "", zip: "7724", state: "NJ" }, TODAY).borough, undefined);
  assert.equal(cleanVendor({ ...ROW, borough: "STATEN IS" }, TODAY).borough, "Staten Island");
});

test("indexRecord keeps only what search and cards need", () => {
  const idx = indexRecord(cleanVendor(ROW, TODAY));
  assert.equal(idx.contact, undefined);
  assert.equal(idx.jobs, undefined);
  assert.deepEqual(idx.phone, { tel: "+12012561092" });
  assert.equal(idx.title, "Architectural Services");
  assert.equal(idx.description, undefined, "the full description stays out of the index");
  assert.equal(idx.excerpt, "000 Architecture PLLC is an architectural studio.");
  assert.equal(idx.keywords, undefined, "every word is in the excerpt");
});

test("a long description is searchable past its excerpt, each extra word kept once", () => {
  const description = `${"Tile setting and repair. ".repeat(8)}We also do grout work, grout sealing and stone floors.`;
  const idx = indexRecord(cleanVendor({ ...ROW, business_description: description }, TODAY));
  assert.ok(idx.excerpt.length <= 161);
  assert.equal(idx.keywords, "WE ALSO DO GROUT WORK SEALING STONE FLOORS");
  assert.equal(extraWords("Tile, tile and more TILE.", "Tile"), "AND MORE");
  assert.equal(keywordMatch(keywordWords("stone floor"), haystack(idx)), "description");
  assert.equal(keywordMatch(keywordWords("tile repair"), haystack(idx)), "description");
});

// ---------- Ranking ----------

const biz = (over = {}) => ({
  id: "1", name: "Example LLC", certs: ["WBE"], sector: "Construction", subsector: "Specialty Trade Contractors",
  title: "Plumbing, Heating, and Air-Conditioning Contractors", excerpt: "x".repeat(60), ...over
});

test("certification currency: past dates are lapsed, no date isn't", () => {
  assert.equal(certStatus(biz({ renewals: ["2027-01-31"] }), TODAY), "current");
  assert.equal(certStatus(biz({ renewals: ["2026-10-28"] }), TODAY), "current");
  assert.equal(certStatus(biz({ renewals: ["2026-09-30"] }), TODAY), "lapsed");
  assert.equal(certStatus(biz({ renewals: ["2026-09-30", "2027-09-30"] }), TODAY), "current");
  assert.equal(certStatus(biz(), TODAY), "undated");
});

test("certification currency doesn't score: undated (every WBE-only firm), current and lapsed are equal", () => {
  const undated = scoreBusiness(biz(), { today: TODAY }).score;
  const current = scoreBusiness(biz({ renewals: ["2030-01-31"] }), { today: TODAY }).score;
  const lapsed = scoreBusiness(biz({ renewals: ["2026-01-31"] }), { today: TODAY }).score;
  assert.equal(undated, current);
  assert.equal(lapsed, current);
});

test("years in business count whole years, capped for points", () => {
  assert.equal(yearsInBusiness("2014-12-16", TODAY), 11);
  assert.equal(yearsInBusiness("2025-10-29", TODAY), 0);
  assert.equal(yearsInBusiness(null, TODAY), null);
  const old = scoreBusiness(biz({ established: "1950-01-01" }), { today: TODAY }).parts.experience;
  assert.equal(old, POINTS.maxYearsCounted * POINTS.perYearInBusiness);
});

test("keyword match: industry beats name beats description", () => {
  const words = keywordWords("plumb");
  assert.equal(keywordMatch(words, haystack(biz())), "industry");
  assert.equal(keywordMatch(words, haystack(biz({ title: "Painting", subsector: "", sector: "", name: "Plumbers R Us" }))), "name");
  assert.equal(keywordMatch(words, haystack(biz({ title: "Painting", subsector: "", sector: "", excerpt: "We also do plumbing." }))), "description");
  assert.equal(keywordMatch(keywordWords("bakery"), haystack(biz())), null);
  assert.equal(keywordMatch(keywordWords("joe’s"), haystack(biz({ name: "JOES PLUMBING" }))), "name");
  const score = (match) => scoreBusiness(biz(), { today: TODAY, match }).score;
  assert.ok(score("industry") > score("name"));
  assert.ok(score("name") > score("description"));
});

test("keyword: plurals and -er/-ing forms find each other", () => {
  const same = [["plumber", "plumbing", "plumbers"], ["bakery", "bakeries", "bakers"], ["catering", "caterers"], ["supplies", "supplier"]];
  for (const forms of same) assert.equal(new Set(forms.map((w) => keywordWords(w).join())).size, 1, forms.join());
  assert.deepEqual(keywordWords("boxes tiles shipping staffing"), ["BOX", "TILE", "SHIP", "STAFF"]);
  assert.deepEqual(keywordWords("bus 3d it"), ["BUS", "3D", "IT"]);
  for (const w of ["plumber", "plumbing"]) assert.equal(keywordMatch(keywordWords(w), haystack(biz())), "industry");
  assert.equal(keywordMatch(keywordWords("bakeries"), haystack(biz({ name: "Sweet Bakery" }))), "name");
});

test("picking a subcategory scores above a category, above neither", () => {
  const s = (query) => scoreBusiness(biz(), { today: TODAY, query }).score;
  assert.ok(s({ cat: "Construction", sub: "Specialty Trade Contractors" }) > s({ cat: "Construction" }));
  assert.ok(s({ cat: "Construction" }) > s({}));
});

test("reachability: website, a real description and a phone each add points", () => {
  const bare = biz({ excerpt: "Short." });
  const s = (r) => scoreBusiness(r, { today: TODAY }).score;
  assert.equal(s({ ...bare, website: "https://a.com" }) - s(bare), POINTS.website);
  assert.equal(s({ ...bare, excerpt: "y".repeat(40) }) - s(bare), POINTS.description);
  assert.equal(s({ ...bare, phone: { tel: "+12125550100" } }) - s(bare), POINTS.phone);
  assert.equal(s({ ...bare, phone: { tel: null } }), s(bare), "an unusable number doesn't count");
});

test("the MBE+WBE bonus applies only when the visitor asked for both", () => {
  const dual = biz({ certs: ["WBE", "MBE"] });
  const single = biz({ certs: ["WBE"] });
  const s = (r, who) => scoreBusiness(r, { today: TODAY, query: { who } }).score;
  assert.equal(s(dual, ["WBE"]), s(single, ["WBE"]));
  assert.equal(s(dual, []), s(single, []));
  assert.equal(s(dual, ["WBE", "MBE"]) - s(single, ["WBE", "MBE"]), POINTS.bothMbeWbe);
});

test("ethnicity never changes the score", () => {
  const s = (eth) => scoreBusiness(biz({ certs: ["MBE"], ethnicity: eth }), { today: TODAY, query: { who: ["MBE"] } }).score;
  assert.equal(s("Black"), s("Asian"));
  assert.equal(s("Hispanic"), s("Native American"));
});

test("a business in the five boroughs scores above one elsewhere, but not above a better keyword match", () => {
  const s = (r, match = null) => scoreBusiness(r, { today: TODAY, match }).score;
  const local = biz({ borough: "Queens" });
  const away = biz({ city: "Newark", state: "NJ" });
  assert.equal(s(local) - s(away), POINTS.inNyc);
  assert.ok(s(away, "industry") > s(local, "description"));
});

test("keywords of one or two letters match whole words only", () => {
  const hay = (name) => haystack(biz({ name, title: "Painting", subsector: "", sector: "" }));
  assert.equal(keywordMatch(keywordWords("it"), hay("ProTech IT Group")), "name");
  assert.equal(keywordMatch(keywordWords("it"), hay("Items Galore")), null);
  assert.equal(keywordMatch(keywordWords("3d"), hay("3D Printing Co")), "name");
  assert.equal(keywordMatch(keywordWords("it support"), hay("Supporting IT")), "name");
});

test("ZIP anchor: same ZIP, then same borough", () => {
  const s = (r) => scoreBusiness(r, { today: TODAY, query: { zip: "11216" }, zipBorough: "Brooklyn" }).score;
  const base = s(biz({ zip: "10009", borough: "Manhattan" }));
  assert.equal(s(biz({ zip: "11216", borough: "Brooklyn" })) - base, POINTS.sameZip);
  assert.equal(s(biz({ zip: "11201", borough: "Brooklyn" })) - base, POINTS.sameBorough);
});

test("ties: stable for a seed, different across seeds", () => {
  assert.equal(tieBreak("123", "2026-10-28"), tieBreak("123", "2026-10-28"));
  const ids = Array.from({ length: 30 }, (_, i) => biz({ id: String(i) }));
  const order = (seed) => rankBusinesses(ids.map((record) => ({ record, match: null })), { today: TODAY, seed }).map((r) => r.record.id).join();
  assert.equal(order("2026-10-28"), order("2026-10-28"));
  assert.notEqual(order("2026-10-28"), order("2026-10-29"));
});

test("sorts: lapsed always last; A–Z by display name; dates with blanks last", () => {
  const items = [
    biz({ id: "a", name: "Zeta", established: "2001-01-01" }),
    biz({ id: "b", name: "Alpha", dba: "Mu Bakery", established: "2020-01-01" }),
    biz({ id: "c", name: "Beta" }),
    biz({ id: "d", name: "Aardvark", renewals: ["2020-01-01"], established: "2024-01-01" })
  ].map((record) => ({ record, match: null }));
  const ids = (sort) => rankBusinesses(items, { sort, today: TODAY }).map((r) => r.record.id).join("");
  assert.equal(ids("az"), "cbad");
  assert.equal(ids("newest"), "bacd");
  assert.equal(ids("oldest"), "abcd");
  assert.equal(ids("recommended").at(-1), "d");
});

// ---------- Filters ----------

const VENDORS = [
  biz({ id: "1", name: "Plumb One", certs: ["WBE"], ethnicity: "Non-minority", borough: "Brooklyn", zip: "11216" }),
  biz({ id: "2", name: "Plumb Two", certs: ["MBE"], ethnicity: "Black", borough: "Queens", zip: "11101" }),
  biz({ id: "3", name: "Dual Bakers", certs: ["WBE", "MBE"], ethnicity: "Asian", sector: "Manufacturing", subsector: "Food Manufacturing", title: "Retail Bakeries" }),
  biz({ id: "4", name: "Lapsed Co", certs: ["MBE"], ethnicity: "Hispanic", renewals: ["2026-01-31"], borough: "Bronx" }),
  biz({ id: "5", name: "Emerging Only", certs: ["EBE"], borough: "Manhattan" })
];
const ids = (data) => data.results.map((r) => r.id).sort().join("");

test("who: WBE, MBE, either or both; ethnicity narrows the MBE side only", () => {
  const run = (s) => searchBusinesses(VENDORS, q(s), { today: TODAY });
  assert.equal(ids(run("")), "1235");
  assert.equal(ids(run("who=wbe")), "13");
  assert.equal(ids(run("who=mbe")), "23");
  assert.equal(ids(run("who=wbe,mbe")), "123");
  assert.equal(ids(run("who=wbe,mbe&match=all")), "3");
  assert.equal(ids(run("who=mbe&eth=black")), "2");
  assert.equal(ids(run("who=wbe,mbe&eth=black")), "123", "WBE firms stay (3 is WBE too); the MBE side is narrowed");
  assert.equal(ids(run("who=wbe,mbe&match=all&eth=black")), "", "both, with a Black owner: none here");
  assert.equal(ids(run("who=wbe&who=mbe")), "123", "a plain form GET repeats the name");
});

test("lapsed certifications are hidden unless asked for, and counted", () => {
  const hidden = searchBusinesses(VENDORS, q("who=mbe"), { today: TODAY });
  assert.equal(hidden.facets.lapsed, 1);
  const shown = searchBusinesses(VENDORS, q("who=mbe&lapsed=1"), { today: TODAY });
  assert.equal(ids(shown), "234");
  assert.equal(shown.results.at(-1).id, "4");
  assert.equal(shown.results.at(-1).lapsed, true);
});

test("facet counts follow the other filters but not their own", () => {
  const data = searchBusinesses(VENDORS, q("cat=Construction&who=wbe"), { today: TODAY });
  assert.equal(ids(data), "1");
  assert.deepEqual(data.facets.categories, [{ label: "Construction", count: 1 }, { label: "Manufacturing", count: 1 }]);
  assert.deepEqual(data.facets.who, { WBE: 1, MBE: 1 }); // Construction: firm 1 (WBE), firm 2 (MBE); lapsed 4 hidden
  assert.deepEqual(data.facets.subcategories, [{ label: "Specialty Trade Contractors", count: 1 }]);
  const brooklyn = data.facets.boroughs.find((b) => b.slug === "brooklyn");
  assert.equal(brooklyn.count, 1);
  const eth = Object.fromEntries(searchBusinesses(VENDORS, q("who=mbe&eth=black"), { today: TODAY }).facets.eth.map((e) => [e.label, e.count]));
  assert.deepEqual(eth, { Black: 1, Asian: 1, Hispanic: 0, "Native American": 0 });
});

test("keyword, borough and outside NYC", () => {
  const run = (s) => searchBusinesses(VENDORS, q(s), { today: TODAY });
  assert.equal(ids(run("q=bakeries")), "3");
  assert.equal(ids(run("q=plumb&boro=queens")), "2");
  assert.equal(ids(run("boro=outside")), "3");
  assert.equal(run("q=plumb").results[0].id !== "3", true);
});

test("summary numbers", () => {
  const data = searchBusinesses(VENDORS, q(""), { today: TODAY });
  assert.deepEqual(data.kpis, { total: 4, wbe: 2, mbe: 2, both: 1, outside: 1 });
});

test("summary chips: \"both\" only without a single certification, \"outside NYC\" only without a borough", () => {
  const k = { total: 4, wbe: 2, mbe: 2, both: 1, outside: 1 };
  assert.match(kpisHtml(k, q("")), /both<\/span>.*outside NYC/);
  assert.match(kpisHtml(k, q("who=wbe,mbe")), /both/);
  assert.doesNotMatch(kpisHtml(k, q("who=wbe")), /both/);
  assert.doesNotMatch(kpisHtml(k, q("boro=outside")), /outside NYC/);
  assert.doesNotMatch(kpisHtml(k, q("")), /borough/);
});

test("paging: pages of the given size, and a page past the end is clamped", () => {
  const data = searchBusinesses(VENDORS, q("page=9"), { today: TODAY, pageSize: 3 });
  assert.equal(data.pages, 2);
  assert.equal(data.page, 2);
  assert.equal(data.results.length, 1);
});

test("URL round-trip: equal queries make equal URLs, defaults are left out", () => {
  const a = q("who=mbe,wbe&eth=asian,black&cat=Construction&sort=az&page=2");
  assert.equal(queryToParams(a).toString(), "who=wbe%2Cmbe&eth=asian%2Cblack&cat=Construction&sort=az&page=2");
  assert.deepEqual(q(queryToParams(a).toString()), a);
  assert.equal(queryToParams(q("")).toString(), "");
  assert.equal(queryToParams(q("who=wbe&eth=black&match=all")).toString(), "who=wbe", "ethnicity needs MBE; match needs both");
  assert.equal(q("sub=Food").sub, "", "a subcategory needs a category");
  assert.equal(queryToParams(q("zip=11216&sort=az")).toString(), "sort=az", "a ZIP only applies to Recommended");
  assert.equal(q("zip=11216").zip, "11216");
  assert.ok(normalizeQuery(new URLSearchParams(`q=${"a".repeat(200)}`)).error);
});

test("excerpt cuts at a word", () => {
  const long = "word ".repeat(60);
  const e = excerpt(long);
  assert.ok(e.length <= 161);
  assert.ok(e.endsWith("word…"));
  assert.equal(excerpt("Short."), "Short.");
});

// ---------- Detail ----------

test("detail: contact text, maps link, and no empty rows", () => {
  const v = { ...cleanVendor(ROW, TODAY), status: "current", years: 3 };
  assert.equal(contactText(v), "000 Architecture PLLC\nContact: Jedy Lau\n(201) 256-1092\n616 E9th Street, Storefront East\nNew York, NY 10009");
  assert.match(mapsUrl(v), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=616%20E9th/);
  const html = detailHtml(v);
  assert.match(html, /href="tel:\+12012561092"/);
  assert.doesNotMatch(html, /Website|Bonding|null|undefined|N\/A/);
  assert.match(html, /3 years in business/);
});

test("detail: a certification with no renewal date says so", () => {
  const v = { ...cleanVendor(ROW, TODAY), certs: ["WBE"], renewals: undefined, status: "undated" };
  assert.match(detailHtml(v), /No renewal date on file/);
  assert.doesNotMatch(detailHtml({ ...v, renewals: ["2030-01-31"], status: "current" }), /No renewal date/);
});

test("outsideShare counts businesses with no borough", () => {
  assert.equal(outsideShare([{ borough: "Queens" }, {}, { borough: "Bronx" }, {}]), 0.5);
  assert.equal(outsideShare([]), null);
});
