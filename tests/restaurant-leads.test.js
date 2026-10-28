/*
 * Restaurant leads by service type: the window, the business group mapping,
 * aggregation and score dedupe, urgency tiers, ranking and the CSV export.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addDays, windowRange, isClosedAction, urgencyTier, buildLeads, groupStats, rankLeads,
  summarizeLeads, leadsCsv, formatPhone, mapUrl, CSV_COLUMNS
} from "../src/lib/restaurants/leads.js";
import {
  BUSINESS_GROUPS, IGNORED_CODES, LEADS_CONFIG, MAPPED_CODES, groupsFor
} from "../src/lib/restaurants/business-groups.js";
import { leadViolationParams, leadInspectionParams } from "../src/lib/restaurants/soql.js";

const CLOSED = "Establishment Closed by DOHMH. Violations were cited in the following area(s) and those requiring immediate action were addressed.";
const CITED = "Violations were cited in the following area(s).";

const violation = (o) => ({
  camis: "1", dba: "JOE'S PIZZA", boro: "Brooklyn", building: "10", street: "MAIN   STREET", zipcode: "11211",
  phone: "7185551234", cuisine_description: "Pizza", latitude: "40.7", longitude: "-73.9",
  critical_flag: "Critical", violation_description: "Live roaches in facility's food or non-food area.", ...o
});
const inspection = (o) => ({ camis: "1", inspection_type: "Cycle Inspection / Initial Inspection", action: CITED, ...o });
const t = (date) => `${date}T00:00:00.000`;

// ---------- Window ----------

test("windows count back from the reference date, inclusive", () => {
  assert.deepEqual(windowRange("2026-10-24", 7), { since: "2026-10-18", through: "2026-10-24" });
  assert.deepEqual(windowRange("2026-10-24", 30), { since: "2026-09-25", through: "2026-10-24" });
  assert.deepEqual(windowRange("2026-10-24", 1), { since: "2026-10-24", through: "2026-10-24" });
});

test("addDays crosses months, years and leap days", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(addDays("2027-01-02", -3), "2026-12-30");
});

// ---------- Mapping ----------

test("seven groups, each with unique ids and well-formed codes", () => {
  assert.equal(BUSINESS_GROUPS.length, 7);
  assert.equal(new Set(BUSINESS_GROUPS.map((g) => g.id)).size, 7);
  for (const g of BUSINESS_GROUPS) {
    assert.ok(g.label && g.description && g.icon && g.tone && g.codes.length, g.id);
    assert.equal(new Set(g.codes).size, g.codes.length, `${g.id} lists a code twice`);
    for (const code of g.codes) assert.match(code, /^\d{2}[A-Z]$|^\d{2}-\d{2}$/);
  }
});

test("a code can belong to more than one group; ignored codes to none", () => {
  assert.deepEqual(groupsFor("04L"), ["pest-control"]);
  assert.deepEqual(groupsFor("04E").sort(), ["equipment", "pest-control"]);
  assert.deepEqual(groupsFor(" 04F ").sort(), ["cleaning", "plumbing"]);
  assert.deepEqual(groupsFor("10F"), []);
  for (const code of Object.keys(IGNORED_CODES)) assert.deepEqual(groupsFor(code), []);
  assert.equal(new Set(MAPPED_CODES).size, MAPPED_CODES.length);
});

test("the violation query is critical only unless non-critical codes are added", () => {
  const plain = leadViolationParams("2026-09-25", "2026-10-24", ["04L", "10B"]);
  assert.match(plain.$where, /critical_flag = 'Critical' AND/);
  assert.match(plain.$where, /violation_code IS NOT NULL/);
  assert.match(plain.$where, /inspection_date > '1900-01-01T00:00:00'/);
  assert.match(plain.$where, /between '2026-09-25T00:00:00' and '2026-10-24T23:59:59'/);
  const withBackflow = leadViolationParams("2026-09-25", "2026-10-24", ["04L", "10B"], ["10B"]);
  assert.match(withBackflow.$where, /\(critical_flag = 'Critical' OR violation_code in \('10B'\)\)/);
  assert.match(leadInspectionParams("2026-09-25", "2026-10-24").$group, /camis, inspection_date/);
  // Included non-critical codes only show up through a group
  for (const code of LEADS_CONFIG.includeNonCriticalCodes) assert.ok(groupsFor(code).length, `${code} is in no group`);
  assert.deepEqual(groupsFor("10D"), ["ventilation"]);
});

// ---------- Urgency ----------

test("closed and re-closed actions are closures; re-opened is not", () => {
  assert.equal(isClosedAction(CLOSED), true);
  assert.equal(isClosedAction("Establishment re-closed by DOHMH."), true);
  assert.equal(isClosedAction("Establishment re-opened by DOHMH."), false);
  assert.equal(isClosedAction(CITED), false);
  assert.equal(isClosedAction(undefined), false);
});

test("tiers: closed beats score; 14+ is re-inspection likely; threshold is configurable", () => {
  assert.equal(urgencyTier({ actions: [CLOSED], score: 5 }), "closed");
  assert.equal(urgencyTier({ actions: [CITED], score: 14 }), "reinspection");
  assert.equal(urgencyTier({ actions: [CITED], score: 13 }), "standard");
  assert.equal(urgencyTier({ actions: [CITED], score: null }), "standard");
  assert.equal(urgencyTier({ actions: [CITED], score: 14 }, { reinspectionScore: 20 }), "standard");
  assert.equal(urgencyTier({ actions: [CLOSED, "Establishment re-opened by DOHMH."], score: 30 }), "reinspection");
  assert.equal(urgencyTier(null), "standard");
});

// ---------- Aggregation ----------

test("placeholder dates, missing codes and unmapped codes are dropped", () => {
  const { restaurants } = buildLeads([
    violation({ inspection_date: t("1900-01-01"), violation_code: "04M" }),
    violation({ inspection_date: t("2026-10-20"), violation_code: undefined }),
    violation({ inspection_date: t("2026-10-20"), violation_code: "07A" })
  ], []);
  assert.equal(restaurants.length, 0);
});

test("score is deduped per inspection and comes from the latest one", () => {
  const { restaurants } = buildLeads([
    violation({ inspection_date: t("2026-10-01"), violation_code: "04M" }),
    violation({ inspection_date: t("2026-10-01"), violation_code: "04L" }),
    violation({ inspection_date: t("2026-10-01"), violation_code: "02G" })
  ], [
    // Same inspection, two types on the day: one inspection, the first score reported.
    inspection({ inspection_date: t("2026-10-01"), score: "31" }),
    inspection({ inspection_date: t("2026-10-01"), inspection_type: "Pre-permit (Operational) / Initial Inspection", score: "31" }),
    inspection({ inspection_date: t("2026-10-15"), inspection_type: "Cycle Inspection / Re-inspection", score: "9", grade: "A" })
  ]);
  const [r] = restaurants;
  assert.equal(r.latest.date, "2026-10-15");
  assert.equal(r.latest.score, 9);
  assert.equal(r.latest.grade, "A");
  assert.equal(r.tier, "standard");
  assert.equal(r.violations.length, 3);
  assert.equal(r.name, "Joe's Pizza");
  assert.equal(r.address, "10 Main Street");
});

test("an unscored latest inspection keeps its date but shows the last score", () => {
  const { restaurants } = buildLeads(
    [violation({ inspection_date: t("2026-10-01"), violation_code: "04M" })],
    [
      inspection({ inspection_date: t("2026-10-01"), score: "22" }),
      inspection({ inspection_date: t("2026-10-10"), inspection_type: "Administrative Miscellaneous / Initial Inspection", action: "No violations were recorded at the time of this inspection." })
    ]
  );
  const [r] = restaurants;
  assert.equal(r.latest.date, "2026-10-10");
  assert.equal(r.latest.score, 22);
  assert.equal(r.latest.scoreDate, "2026-10-01");
  assert.equal(r.tier, "reinspection");
});

test("a code cited twice on one day counts once; descriptions keep the usual spelling", () => {
  const { restaurants, descriptions } = buildLeads([
    violation({ inspection_date: t("2026-10-01"), violation_code: "04N", violation_description: "Filth  flies." }),
    violation({ inspection_date: t("2026-10-01"), violation_code: "04N", violation_description: "Filth flies." }),
    violation({ inspection_date: t("2026-10-08"), violation_code: "04N", violation_description: "Filth flies." })
  ], []);
  assert.equal(restaurants[0].violations.length, 2);
  assert.equal(descriptions["04N"], "Filth flies.");
});

test("the newest row supplies the name and address", () => {
  const { restaurants } = buildLeads([
    violation({ inspection_date: t("2026-09-30"), violation_code: "04M", dba: "OLD NAME" }),
    violation({ inspection_date: t("2026-10-20"), violation_code: "04M", dba: "NEW NAME" })
  ], []);
  assert.equal(restaurants[0].name, "New Name");
});

test("group stats count this group's violations and distinct inspections in the window", () => {
  const r = {
    violations: [
      { code: "04L", date: "2026-10-20" }, { code: "04M", date: "2026-10-20" },
      { code: "04K", date: "2026-10-02" }, { code: "02G", date: "2026-10-20" },
      { code: "04E", date: "2026-10-20" }
    ]
  };
  const month = groupStats(r, "pest-control", "2026-09-25");
  assert.equal(month.groupViolationCount, 4);
  assert.equal(month.inspectionsAffected, 2);
  assert.deepEqual(month.other.map((v) => v.code), ["02G"]);
  const week = groupStats(r, "pest-control", "2026-10-18");
  assert.equal(week.groupViolationCount, 3);
  assert.equal(week.inspectionsAffected, 1);
  // 04E is in both groups
  assert.equal(groupStats(r, "equipment", "2026-09-25").groupViolationCount, 1);
});

// ---------- Ranking ----------

const lead = (camis, o) => ({
  camis, name: `R${camis}`, address: "1 Main Street", boro: "Brooklyn", zipcode: "11211", phone: "",
  tier: "standard", latest: { date: "2026-10-10", score: 10 }, violations: [], ...o
});
const pests = (n, date = "2026-10-20") => Array.from({ length: n }, (_, i) => ({ code: ["04K", "04L", "04M", "04N"][i % 4], date }));

test("ranking: violations → tier → score → most recent inspection", () => {
  const ranked = rankLeads([
    lead("a", { violations: pests(1), tier: "closed" }),
    lead("b", { violations: pests(3) }),
    lead("c", { violations: pests(2), tier: "reinspection", latest: { date: "2026-10-10", score: 20 } }),
    lead("d", { violations: pests(2), tier: "closed", latest: { date: "2026-10-10", score: 5 } }),
    lead("e", { violations: pests(2), tier: "reinspection", latest: { date: "2026-10-10", score: 30 } }),
    lead("f", { violations: pests(2), tier: "reinspection", latest: { date: "2026-10-12", score: 20 } }),
    lead("g", { violations: [{ code: "02G", date: "2026-10-20" }] })
  ], "pest-control", { since: "2026-09-25" });
  assert.deepEqual(ranked.map((l) => l.camis), ["b", "d", "e", "f", "c", "a"]);
  assert.deepEqual(ranked.map((l) => l.rank), [1, 2, 3, 4, 5, 6]);
});

test("filters: window, borough, search by name or ZIP, urgent only", () => {
  const all = [
    lead("a", { violations: pests(1, "2026-10-01"), name: "Joe's Pizza" }),
    lead("b", { violations: pests(1), boro: "Queens", zipcode: "11101", tier: "closed" }),
    lead("c", { violations: pests(1), name: "Taco Spot", tier: "reinspection" })
  ];
  const ids = (opts) => rankLeads(all, "pest-control", { since: "2026-09-25", ...opts }).map((l) => l.camis);
  assert.deepEqual(ids({ since: "2026-10-18" }), ["b", "c"]);
  assert.deepEqual(ids({ boro: "Queens" }), ["b"]);
  assert.deepEqual(ids({ search: "  joe's " }), ["a"]);
  assert.deepEqual(ids({ search: "111" }), ["b"]);
  assert.deepEqual(ids({ urgentOnly: true }), ["b", "c"]);
});

test("filters: hide low scores drops a latest score of 3 or less, keeps no score", () => {
  const all = [
    lead("a", { violations: pests(1), latest: { date: "2026-10-10", score: 3 } }),
    lead("b", { violations: pests(1), latest: { date: "2026-10-10", score: 4 } }),
    lead("c", { violations: pests(1), latest: { date: "2026-10-10", score: 0 } }),
    lead("d", { violations: pests(1), latest: { date: "2026-10-10", score: null } }),
    lead("e", { violations: pests(1), latest: null })
  ];
  const ids = (opts) => rankLeads(all, "pest-control", { since: "2026-09-25", ...opts }).map((l) => l.camis).sort();
  assert.deepEqual(ids({}), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids({ hideLowScores: true }), ["b", "d", "e"]);
});

test("summary counts restaurants, violations, closures and likely re-inspections", () => {
  const ranked = rankLeads([
    lead("a", { violations: pests(2), tier: "closed" }),
    lead("b", { violations: pests(3), tier: "reinspection" }),
    lead("c", { violations: pests(1) })
  ], "pest-control", { since: "2026-09-25" });
  assert.deepEqual(summarizeLeads(ranked), { restaurants: 3, violations: 6, closed: 1, reinspection: 1 });
  assert.deepEqual(summarizeLeads([]), { restaurants: 0, violations: 0, closed: 0, reinspection: 0 });
});

// ---------- Display and export ----------

test("CSV has a header, escapes commas and quotes, and lists unique codes", () => {
  const ranked = rankLeads([
    lead("a", { name: 'Joe\'s "Famous", Pizza', phone: "7185551234", tier: "closed", violations: pests(5) })
  ], "pest-control", { since: "2026-09-25" });
  const [header, row] = leadsCsv(ranked).trim().split("\n");
  assert.equal(header, CSV_COLUMNS.join(","));
  assert.equal(row, '1,"Joe\'s ""Famous"", Pizza",1 Main Street,Brooklyn,11211,(718) 555-1234,5,Closed by DOHMH,10,2026-10-10,04K 04L 04M 04N');
});

test("phone numbers and map links", () => {
  assert.equal(formatPhone("7185551234"), "(718) 555-1234");
  assert.equal(formatPhone("17185551234"), "(718) 555-1234");
  assert.equal(formatPhone("__________"), "");
  assert.match(mapUrl({ lat: 40.7, lng: -73.9 }), /query=40\.7%2C-73\.9$/);
  assert.match(mapUrl({ lat: null, lng: null, address: "10 Main Street", boro: "Brooklyn", zipcode: "11211" }),
    /query=10%20Main%20Street%2C%20Brooklyn%2C%20NY%2C%2011211$/);
});

// ---------- Cards ----------

test("cards escape names, link the phone and start with the back inert", async () => {
  const { leadCardHtml, emptyStateText } = await import("../src/lib/restaurants/leads-render.js");
  const { businessGroup } = await import("../src/lib/restaurants/business-groups.js");
  const pest = businessGroup("pest-control");
  const [l] = rankLeads([lead("a", { name: "<b>Joe</b>", phone: "7185551234", tier: "closed", violations: pests(2) })],
    "pest-control", { since: "2026-09-25" });
  const html = leadCardHtml(l, pest, { "04K": "Rats." });
  assert.doesNotMatch(html, /<b>Joe/);
  assert.match(html, /href="tel:\+17185551234"/);
  assert.match(html, /class="lead-face lead-back"[^>]* inert>/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-tier="closed"/);
  assert.equal(emptyStateText(pest, 7), "No critical pest violations in the last 7 days. Try 30 days.");
});
