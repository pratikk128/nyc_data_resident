/*
 * Restaurant inspection logic: grade selection, the 1900-01-01 placeholder,
 * the violation category mapping and the per-restaurant mean.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  latestGrade, groupInspections, isInspected, countByCategory, totalsFromFamilies,
  perInspection, compareToMeans, cutoffDate, gradeInfo, scoreBand, titleCase, boroLabel,
  latestScored, closesRestaurant, inspectionsByCategory, MIN_REPEAT_INSPECTIONS
} from "../src/lib/restaurants/inspections.js";
import { categoryFor, violationFamily, CATEGORIES, OTHER } from "../src/lib/restaurants/violation-categories.js";
import { parseLocation, searchWhere, searchParams, nameRank, milesBetween, normalizeSearch, soqlString, MAX_NAME_LENGTH, MAX_PLACE_LENGTH, MAX_CUISINE_LENGTH } from "../src/lib/restaurants/soql.js";
import { categoryListHtml, detailHtml, historyHtml, rateText, resultCardsHtml } from "../src/lib/restaurants/render.js";

const row = (o) => ({ camis: "1", ...o });

// ---------- Grade selection ----------

test("latest grade is the newest graded row, not the newest inspection", () => {
  const rows = [
    row({ inspection_date: "2026-03-01T00:00:00.000", grade: undefined, score: "30" }), // ungraded initial
    row({ inspection_date: "2025-06-10T00:00:00.000", grade: "A", grade_date: "2025-06-10T00:00:00.000" }),
    row({ inspection_date: "2024-01-05T00:00:00.000", grade: "B", grade_date: "2024-01-05T00:00:00.000" })
  ];
  assert.deepEqual(latestGrade(rows), { grade: "A", date: "2025-06-10" });
});

test("grade N with no grade_date falls back to the inspection date", () => {
  const rows = [
    row({ inspection_date: "2026-10-24T00:00:00.000", grade: "N" }),
    row({ inspection_date: "2025-01-27T00:00:00.000", grade: "B", grade_date: "2025-01-27T00:00:00.000" })
  ];
  assert.deepEqual(latestGrade(rows), { grade: "N", date: "2026-10-24" });
});

test("no graded rows means no latest grade", () => {
  assert.equal(latestGrade([row({ inspection_date: "2026-01-01T00:00:00.000", grade: "" })]), null);
  assert.equal(latestGrade([]), null);
});

test("N, Z and P read as words, not letters", () => {
  assert.equal(gradeInfo("A").short, "A");
  for (const g of ["N", "Z", "P"]) {
    assert.equal(gradeInfo(g).short, null);
    assert.doesNotMatch(gradeInfo(g).label, /^[NZP]$/);
  }
  assert.equal(gradeInfo("Z").label, "Grade pending");
});

test("score bands: A 0–13, B 14–27, C 28+", () => {
  assert.equal(scoreBand(0), "A");
  assert.equal(scoreBand(13), "A");
  assert.equal(scoreBand(14), "B");
  assert.equal(scoreBand(27), "B");
  assert.equal(scoreBand(28), "C");
  assert.equal(scoreBand(null), null);
});

// ---------- 1900-01-01 exclusion ----------

test("1900-01-01 rows are not inspections", () => {
  const placeholder = row({ inspection_date: "1900-01-01T00:00:00.000" });
  assert.equal(isInspected(placeholder), false);
  assert.equal(groupInspections([placeholder]).length, 0);
  assert.equal(latestGrade([{ ...placeholder, grade: "N" }]), null);
});

test("inspections are deduped by camis + date, placeholder dropped", () => {
  const rows = [
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "10F", critical_flag: "Not Critical", score: "19" }),
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02G", critical_flag: "Critical", score: "19" }),
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "04L", critical_flag: "Critical", score: "19" }),
    row({ inspection_date: "2024-08-20T00:00:00.000", violation_code: "06D", critical_flag: "Critical", score: "12" }),
    row({ inspection_date: "1900-01-01T00:00:00.000" })
  ];
  const insp = groupInspections(rows);
  assert.equal(insp.length, 2);
  assert.equal(insp[0].date, "2026-01-05");
  assert.equal(insp[0].score, 19);
  // Critical first, then not critical
  assert.deepEqual(insp[0].violations.map((v) => v.code), ["02G", "04L", "10F"]);
});

const CLOSED = "Establishment Closed by DOHMH. Violations were cited in the following area(s) and those requiring immediate action were addressed.";

test("the latest inspection is the newest scored one, not a newer administrative visit", () => {
  const insp = groupInspections([
    row({ inspection_date: "2026-10-20T00:00:00.000", inspection_type: "Administrative Miscellaneous / Initial Inspection", violation_code: "28-06", critical_flag: "Not Critical" }),
    row({ inspection_date: "2026-10-01T00:00:00.000", inspection_type: "Cycle Inspection / Initial Inspection", violation_code: "04L", critical_flag: "Critical", score: "24" })
  ]);
  assert.equal(latestScored(insp).date, "2026-10-01");
  // Nothing scored: the newest visit.
  const unscored = groupInspections([row({ inspection_date: "2026-10-20T00:00:00.000", inspection_type: "Trans Fat / Initial Inspection" })]);
  assert.equal(latestScored(unscored).date, "2026-10-20");
  assert.equal(latestScored([]), null);
});

test("a closure counts unless the same visit reopened the restaurant", () => {
  assert.equal(closesRestaurant([CLOSED]), true);
  assert.equal(closesRestaurant(["Establishment re-closed by DOHMH."]), true);
  assert.equal(closesRestaurant([CLOSED, "Establishment re-opened by DOHMH."]), false);
  assert.equal(closesRestaurant(["Violations were cited in the following area(s)."]), false);
  assert.equal(closesRestaurant(), false);
});

const detail = (o) => ({
  camis: "1", name: "Joe's Pizza", address: "10 Main Street", boro: "Brooklyn", zipcode: "11211", cuisine: "Pizza",
  notYetInspected: false, latestGrade: { grade: "A", date: "2025-06-10" },
  latest: { date: "2026-10-01", types: ["Cycle Inspection / Initial Inspection"], actions: [], score: 24, violations: [] },
  newerUnscored: null, closedOn: null,
  categories: {
    since: "2023-10-28", years: 3, inspections: 0,
    citywide: { restaurants: 100, rows: [] },
    similar: { restaurants: 3, cuisine: "Pizza", boro: "Brooklyn", rows: null, minRestaurants: 20 }
  },
  ...o
});

test("the detail warns about a closure above the grade", () => {
  const html = detailHtml(detail({ closedOn: "2026-10-01" }));
  assert.match(html, /Closed by the Health Department/);
  assert.ok(html.indexOf("callout-closed") < html.indexOf("Latest grade"));
  assert.doesNotMatch(detailHtml(detail()), /callout-closed/);
});

test("the detail says when a newer visit wasn't scored", () => {
  const html = detailHtml(detail({ newerUnscored: { date: "2026-10-20", types: ["Administrative Miscellaneous / Initial Inspection"] } }));
  assert.match(html, /A newer Administrative Miscellaneous · Initial Inspection visit/);
  assert.match(html, /isn't scored/);
  assert.doesNotMatch(detailHtml(detail()), /A newer/);
});

test("the detail lists critical violations and puts the non-critical ones behind a toggle", () => {
  const violations = [
    { code: "04L", description: "Evidence of mice.", critical: "Critical", category: "contamination-pests" },
    { code: "10F", description: "Non-food contact surface.", critical: "Not Critical", category: "maintenance" }
  ];
  const html = detailHtml(detail({ latest: { ...detail().latest, violations } }));
  const shown = html.slice(0, html.indexOf("non-critical violation"));
  assert.match(shown, /violation-cat">Contamination and pests<\/p><p class="violation-text">Evidence of mice/);
  assert.doesNotMatch(shown, /Non-food contact/);
  assert.match(html, /<summary>Show 1 non-critical violation<\/summary>/);
  assert.match(html, /violation-cat">Facility maintenance<\/p><p class="violation-text">Non-food contact surface/);
  // The toggle doesn't repeat the critical ones
  assert.equal(html.match(/Evidence of mice/g).length, 1);
  // All critical: nothing more to show
  assert.doesNotMatch(detailHtml(detail({ latest: { ...detail().latest, violations: violations.slice(0, 1) } })), /non-critical/);
});

test("search results date the grade next to the badge", () => {
  const r = { camis: "1", name: "Joe's", lastInspected: "2026-10-01", grade: { grade: "A", date: "2021-03-04" } };
  assert.match(resultCardsHtml([r]), /grade-badge[^]*Graded Mar 4, 2021<\/span><\/span>/);
  assert.doesNotMatch(resultCardsHtml([{ ...r, grade: null }]), /Graded/);
});

test("near me results show the distance", () => {
  const r = { camis: "1", name: "Joe's", lastInspected: "2026-10-01", grade: null };
  assert.match(resultCardsHtml([{ ...r, miles: 0.234 }]), /rest-card-place">0\.2 mi · /);
  assert.match(resultCardsHtml([{ ...r, miles: 0.01 }]), /rest-card-place">0\.1 mi · /);
  assert.doesNotMatch(resultCardsHtml([r]), / mi · /);
});

// ---------- Category mapping ----------

test("violation codes map by their two-digit family", () => {
  assert.equal(violationFamily("02G"), "02");
  assert.equal(violationFamily("15-27"), "15");
  assert.equal(categoryFor("02B"), "temperature");
  assert.equal(categoryFor("04L"), "contamination-pests");
  assert.equal(categoryFor("06D"), "hygiene");
  assert.equal(categoryFor("08A"), "pest-prevention");
  assert.equal(categoryFor("09C"), "food-protection");
  assert.equal(categoryFor("10F"), "maintenance");
  assert.equal(categoryFor("20-06"), "signs-permits");
});

test("unknown families go to Other; no code means no category", () => {
  assert.equal(categoryFor("28-06"), OTHER);
  assert.equal(categoryFor("99B"), OTHER);
  assert.equal(categoryFor("77Z"), OTHER);
  assert.equal(categoryFor(null), null);
  assert.equal(categoryFor(""), null);
});

test("each family belongs to one category", () => {
  const families = CATEGORIES.flatMap((c) => c.families);
  assert.equal(new Set(families).size, families.length);
});

test("family totals fold into categories, unknown into Other", () => {
  const totals = totalsFromFamilies([
    { fam: "02", n: "10" }, { fam: "15", n: "2" }, { fam: "20", n: "3" }, { fam: "28", n: "4" }, { fam: "07", n: "1" }
  ]);
  assert.equal(totals.temperature, 10);
  assert.equal(totals["signs-permits"], 5);
  assert.equal(totals.other, 5);
  assert.equal(totals.hygiene, 0);
});

// ---------- Mean calculation ----------

test("mean divides by every inspection, including ones with zero", () => {
  // 3 inspections cited 6 temperature violations in total; 7 more cited none
  const means = perInspection({ temperature: 6, hygiene: 0 }, 10);
  assert.equal(means.temperature, 0.6);
  assert.equal(means.hygiene, 0);
});

test("mean is 0, not NaN, when there were no inspections", () => {
  assert.deepEqual(perInspection({ temperature: 0 }, 0), { temperature: 0 });
});

test("restaurant counts use every violation inside the window, critical or not", () => {
  const insp = groupInspections([
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02G", critical_flag: "Critical" }),
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02B", critical_flag: "Critical" }),
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02H", critical_flag: "Not Critical" }),
    row({ inspection_date: "2022-01-05T00:00:00.000", violation_code: "02B", critical_flag: "Critical" })
  ]);
  assert.equal(countByCategory(insp, "2023-10-27").temperature, 3);
});

// Every category cited at enough inspections, so only the ratio decides.
const REPEATED = Object.fromEntries(["temperature", "hygiene", "maintenance", "other"].map((id) => [id, MIN_REPEAT_INSPECTIONS]));

test("above-mean categories sort first, furthest above first", () => {
  const counts = { temperature: 2, hygiene: 6, maintenance: 1 };
  const means = { temperature: 1, hygiene: 2, maintenance: 2 };
  const rows = compareToMeans(counts, means, REPEATED);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.id), ["hygiene", "temperature"]);
  assert.equal(rows.find((r) => r.id === "maintenance").above, false);
});

test("a category under twice the mean isn't flagged", () => {
  const rows = compareToMeans({ temperature: 1.9, hygiene: 2 }, { temperature: 1, hygiene: 1 }, REPEATED);
  assert.equal(rows.find((r) => r.id === "temperature").above, false);
  assert.equal(rows.find((r) => r.id === "hygiene").above, true);
});

test("a category with no violations isn't flagged even with a zero mean", () => {
  assert.equal(compareToMeans({}, {}, REPEATED).find((x) => x.id === "other").above, false);
});

test("a category with a zero mean is above it with any violation cited at enough inspections", () => {
  const r = compareToMeans({ other: 1 }, { other: 0 }, REPEATED).find((x) => x.id === "other");
  assert.equal(r.above, true);
});

test("a category has to be cited at 2+ separate inspections, however far above the mean", () => {
  // One bad day: a rare category (source) far above the mean, at one inspection.
  const once = compareToMeans({ source: 1 }, { source: 0.026 }, { source: 1 }).find((r) => r.id === "source");
  assert.equal(once.above, false);
  const tooFew = compareToMeans({ source: 1 }, { source: 0.026 }, { source: MIN_REPEAT_INSPECTIONS - 1 }).find((r) => r.id === "source");
  assert.equal(tooFew.above, false);
  const repeated = compareToMeans({ source: 1 }, { source: 0.026 }, { source: MIN_REPEAT_INSPECTIONS }).find((r) => r.id === "source");
  assert.equal(repeated.above, true);
  assert.equal(repeated.inspections, MIN_REPEAT_INSPECTIONS);
});

test("each inspection counts once per category, however many codes it cited there", () => {
  const insp = groupInspections([
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02G", critical_flag: "Critical" }),
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02B", critical_flag: "Critical" }),
    row({ inspection_date: "2025-03-05T00:00:00.000", violation_code: "02H", critical_flag: "Not Critical" }),
    row({ inspection_date: "2025-03-05T00:00:00.000", violation_code: "06D", critical_flag: "Critical" }),
    row({ inspection_date: "2022-01-05T00:00:00.000", violation_code: "02B", critical_flag: "Critical" })
  ]);
  const at = inspectionsByCategory(insp, "2023-10-27");
  assert.equal(at.temperature, 2);
  assert.equal(at.hygiene, 1);
  assert.equal(at.source, 0);
});

test("too few inspections for a pattern isn't shown as an all-clear", () => {
  const rows = compareToMeans({ source: 1 }, { source: 0.026 }, { source: 1 });
  const html = categoryListHtml({ since: "2023-10-28", inspections: 1, citywide: { rows } }, "citywide");
  assert.match(html, /1 inspection since/);
  assert.match(html, /too soon to spot a pattern/);
  assert.doesNotMatch(html, /Nothing stands out/);
});

test("lookback cutoff is N years before today", () => {
  assert.equal(cutoffDate("2026-10-27", 3), "2023-10-27");
});

// ---------- Query building ----------

test("single quotes are escaped in SoQL", () => {
  assert.equal(soqlString("JOE'S"), "'JOE''S'");
  // Apostrophes in search input become word breaks before they reach SoQL
  const { query } = normalizeSearch({ name: "joe's" });
  assert.equal(searchWhere(query), "upper(dba) like '%JOE%S%'");
});

test("multi-word input matches each word in order", () => {
  const { query } = normalizeSearch({ name: "joe  pizza", where: "east 14 street" });
  assert.equal(searchWhere(query), "upper(dba) like '%JOE%PIZZA%' AND upper(street) like '%EAST%14%STREET%'");
});

test("street or ZIP: ZIP, building + street, or street only", () => {
  assert.deepEqual(parseLocation("11211"), { zipcode: "11211" });
  assert.deepEqual(parseLocation("123 Broadway"), { building: "123", street: "BROADWAY" });
  assert.deepEqual(parseLocation("41-41 kissena blvd"), { building: "41-41", street: "KISSENA BLVD" });
  assert.deepEqual(parseLocation("Broadway"), { street: "BROADWAY" });
  assert.equal(parseLocation("  "), null);
});

test("search needs 2+ letters and a real borough; % is matched literally", () => {
  assert.ok(normalizeSearch({ name: "j" }).error);
  assert.ok(normalizeSearch({ name: "joe", boro: "Narnia" }).error);
  assert.equal(normalizeSearch({ name: "joe", boro: "All" }).query.boro, undefined);
  assert.equal(normalizeSearch({ name: "50%" }).query.name, "50");
});

test("_ is not a wildcard, and over-long input is rejected", () => {
  assert.equal(normalizeSearch({ name: "j_e" }).query.name, "J E");
  assert.ok(normalizeSearch({ name: "__" }).error);
  assert.ok(normalizeSearch({ name: "a".repeat(MAX_NAME_LENGTH + 1) }).error);
  assert.ok(normalizeSearch({ name: "joe", where: "1".repeat(MAX_PLACE_LENGTH + 1) }).error);
  assert.ok(normalizeSearch({ name: "a".repeat(MAX_NAME_LENGTH) }).query);
});

test("curly and straight apostrophes search the same way", () => {
  const curly = normalizeSearch({ name: "Joe’s Pizza" }).query;
  assert.deepEqual(curly, normalizeSearch({ name: "joe's pizza" }).query);
  assert.equal(curly.name, "JOE S PIZZA");
  assert.match(searchWhere(curly), /like '%JOE%S%PIZZA%'/);
});

test("near me only works inside NYC", () => {
  assert.ok(normalizeSearch({ name: "joe", lat: "40.73", lng: "-73.99" }).query.near);
  assert.ok(normalizeSearch({ name: "joe", lat: "34.05", lng: "-118.24" }).error);
  assert.ok(normalizeSearch({ name: "joe", lat: "40.744", lng: "-74.0324" }).error); // Hoboken
});

test("near me works without a name, but not with a 1-letter one", () => {
  const { query } = normalizeSearch({ lat: "40.73", lng: "-73.99" });
  assert.equal(query.name, undefined);
  assert.match(searchWhere(query), /^latitude between .* AND longitude between /);
  assert.ok(normalizeSearch({ name: "j", lat: "40.73", lng: "-73.99" }).error);
  assert.ok(normalizeSearch({}).error);
});

test("name searches rank the whole name, then the first word, the start, a later word, anywhere", () => {
  assert.equal(nameRank("joe"),
    "case(upper(dba) like 'JOE', 0, upper(dba) like 'JOE %' OR upper(dba) like 'JOE''%', 1, " +
    "upper(dba) like 'JOE%', 2, upper(dba) like '% JOE%', 3, true, 4)");
  assert.equal(searchParams(normalizeSearch({ name: "joe" }).query).$order, "name_rank, name_length, dba, camis");
  assert.equal(searchParams(normalizeSearch({ where: "11211" }).query).$order, "dba, camis");
});

test("near me sorts nearest first, name or not", () => {
  const near = searchParams(normalizeSearch({ name: "joe", lat: "40.73", lng: "-73.99" }).query);
  assert.equal(near.$order, "distance, dba, camis");
  assert.match(near.$select, /\(latitude - 40\.73\) \* \(latitude - 40\.73\) \+ \(longitude - -73\.99\)/);
  // Union Square to Times Square is about 1.6 miles
  const miles = milesBetween({ lat: 40.7359, lng: -73.9911 }, { lat: 40.758, lng: -73.9855 });
  assert.ok(miles > 1.5 && miles < 1.7);
});

test("a street or ZIP works without a name, but not with a 1-letter one", () => {
  assert.equal(searchWhere(normalizeSearch({ where: "11211" }).query), "zipcode = '11211'");
  assert.equal(searchWhere(normalizeSearch({ where: "broadway", boro: "Manhattan" }).query),
    "boro = 'Manhattan' AND upper(street) like '%BROADWAY%'");
  assert.ok(normalizeSearch({ where: "b" }).error);
  assert.ok(normalizeSearch({ boro: "Manhattan" }).error);
  assert.ok(normalizeSearch({ name: "j", where: "11211" }).error);
});

test("names are title-cased for display", () => {
  assert.equal(titleCase("JOE'S PIZZA"), "Joe's Pizza");
  assert.equal(titleCase("O'BRIEN'S PUB"), "O'Brien's Pub");
  assert.equal(titleCase("NYC BBQ 2ND AVE"), "NYC BBQ 2nd Ave");
});

test("no inspections in the window isn't shown as an all-clear", () => {
  const rows = compareToMeans(perInspection({}, 0), {}, {});
  const cmp = { since: "2023-10-28", inspections: 0, citywide: { rows } };
  const html = categoryListHtml(cmp, "citywide");
  assert.match(html, /no inspections in this window/);
  assert.doesNotMatch(html, /aren't above/);
});

test("an invalid borough is shown with the header's label", () => {
  assert.equal(boroLabel("0"), "Borough unknown");
  assert.equal(boroLabel("Queens"), "Queens");
});

test("problem areas show the restaurant's rate, the benchmark and how many inspections cited it", () => {
  const rows = compareToMeans({ temperature: 1.5 }, { temperature: 0.2 }, { temperature: 4 });
  const html = categoryListHtml({ since: "2023-10-28", inspections: 6, citywide: { rows } }, "citywide");
  assert.match(html, /1\.5 per inspection here vs 0\.2 at the average NYC restaurant \(8 times as often\)/);
  assert.match(html, /Cited at 4 of 6 inspections/);
  assert.match(html, /class="cat-times"[^>]*>8×</);
  assert.match(html, /class="cat-bar is-here" style="width:100\.0%"/);
  assert.equal(rateText(0.04), "0.04");
  assert.equal(rateText(0.004), "under 0.01");
});

test("inspection history lists scored inspections and says which way the score moved", () => {
  const insp = (date, score, grade = null) => ({ date, types: ["Cycle Inspection / Re-inspection"], score, grade });
  const html = historyHtml([insp("2026-10-01", 10, "A"), insp("2026-09-01", 24)]);
  assert.match(html, /Past inspections/);
  assert.match(html, /14 points better than the inspection before it/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 3);
  const many = historyHtml(Array.from({ length: 10 }, (_, i) => insp(`2026-0${(i % 9) + 1}-01`, 12)));
  assert.match(many, /Show 2 older inspections/);
  assert.equal(historyHtml([]), "");
  assert.match(detailHtml(detail({ history: [insp("2026-10-01", 24)] })), /only scored inspection/);
});

test("a cuisine filters exactly and works without a name", () => {
  assert.equal(searchWhere(normalizeSearch({ name: "joe", cuisine: "Pizza" }).query),
    "upper(dba) like '%JOE%' AND cuisine_description = 'Pizza'");
  assert.equal(searchWhere(normalizeSearch({ cuisine: "Coffee/Tea", boro: "Brooklyn" }).query),
    "boro = 'Brooklyn' AND cuisine_description = 'Coffee/Tea'");
  assert.equal(searchWhere(normalizeSearch({ cuisine: "Bob's" }).query), "cuisine_description = 'Bob''s'");
  assert.equal(normalizeSearch({ name: "joe", cuisine: "All" }).query.cuisine, undefined);
  assert.ok(normalizeSearch({ cuisine: "All" }).error);
  assert.ok(normalizeSearch({ name: "j", cuisine: "Thai" }).error);
  assert.ok(normalizeSearch({ cuisine: "a".repeat(MAX_CUISINE_LENGTH + 1) }).error);
});
