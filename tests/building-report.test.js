/*
 * Building Report Card logic (src/lib/building-report/): the key formats
 * each dataset needs, the counting rules, and what an empty building says.
 * Rows are shaped like Socrata's answers (numbers as strings).
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isBbl, bblParts, dobCategoryLabel, buildingPath, SECTIONS } from "../src/lib/building-report/config.js";
import {
  yearAgo, monthsBack, violationsQueries, complaintsQueries, flagsQueries, registrationQuery, contactsQuery, dobQueries, lotQueries
} from "../src/lib/building-report/soql.js";
import {
  dobDate, ecbDate, plainViolation, summarizeLot, summarizeViolations, summarizeComplaints, summarizeBedbugs,
  summarizeFlags, summarizeRepairs, summarizeLandlord, summarizeDob, lastMonths, lotName
} from "../src/lib/building-report/summarize.js";
import {
  violationsGlance, violationsHtml, complaintsHtml, bedbugsHtml, bedbugsGlance, flagsGlance, landlordHtml, repairsHtml, columnsHtml, severityLabel
} from "../src/lib/building-report/render.js";
import { findBuilding } from "../src/lib/building-report/lookup.js";
import { normalizeFeature } from "../src/lib/complaints311/geocode.js";

const TODAY = "2026-11-02";
const LOT = { bbl: "2031070036", boro: 2, block: 3107, lot: 36, bins: ["2012951", "2098283"], hpd: true };

test("BBLs: ten digits, borough 1–5; split into borough, block and lot", () => {
  assert.ok(isBbl("2031070036"));
  assert.ok(!isBbl("6031070036"));
  assert.ok(!isBbl("203107003"));
  assert.ok(!isBbl("1000000000"));
  assert.ok(!isBbl("1000010000"));
  assert.ok(isBbl("1000010001"));
  assert.ok(!isBbl("2031070036' OR 1=1"));
  assert.deepEqual(bblParts("1001007502"), { boro: 1, block: 100, lot: 7502 });
  assert.equal(buildingPath("2031070036"), "/building-report/?bbl=2031070036");
});

test("each dataset gets the bbl in its own format", () => {
  assert.match(violationsQueries(LOT, TODAY).ever.params.$where, /^bbl = '2031070036'$/);
  assert.match(complaintsQueries(LOT, TODAY).ever.params.$where, /^bbl = 2031070036$/);
  assert.match(flagsQueries(LOT).vacate.params.$where, /^bbl = 2031070036$/);
  assert.match(flagsQueries(LOT).pendingCases.params.$where, /^bbl = '2031070036' AND casestatus = 'PENDING'$/);
  // Registrations have no bbl column.
  assert.equal(registrationQuery(LOT).params.$where, "boroid = 2 AND block = 3107 AND lot = 36");
  assert.equal(contactsQuery(["203139", "1"]).params.$where, "registrationid in (203139, 1)");
  assert.match(dobQueries(LOT, TODAY).complaints.params.$where, /^bin in \('2012951', '2098283'\)/);
  const lot = lotQueries("1001007502", bblParts("1001007502"));
  assert.equal(lot.footprints.params.$where, "base_bbl = '1001007502' OR mappluto_bbl = '1001007502'");
});

test("the open-violations list sorts undated rows last (the fast form of the query)", () => {
  assert.equal(violationsQueries(LOT, TODAY).recentOpen.params.$order, "novissueddate DESC NULL LAST, violationid DESC");
  assert.equal(violationsQueries(LOT, TODAY).openByClass.params.$where, "bbl = '2031070036' AND violationstatus = 'Open'");
});

test("date windows: last 12 months, 12 calendar months, DOB's text dates", () => {
  assert.equal(yearAgo(TODAY), "2025-11-02");
  assert.equal(monthsBack(TODAY), "2025-12-01");
  assert.deepEqual(lastMonths(TODAY).slice(0, 2), ["2025-12", "2026-01"]);
  assert.equal(lastMonths(TODAY).at(-1), "2026-11");
  assert.equal(dobDate("07/09/2026"), "2026-07-09");
  assert.equal(dobDate("2026-07-09"), null);
  assert.equal(ecbDate("20260711"), "2026-07-11");
  assert.match(dobQueries(LOT, TODAY).complaints.params.$where, /like '%\/2026' OR date_entered like '%\/2025'/);
});

test("DOB categories decode, padded; unknown codes say so", () => {
  assert.equal(dobCategoryLabel("05"), "Work without a permit");
  assert.equal(dobCategoryLabel("5"), "Work without a permit");
  assert.equal(dobCategoryLabel("6s"), "Elevator: the only one, no other service");
  assert.equal(dobCategoryLabel("8P"), "Other DOB complaint (code 8P)");
});

test("violation text drops the law it cites and leaves the order in sentence case", () => {
  assert.equal(
    plainViolation("§ 27-2005, 27-2007 HMC AND 28 RCNY §25-171: REPLACE OR REPAIR THE SELF-CLOSING DOORS LOCATED AT APT A2, 1st STORY"),
    "Replace or repair the self-closing doors located at apt A2, 1st story"
  );
  assert.equal(plainViolation("§ 27-2142 ADM CODE APTS HAVE BEEN VACATED BY THIS DEPARTMENT"), "Apts have been vacated by this department");
  assert.equal(
    plainViolation("§ 27-2056.6 ADM CODE - CORRECT THE LEAD-BASED PAINT HAZARD AT APT B7, 2ND STORY"),
    "Correct the lead-based paint hazard at apt B7, 2nd story"
  );
  assert.equal(plainViolation("AT THE TIME OF INSPECTION. I OBSERVED CRACKS"), "At the time of inspection. I observed cracks");
});

test("the lot: BINs from footprints and HPD, placeholders and demolished buildings dropped", () => {
  const lot = summarizeLot("2031070036", bblParts("2031070036"), {
    pluto: [{ address: "1967 MARMION AVENUE", zipcode: "10460", unitsres: "73", numbldgs: "2", latitude: "40.84", longitude: "-73.88", yearbuilt: "1926" }],
    footprints: [{ bin: "2012951" }, { bin: "2098283" }, { bin: "2000000" }, { bin: "2011111", last_status_type: "Demolition" }],
    hpdBuildings: [{ bin: "2012951", legalclassa: "73", legalclassb: "0", recordstatus: "Active" }, { recordstatus: "Inactive" }]
  });
  assert.deepEqual(lot.bins, ["2012951", "2098283"]);
  assert.equal(lot.address, "1967 Marmion Avenue");
  assert.equal(lot.units, 73);
  assert.equal(lot.unitsSource, "hpd");
  assert.equal(lot.hpd, true);
  assert.equal(lotName(lot), "1967 Marmion Avenue, Bronx");
  assert.equal(summarizeLot("2031070036", bblParts("2031070036"), {}), null);
});

test("a lot HPD doesn't cover, with no records, says so instead of showing zeros", () => {
  const home = { ...LOT, hpd: false };
  const v = summarizeViolations({ openByClass: [], issued12: [{ n: "0" }], byYear: [], recentOpen: [], ever: [{ n: "0" }] }, TODAY);
  assert.match(violationsHtml(v, home), /No HPD records for this building/);
  assert.equal(violationsGlance(v, home).text, "No HPD records");
  const c = summarizeComplaints({ byMonth: [], last12: [{ n: "0" }], topCategories: [], ever: [{ n: "0" }] }, TODAY);
  assert.match(complaintsHtml(c, home), /No HPD records/);
  // An HPD building with nothing open is shown as such.
  assert.equal(violationsGlance({ ...v, ever: 9 }, LOT).text, "No open violations");
});

test("open violations by class; Class C gets the warn tone", () => {
  const v = summarizeViolations({
    openByClass: [{ class: "A", n: "7" }, { class: "C", n: "30" }, { class: "B", n: "37" }, { class: "I", n: "1" }],
    issued12: [{ n: "28" }], ever: [{ n: "3670" }],
    byYear: [{ year: "2024", n: "326" }, { year: "2026", n: "10" }], recentOpen: []
  }, TODAY);
  assert.deepEqual(v.open, { A: 7, B: 37, C: 30, I: 1, total: 75 });
  assert.deepEqual(v.byYear, [{ year: 2024, n: 326 }, { year: 2025, n: 0 }, { year: 2026, n: 10 }]);
  assert.deepEqual(violationsGlance(v, LOT), { tone: "warn", value: "75", text: "30 Class C (immediately hazardous)" });
});

test("bedbugs: the latest filing for a period replaces earlier ones", () => {
  const filing = (start, filed, infested, building = "94506") => ({
    building_id: building, of_dwelling_units: "73", infested_dwelling_unit_count: String(infested),
    eradicated_unit_count: "0", re_infested_dwelling_unit: "0",
    filing_date: filed, filing_period_start_date: start, filling_period_end_date: `${Number(start.slice(0, 4)) + 1}-10-31`
  });
  const d = summarizeBedbugs([
    filing("2024-11-01", "2025-12-11", 0),
    filing("2023-11-01", "2025-06-30", 2),
    filing("2023-11-01", "2025-01-02", 5)
  ], TODAY);
  assert.equal(d.periods.length, 2);
  assert.equal(d.periods[1].infested, 2);
  assert.equal(d.periods[1].filed, "2025-06-30");
  assert.equal(d.stale, false);
  assert.equal(bedbugsGlance(d, LOT).text, "No infested units in the latest report");
});

test("bedbugs: no report filed is not the same as no bedbugs", () => {
  const d = summarizeBedbugs([], TODAY);
  assert.equal(d.latest, null);
  assert.match(bedbugsHtml(d, LOT), /No bedbug report filed\.<\/strong> That’s not the same as no bedbugs/);
  assert.equal(bedbugsGlance(d, LOT).text, "No report filed");
});

test("red flags: active vacates, AEP and pending cases; past ones still show", () => {
  const f = summarizeFlags({
    vacate: [{ vacate_type: "Partial", primary_vacate_reason: "Fire Damage", vacate_effective_date: "2020-01-01", actual_rescind_date: "2020-06-01" }],
    aep: [{ current_status: "AEP Active", aep_start_date: "2023-01-31T00:00:00.000" }],
    pendingCases: [{ n: "1" }]
  });
  assert.equal(f.activeVacates.length, 0);
  assert.equal(f.pastVacates, 1);
  assert.equal(f.active, true);
  assert.deepEqual(flagsGlance(f), { tone: "warn", value: "Yes", text: "in AEP, 1 open HPD case" });
  const none = summarizeFlags({ vacate: [], aep: [], pendingCases: [{ n: "0" }] });
  assert.equal(none.any, false);
});

test("city repairs: OMO and HWO combined, dollars only where the work got done", () => {
  const r = summarizeRepairs({
    omo: [
      { reason: "OMO Completed", n: "40", amount: "41000.4", latest: "2023-01-19T00:00:00.000" },
      { reason: "Work Partially Completed", n: "4", amount: "496", latest: "2020-01-01T00:00:00.000" },
      { reason: "No Access", n: "37", amount: "55654.75", latest: "2022-01-01T00:00:00.000" }
    ],
    hwo: [{ reason: "OMO Completed", n: "7", amount: "1042.62", latest: "2022-09-12T00:00:00.000" }, { n: "13" }]
  });
  assert.equal(r.orders, 101);
  assert.equal(r.done, 51);
  assert.equal(r.amount, 42539.02);
  assert.equal(r.latest, "2023-01-19");
  assert.match(repairsHtml(r, LOT), /101<\/span><span class="br-stat-label">emergency repair orders/);
});

test("landlord: owners first, names only, an expired registration flagged", () => {
  const d = summarizeLandlord(
    [{ registrationid: "203139", lastregistrationdate: "2024-08-18T00:00:00.000", registrationenddate: "2025-09-01T00:00:00.000" }],
    [
      { type: "SiteManager", firstname: "ARGENIS", lastname: "PAULINO" },
      { type: "CorporateOwner", corporationname: "MARMION REALTY 1967-1971 LLC" },
      { type: "Agent", corporationname: "MARMION REALTY 1967-1971 LLC" },
      { type: "HeadOfficer", firstname: "STEPHANIE", lastname: "SARPONG-APPIAh" },
      { type: "CorporateOwner", corporationname: "8 Spruce (NY) Owner LLC" }
    ],
    TODAY
  );
  assert.deepEqual(d.contacts.map((c) => [c.label, c.name]), [
    ["Owner (company)", "Marmion Realty 1967-1971 LLC"],
    ["Owner (company)", "8 Spruce (NY) Owner LLC"],
    ["Head officer", "Stephanie Sarpong-Appiah"],
    ["Managing agent", "Marmion Realty 1967-1971 LLC"],
    ["Site manager", "Argenis Paulino"]
  ]);
  assert.equal(d.registration.expired, true);
  assert.match(landlordHtml(d, LOT), /Registration expired Sep 1, 2025/);
  assert.match(landlordHtml(summarizeLandlord([], [], TODAY), { ...LOT, hpd: false }), /No HPD records/);
});

test("DOB: last 12 months from text dates, decoded categories, penalties owed", () => {
  const d = summarizeDob({
    complaints: [
      { date_entered: "07/09/2026", complaint_category: "30" },
      { date_entered: "10/01/2025", complaint_category: "30" }, // before the window
      { date_entered: "01/05/2026", complaint_category: "6S" },
      { date_entered: "02/05/2026", complaint_category: "6S" }
    ],
    activeComplaints: [{ n: "0" }],
    ecbBySeverity: [{ severity: "CLASS - 1", n: "1" }],
    ecbBalance: [{ due: "11752", n: "3" }],
    ecbRecent: [{ issue_date: "20221003", severity: "CLASS - 1", violation_type: "Unknown", violation_description: "WIRING EXPOSED", balance_due: "8000" }]
  }, TODAY, LOT.bins);
  assert.equal(d.complaints12, 3);
  assert.deepEqual(d.top.map((t) => [t.code, t.n]), [["6S", 2], ["30", 1]]);
  assert.equal(d.ecb.open, 1);
  assert.equal(d.ecb.due, 11752);
  assert.equal(d.ecb.recent[0].type, null);
  assert.equal(severityLabel("CLASS - 1"), "Class 1 (immediately hazardous)");
  assert.equal(severityLabel("Hazardous"), "Hazardous");
});

test("the column chart labels every bar for screen readers and escapes text", () => {
  const html = columnsHtml([{ label: "2025", short: "’25", n: 4 }, { label: "<b>", short: "x", n: 0 }], { caption: "Per year" });
  assert.match(html, /<span class="sr-only">2025: 4<\/span>/);
  assert.match(html, /&#60;b&#62;: 0/);
  assert.match(html, /height:100\.0%/);
});

test("address lookup: GeoSearch's BBL comes along; a street alone asks for the house number", async () => {
  const feature = {
    geometry: { coordinates: [-73.8868, 40.8438] },
    properties: { housenumber: "1967", street: "MARMION AVENUE", borough: "Bronx", postalcode: "10460", addendum: { pad: { bbl: "2031070036", bin: "2012951" } } }
  };
  const place = normalizeFeature(feature);
  assert.equal(place.bbl, "2031070036");
  assert.equal(place.bin, "2012951");

  const search = async () => [place];
  const found = await findBuilding({ kind: "address", houseNumber: "1967", text: "1967 Marmion Ave", borough: "BRONX" }, { search });
  assert.equal(found.status, "resolved");
  assert.equal(found.place.bbl, "2031070036");
  assert.equal((await findBuilding({ kind: "street", text: "Marmion Ave" }, { search })).status, "need-address");
  // A match with no tax lot can't make a report.
  const noLot = async () => [{ ...place, bbl: null }];
  assert.equal((await findBuilding({ kind: "address", houseNumber: "1967", text: "1967 Marmion Ave" }, { search: noLot })).status, "not-found");
});

test("every section names its datasets", () => {
  for (const s of SECTIONS) assert.ok(s.datasets.length > 0, s.key);
});
