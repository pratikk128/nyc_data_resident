/*
 * Building Report Card logic (src/lib/building-report/): the key formats
 * each dataset needs, the counting rules, and what an empty building says.
 * Rows are shaped like Socrata's answers (numbers as strings).
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isBbl, bblParts, dobCategoryLabel, buildingPath, SECTIONS, SECTION_KEYS, PARTS } from "../src/lib/building-report/config.js";
import {
  yearAgo, violationsQueries, complaintsQueries, hygieneQueries, flagsQueries, registrationQuery, contactsQuery, dobQueries, lotQueries,
  ownerMatchQuery, portfolioRegistrationsQueries, chunks
} from "../src/lib/building-report/soql.js";
import {
  dobDate, ecbDate, plainViolation, summarizeLot, summarizeViolations, summarizeComplaints, summarizeBedbugs,
  summarizeFlags, summarizeRepairs, summarizeLandlord, summarizeDob, summarizeHygiene, summarizeCourt, hygieneKind, chartMonths, lotName,
  ownerKeys, portfolioLots, summarizePortfolio, registrationBbl
} from "../src/lib/building-report/summarize.js";
import {
  violationsTakeaway, violationsHtml, complaintsHtml, bedbugsHtml, bedbugsTakeaway, flagsTakeaway, landlordHtml, landlordTakeaway,
  repairsHtml, repairsTakeaway, courtHtml, dobHtml, dobTakeaway, howLong, hygieneHtml, hygieneTakeaway, columnsHtml, severityLabel, NO_HPD_TEXT,
  portfolioHtml, portfolioTakeaway
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
  // Rows are problems: the all-time total counts complaints, like the 12-month one.
  assert.equal(complaintsQueries(LOT, TODAY).ever.params.$select, "count(distinct complaint_id) AS n");
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

test("date windows: last 12 months, the chart's calendar months, DOB's text dates", () => {
  assert.equal(yearAgo(TODAY), "2025-11-02");
  assert.deepEqual(chartMonths(TODAY).slice(0, 2), ["2025-11", "2025-12"]);
  assert.equal(chartMonths(TODAY).at(-1), "2026-11");
  assert.equal(chartMonths(TODAY).length, 13);
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
  assert.equal(
    plainViolation("HMC ADM CODE: § 27-2017.4 ABATE THE INFESTATION CONSISTING OF MICE IN THE ENTIRE APARTMENT LOCATED AT APT B34"),
    "Abate the infestation consisting of mice in the entire apartment located at apt B34"
  );
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
  assert.equal(violationsTakeaway(v, home).text, NO_HPD_TEXT);
  const c = summarizeComplaints({ byMonth: [], last12: [{ n: "0" }], topCategories: [], ever: [{ n: "0" }] }, TODAY);
  assert.match(complaintsHtml(c, home), /No HPD records/);
  // An HPD building with nothing open is shown as such.
  assert.equal(violationsTakeaway({ ...v, ever: 9 }, LOT).text, "Nothing the city ordered fixed is still open");
});

test("open violations by class; urgent (Class C) gets the warn tone", () => {
  const v = summarizeViolations({
    openByClass: [{ class: "A", n: "7" }, { class: "C", n: "30" }, { class: "B", n: "37" }, { class: "I", n: "1" }],
    issued12: [{ n: "28" }], ever: [{ n: "3670" }],
    byYear: [{ year: "2024", n: "326" }, { year: "2026", n: "10" }], recentOpen: []
  }, TODAY);
  // Class I (a city notice) isn't a repair, so it's left out of the total.
  assert.deepEqual(v.open, { A: 7, B: 37, C: 30, I: 1, total: 74 });
  assert.deepEqual(v.byYear, [{ year: 2024, n: 326 }, { year: 2025, n: 0 }, { year: 2026, n: 10 }]);
  assert.deepEqual(violationsTakeaway(v, LOT), { tone: "warn", value: "74", text: "30 urgent, like no heat or lead paint (24 hours to fix)" });
  assert.match(violationsHtml(v, LOT), /74 open repair orders, plus 1 open city notice\./);
  assert.match(violationsHtml(v, LOT), /Urgent<\/span><span class="br-class-short">Owner has 24 hours · Class C/);
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
  assert.deepEqual(bedbugsTakeaway(d, LOT), { tone: "info", value: "0", text: "In the owner’s latest yearly report (Nov 1, 2024 – Oct 31, 2025)" });
});

test("bedbugs: no report filed is not the same as no bedbugs", () => {
  const d = summarizeBedbugs([], TODAY);
  assert.equal(d.latest, null);
  assert.match(bedbugsHtml(d, LOT), /No bedbug report filed\.<\/strong> That’s not the same as no bedbugs/);
  assert.equal(bedbugsTakeaway(d, LOT).text, "No yearly report filed, so no word either way");
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
  assert.deepEqual(flagsTakeaway(f), { tone: "warn", value: "Yes", text: "On the city’s watch list for neglected buildings, 1 open court case brought by the city" });
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
  // The takeaway counts the times the work got done, not every order.
  assert.deepEqual(repairsTakeaway(r, LOT), { tone: "info", value: "51", text: "Out of 101 emergency orders. $43K of work, billed to the owner" });
  const none = summarizeRepairs({ omo: [{ reason: "No Access", n: "3", amount: "900" }], hwo: [] });
  assert.deepEqual(repairsTakeaway(none, LOT), { tone: "info", value: "0", text: "None done by the city’s contractors, out of 3 emergency orders" });
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
  assert.deepEqual(landlordTakeaway(d, LOT), { tone: "warn", value: "Marmion Realty 1967-1971 LLC", text: "Registration with the city expired Sep 1, 2025" });
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

test("every section names its datasets and is in one part", () => {
  for (const s of SECTIONS) assert.ok(s.datasets.length > 0, s.key);
  const inParts = PARTS.flatMap((p) => p.sections);
  assert.deepEqual([...inParts].sort(), [...SECTION_KEYS].sort());
  assert.equal(buildingPath("2031070036"), "/building-report/?bbl=2031070036");
  assert.equal(buildingPath("2031070036", "pests"), "/building-report/pests/?bbl=2031070036");
});

test("pests, mold and garbage: violations sorted by their wording, complaints by type", () => {
  assert.equal(hygieneKind("HMC ADM CODE: § 27-2017.4 ABATE THE INFESTATION CONSISTING OF ROACHES IN THE ENTIRE APARTMENT"), "roaches");
  assert.equal(hygieneKind("ABATE THE INFESTATION CONSISTING OF RODENTS RATS IN THE ENTIRE APARTMENT"), "rodents");
  assert.equal(hygieneKind("TRACE AND REPAIR THE SOURCE AND ABATE THE VISIBLE MOLD CONDITION"), "mold");
  assert.equal(hygieneKind("PROVIDE SUFFICIENT ... RECEPTACLES FOR THE DEPOSIT OF GARBAGE, RUBBISH"), "garbage");
  // "MOLDING" isn't mold.
  assert.equal(hygieneKind("REPAIR THE BROKEN OR DEFECTIVE WOOD MOLDING"), null);

  const d = summarizeHygiene({
    openViolations: [
      { violationid: "1", class: "B", novissueddate: "2026-10-01T00:00:00.000", novdescription: "ABATE THE INFESTATION CONSISTING OF ROACHES", apartment: "4B" },
      { violationid: "2", class: "B", novissueddate: "2026-09-01T00:00:00.000", novdescription: "ABATE THE INFESTATION CONSISTING OF ROACHES", apartment: "4b" },
      { violationid: "3", class: "B", novissueddate: "2026-08-01T00:00:00.000", novdescription: "ABATE THE INFESTATION CONSISTING OF MICE", apartment: "2A" },
      { violationid: "4", class: "A", novdescription: "REPAIR THE WOOD MOLDING" }
    ],
    complaintTypes: [
      { minor_category: "PESTS", problem_code: "ROACHES", n: "5" },
      { minor_category: "PESTS", problem_code: "OTHER", n: "1" },
      { minor_category: "MOLD", problem_code: "MOLD", n: "2" }
    ],
    complaints12: [{ n: "6" }]
  }, TODAY);
  assert.equal(d.open, 3);
  assert.deepEqual(d.byKind.map((k) => [k.label, k.n]), [["Roaches", 2], ["Mice or rats", 1]]);
  assert.equal(d.apartments, 2);
  assert.deepEqual(d.complaintTypes, [{ label: "Roaches", n: 5 }, { label: "Mold", n: 2 }, { label: "Other pests", n: 1 }]);
  assert.deepEqual(hygieneTakeaway(d, LOT), { tone: "info", value: "3", text: "Mostly roaches. 6 tenant complaints in the last year" });
  assert.match(hygieneHtml(d, LOT), /In 2 apartments/);

  const none = summarizeHygiene({ openViolations: [], complaintTypes: [], complaints12: [{ n: "0" }], everViolations: [{ n: "0" }], everComplaints: [{ n: "0" }] }, TODAY);
  assert.equal(hygieneTakeaway(none, { ...LOT, hpd: false }).text, NO_HPD_TEXT);
  // A lot HPD no longer lists, with older records: not "No HPD records".
  const past = summarizeHygiene({ openViolations: [], complaintTypes: [], complaints12: [{ n: "0" }], everViolations: [{ n: "12" }], everComplaints: [{ n: "0" }] }, TODAY);
  assert.equal(past.ever, 12);
  assert.deepEqual(hygieneTakeaway(past, { ...LOT, hpd: false }), { tone: "info", value: "0", text: "No tenant complaints in the last year" });
  assert.doesNotMatch(hygieneHtml(past, { ...LOT, hpd: false }), /No HPD records/);

  const q = hygieneQueries(LOT, TODAY);
  assert.match(q.openViolations.params.$where, /^bbl = '2031070036' AND violationstatus = 'Open' AND \(novdescription like '%INFEST%' OR /);
  assert.match(q.everViolations.params.$where, /^bbl = '2031070036'$/);
  assert.match(q.everComplaints.params.$where, /^bbl = 2031070036$/);
  assert.match(q.complaints12.params.$where, /^bbl = 2031070036 AND received_date >= '2025-11-02' AND minor_category in \('PESTS', 'MOLD', /);
});

test("court: a harassment finding is \"After Trial\" or \"After Inquest\", not \"No Harassment\"", () => {
  const d = summarizeCourt({
    total: [{ n: "3" }],
    cases: [
      { litigationid: "1", casetype: "Tenant Action/Harrassment", casestatus: "CLOSED", findingofharassment: "After Trial" },
      { litigationid: "2", casetype: "Tenant Action/Harrassment", casestatus: "CLOSED", findingofharassment: "After Inquest" },
      { litigationid: "3", casetype: "Tenant Action/Harrassment", casestatus: "CLOSED", findingofharassment: "No Harassment" }
    ]
  });
  assert.deepEqual(d.cases.map((c) => c.harassment), [true, true, null]);
  assert.equal(courtHtml(d, LOT).match(/Harassment found/g).length, 2);
});

test("complaints: the chart counts from the same day as the total and names its part-months", () => {
  const q = complaintsQueries(LOT, TODAY);
  assert.equal(q.byMonth.params.$where, q.last12.params.$where);
  const c = summarizeComplaints({ byMonth: [{ month: "2025-11-01T00:00:00.000", n: "2" }, { month: "2026-11-01T00:00:00.000", n: "1" }],
    last12: [{ n: "3" }], topCategories: [], ever: [{ n: "9" }] }, TODAY);
  assert.equal(c.months.reduce((sum, m) => sum + m.n, 0), c.last12);
  const html = complaintsHtml(c, LOT);
  assert.match(html, /November 2025 \(from Nov 2\): 2/);
  assert.match(html, /November 2026 \(through Nov 2\): 1/);
  assert.match(html, /Nov 2, 2025 to Nov 2, 2026\. The first and last bars are part-months/);
});

test("DOB fines are shown to the dollar", () => {
  const d = { bins: ["2000001"], complaints12: 0, top: [], activeComplaints: 0,
    ecb: { open: 1, due: 11752, dueCount: 1, bySeverity: [], recent: [] } };
  assert.match(dobTakeaway(d).text, /^\$11,752 in fines still owed/);
  assert.match(dobHtml(d), /\$11,752<\/span><span class="br-stat-label">in fines still owed/);
  assert.doesNotMatch(dobHtml(d), /\$12K/);
});

test("court: a pending case says how long it has been open", () => {
  assert.equal(howLong("2023-01-15", TODAY), "3 years, 9 months");
  assert.equal(howLong("2026-10-20", TODAY), "under a month");
  assert.equal(howLong("2025-11-02", TODAY), "1 year");
  const d = summarizeCourt({ total: [{ n: "1" }], cases: [{ litigationid: "1", casetype: "Heat and Hot Water", casestatus: "PENDING", caseopendate: "2023-01-15T00:00:00.000" }] }, TODAY);
  assert.match(courtHtml(d, LOT), /Pending for 3 years, 9 months/);
});

test("owner's other buildings: owners and officers by name, not agents; placeholders skipped", () => {
  const keys = ownerKeys([
    { type: "Agent", corporationname: "BIG MANAGEMENT LLC" },
    { type: "SiteManager", firstname: "ARGENIS", lastname: "PAULINO" },
    { type: "CorporateOwner", corporationname: "Marmion Realty 1967-1971 LLC " },
    { type: "HeadOfficer", firstname: "Alexander", lastname: "HOFFMAN" },
    { type: "HeadOfficer", firstname: "#", lastname: "#" },
    { type: "Officer", firstname: "JANE", lastname: "DOE" }
  ]);
  assert.deepEqual(keys.map((k) => k.kind === "company" ? k.company : `${k.first} ${k.last}`),
    ["MARMION REALTY 1967-1971 LLC", "ALEXANDER HOFFMAN"]);
  const where = ownerMatchQuery(keys).params.$where;
  assert.match(where, /type = 'CorporateOwner' AND upper\(corporationname\) = 'MARMION REALTY 1967-1971 LLC'/);
  assert.match(where, /upper\(firstname\) = 'ALEXANDER' AND upper\(lastname\) = 'HOFFMAN'/);
  assert.doesNotMatch(where, /'Agent'/);
  // Quotes in a name can't break out of the string.
  assert.match(ownerMatchQuery([{ kind: "person", first: "MARY", last: "O'BRIEN" }]).params.$where, /'O''BRIEN'/);
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.match(portfolioRegistrationsQueries(["7", "8"], "2024-11-03")[0].params.$where, /registrationid in \(7, 8\) AND lastregistrationdate >= '2024-11-03'/);
});

test("owner's other buildings: grouped by lot, this lot left out, worst open orders first", () => {
  const keys = [{ kind: "company", company: "ACME LLC", label: "Owner (company)" }, { kind: "person", first: "ALEX", last: "HOFFMAN", label: "Head officer" }];
  const matches = [
    { registrationid: "1", type: "CorporateOwner", corporationname: "ACME LLC" },
    { registrationid: "2", type: "HeadOfficer", firstname: "Alex", lastname: "Hoffman" },
    { registrationid: "3", type: "HeadOfficer", firstname: "ALEX", lastname: "HOFFMAN" },
    { registrationid: "4", type: "IndividualOwner", firstname: "ALEX", lastname: "HOFFMAN" },
    // An agent row with a matching name isn't a match.
    { registrationid: "5", type: "Agent", corporationname: "ACME LLC" }
  ];
  const regs = [
    { registrationid: "1", buildingid: "11", boroid: "2", block: "3107", lot: "36", housenumber: "1967", streetname: "MARMION AVENUE" },
    { registrationid: "2", buildingid: "21", boroid: "2", block: "3150", lot: "1", housenumber: "2108", streetname: "RYER AVENUE" },
    { registrationid: "3", buildingid: "22", boroid: "2", block: "3150", lot: "1", housenumber: "2110", streetname: "RYER AVENUE" },
    { registrationid: "4", buildingid: "31", boroid: "1", block: "100", lot: "7502", housenumber: "1", streetname: "WALL ST" },
    { registrationid: "5", buildingid: "41", boroid: "3", block: "1", lot: "1", housenumber: "9", streetname: "AGENT ST" }
  ];
  assert.equal(registrationBbl(regs[3]), "1001007502");
  const lots = portfolioLots(LOT, keys, matches, regs, []);
  assert.deepEqual(lots.map((l) => [l.bbl, l.buildingIds, l.via]), [
    ["1001007502", ["31"], ["Alex Hoffman"]],
    ["2031500001", ["21", "22"], ["Alex Hoffman"]]
  ]);
  const d = summarizePortfolio({
    registered: true, keys, lots, since: "2024-11-03",
    violations: [
      { bbl: "2031500001", class: "B", n: "4" }, { bbl: "2031500001", class: "C", n: "2" },
      { bbl: "2031500001", class: "I", n: "1" }, { bbl: "1001007502", class: "A", n: "3" }
    ],
    units: [
      { buildingid: "21", legalclassa: "30", legalclassb: "0" }, { buildingid: "22", legalclassa: "3" },
      { buildingid: "31", legalclassa: "50", recordstatus: "Inactive" }
    ]
  });
  assert.equal(d.total, 2);
  assert.equal(d.units, 33);
  assert.deepEqual(d.open, { A: 3, B: 4, C: 2, total: 9 });
  assert.equal(d.withUrgent, 1);
  assert.deepEqual(d.buildings.map((b) => [b.address, b.units, b.open.total]), [["2108 Ryer Avenue", 33, 6], ["1 Wall St", null, 3]]);
  assert.deepEqual(portfolioTakeaway(d, LOT), { tone: "warn", value: "2", text: "1 of them has urgent repair orders open" });
  const html = portfolioHtml(d, LOT);
  assert.match(html, /href="\/building-report\/\?bbl=2031500001">2108 Ryer Avenue, Bronx<\/a>/);
  assert.match(html, /2 urgent · 4 serious/);
  assert.match(html, /Linked by Alex Hoffman/);
});

test("owner's other buildings: nothing found, no owner, not registered", () => {
  const keys = [{ kind: "company", company: "ACME LLC", label: "Owner (company)" }];
  const none = summarizePortfolio({ registered: true, keys, lots: [], since: "2024-11-03" });
  assert.deepEqual(portfolioTakeaway(none, LOT), { tone: "info", value: "0", text: "No other buildings registered under the same owner" });
  assert.match(portfolioHtml(none, LOT), /No other buildings registered with the city in the last two years name Acme LLC/);
  assert.match(portfolioHtml(summarizePortfolio({ registered: true, keys: [], lots: [], since: "2024-11-03" }), LOT), /doesn’t name an owning company/);
  const unregistered = summarizePortfolio({ registered: false, keys: [], lots: [], since: "2024-11-03" });
  assert.equal(portfolioTakeaway(unregistered, LOT).text, "Not registered with the city");
  assert.match(portfolioHtml(unregistered, { ...LOT, hpd: false }), /No HPD records/);
});
