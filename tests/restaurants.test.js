/*
 * Restaurant inspection logic: grade selection, the 1900-01-01 placeholder,
 * the violation category mapping and the per-restaurant mean.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  latestGrade, groupInspections, isInspected, countByCategory, totalsFromFamilies,
  perInspection, compareToMeans, cutoffDate, gradeInfo, scoreBand, titleCase, boroLabel
} from "../src/lib/restaurants/inspections.js";
import { categoryFor, violationFamily, CATEGORIES, OTHER } from "../src/lib/restaurants/violation-categories.js";
import { parseLocation, searchWhere, normalizeSearch, soqlString, MAX_NAME_LENGTH, MAX_PLACE_LENGTH } from "../src/lib/restaurants/soql.js";
import { categoryBarsHtml } from "../src/lib/restaurants/render.js";

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

test("restaurant counts only use critical violations inside the window", () => {
  const insp = groupInspections([
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02G", critical_flag: "Critical" }),
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02B", critical_flag: "Critical" }),
    row({ inspection_date: "2026-01-05T00:00:00.000", violation_code: "02H", critical_flag: "Not Critical" }),
    row({ inspection_date: "2022-01-05T00:00:00.000", violation_code: "02B", critical_flag: "Critical" })
  ]);
  assert.equal(countByCategory(insp, "2023-10-27").temperature, 2);
});

test("above-mean categories sort first, furthest above first", () => {
  const counts = { temperature: 2, hygiene: 6, maintenance: 1 };
  const means = { temperature: 1, hygiene: 2, maintenance: 2 };
  const rows = compareToMeans(counts, means);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.id), ["hygiene", "temperature"]);
  assert.equal(rows.find((r) => r.id === "maintenance").above, false);
});

test("a category with a zero mean is above it with any violation", () => {
  const r = compareToMeans({ other: 1 }, { other: 0 }).find((x) => x.id === "other");
  assert.equal(r.above, true);
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
});

test("names are title-cased for display", () => {
  assert.equal(titleCase("JOE'S PIZZA"), "Joe's Pizza");
  assert.equal(titleCase("O'BRIEN'S PUB"), "O'Brien's Pub");
  assert.equal(titleCase("NYC BBQ 2ND AVE"), "NYC BBQ 2nd Ave");
});

test("no inspections in the window isn't shown as an all-clear", () => {
  const rows = compareToMeans(perInspection({}, 0), {});
  const cmp = { since: "2023-10-28", inspections: 0, citywide: { rows } };
  const html = categoryBarsHtml(cmp, "citywide");
  assert.match(html, /no inspections in this window/);
  assert.doesNotMatch(html, /aren't above/);
});

test("an invalid borough is shown with the header's label", () => {
  assert.equal(boroLabel("0"), "Borough unknown");
  assert.equal(boroLabel("Queens"), "Queens");
});
