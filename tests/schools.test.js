/*
 * NYC School Quality Explorer logic: reading values (blanks, scale, the
 * inverted chronic absence field), formatting, DOE target bands, NYC average
 * comparisons, trends and gaps; the curated metric config; and search (name
 * and DBN matching, address words, filters, counts, sorting, the URL round-trip).
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { typeSlug, boroughFromDbn, districtFromDbn, yearLabel, normalizeDbn, REPORTS, TYPES } from "../src/lib/schools/config.js";
import { METRICS, METRIC_KEYS, metricsFor, cardMetrics } from "../src/lib/schools/metrics.js";
import {
  toNumber, normalize, pointFromRow, formatValue, targetBand, compare, verdict, trend, gapYears, latestYearWithValue
} from "../src/lib/schools/values.js";
import {
  words, parseDbn, dbnMatches, nameScore, addressMatches, editDistance, normalizeQuery, queryToParams,
  searchSchools, searchPoints, sortValue
} from "../src/lib/schools/filter.js";
import { cardsHtml, statusText, addressText } from "../src/lib/schools/render.js";

const metric = (id) => METRICS.find((m) => m.id === id);
const ELA = metric("prof_pct_ela_all");
const ABSENT = metric("chronic_absent_ems_all");
const CCR = metric("ccr_4yr_all");
const ATTEND_CHANGE = metric("attend_increase_mean_all");
const q = (s = "") => normalizeQuery(new URLSearchParams(s)).query;

// ---------- Config ----------

test("DBNs give the borough and district", () => {
  assert.equal(boroughFromDbn("02M475"), "Manhattan");
  assert.equal(boroughFromDbn("10X445"), "Bronx");
  assert.equal(boroughFromDbn("31R080"), "Staten Island");
  assert.equal(boroughFromDbn("bad"), null);
  assert.equal(districtFromDbn("15K321").label, "District 15");
  assert.equal(districtFromDbn("84X491").label, "Charter school");
  assert.equal(districtFromDbn("75X754").code, 75);
  assert.equal(yearLabel(2024), "2024–25");
  assert.equal(yearLabel(2019), "2019–20");
});

test("school types: elementary/middle reports split by school_type, early childhood grade spans fold together", () => {
  assert.equal(typeSlug("EMS", "Middle"), "middle");
  assert.equal(typeSlug("EMS", "K-8"), "k-8");
  assert.equal(typeSlug("EMS", "Elementary"), "elementary");
  assert.equal(typeSlug("EC", "K-2"), "early-childhood");
  assert.equal(typeSlug("HST", "High School Transfer"), "transfer");
  assert.equal(typeSlug("YABC", "YABC"), "yabc");
  for (const t of TYPES) assert.ok(REPORTS[t.report], t.slug);
});

test("metric config: ids unique within each report, 6–10 per main type, at most 3 cards, keys listed once", () => {
  for (const report of Object.keys(REPORTS)) {
    const list = metricsFor(report);
    assert.equal(new Set(list.map((m) => m.id)).size, list.length, report);
    assert.equal(new Set(list.map((m) => `${m.key}|${m.field ?? ""}`)).size, list.length, report);
    assert.ok(cardMetrics(report).length >= 2 && cardMetrics(report).length <= 3, report);
    for (const m of list) {
      assert.ok(m.label && m.description, m.id);
      assert.ok(["percent", "points", "count"].includes(m.format), m.id);
    }
  }
  for (const report of ["EMS", "HS"]) {
    const n = metricsFor(report).length;
    assert.ok(n >= 6 && n <= 10, `${report}: ${n}`);
  }
  assert.equal(new Set(METRIC_KEYS).size, METRIC_KEYS.length);
  // Card metrics come first on the school page, in card order
  assert.deepEqual(metricsFor("HST").slice(0, 2).map((m) => m.id), ["grad_pct_6_transfer", "pct_cer_6mo_all"]);
});

// ---------- Values ----------

test("blank and suppressed values are null, never 0", () => {
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber(""), null);
  assert.equal(toNumber("N<15"), null);
  assert.equal(toNumber("s"), null);
  assert.equal(toNumber("."), null);
  assert.equal(toNumber("0"), 0);
  assert.equal(toNumber("0.584"), 0.584);
  assert.equal(toNumber("-0.017"), -0.017);
  assert.equal(normalize(ELA, undefined), null);
  assert.equal(formatValue(ELA, null), "Not reported");
});

test("chronic absence is inverted (the field holds 90%+ attendance); CCR's 0–100 scale is divided", () => {
  assert.equal(normalize(ABSENT, "0.918"), 0.082);
  assert.equal(normalize(ABSENT, "1"), 0);
  assert.equal(normalize(CCR, "96.9"), 0.969);
  const p = pointFromRow(ABSENT, { metric_value: "0.584", comparison_group_average: "0.7", metric_score: "2.1", number_of_students: "178" });
  assert.deepEqual(p, { v: 0.416, cmp: 0.3, score: 2.1, n: 178 });
  const students = METRICS.find((m) => m.id === "students_ems");
  assert.deepEqual(pointFromRow(students, { metric_value: "0.95", number_of_students: "1246" }), { v: 1246, cmp: null, score: null, n: 1246 });
});

test("formatting: whole percents, one decimal under 10%, signed points, counts", () => {
  assert.equal(formatValue(ELA, 0.887), "89%");
  assert.equal(formatValue(ELA, 0.061), "6.1%");
  assert.equal(formatValue(ELA, 0), "0%");
  assert.equal(formatValue(ELA, 0.997), "99.7%");
  assert.equal(formatValue(ELA, 1), "100%");
  assert.equal(formatValue(ATTEND_CHANGE, -0.085), "−8.5 pts");
  assert.equal(formatValue(ATTEND_CHANGE, 0.012), "+1.2 pts");
  assert.equal(formatValue(METRICS.find((m) => m.id === "students_hs"), 3267), "3,267");
});

test("DOE target bands follow the 1.00–4.99 metric score", () => {
  assert.equal(targetBand(4.99).label, "Exceeding target");
  assert.equal(targetBand(4).label, "Exceeding target");
  assert.equal(targetBand(3.99).label, "Meeting target");
  assert.equal(targetBand(2).label, "Approaching target");
  assert.equal(targetBand(1).label, "Not meeting target");
  assert.equal(targetBand(null), null);
  assert.equal(targetBand(0), null);
});

test("comparisons are in points, and know which way is better", () => {
  assert.deepEqual(compare(ELA, 0.887, 0.591), { dir: "above", text: "30 pts above", good: true });
  assert.deepEqual(compare(ABSENT, 0.061, 0.3), { dir: "below", text: "24 pts below", good: true });
  assert.equal(compare(ELA, 0.5, 0.504).dir, "same");
  assert.equal(compare(ELA, 0.51, 0.5).text, "1 pt above");
  // Compares the numbers as shown: 54% vs 54% is the same, however they round
  assert.equal(compare(ELA, 0.544, 0.536).dir, "same");
  assert.equal(compare(ELA, null, 0.5), null);
});

test("verdict: better or worse than NYC, similar within 2 pts", () => {
  assert.equal(verdict(ELA, 0.42, 0.59), "worse");
  assert.equal(verdict(ABSENT, 0.061, 0.3), "better");
  assert.equal(verdict(ABSENT, 0.54, 0.3), "worse");
  assert.equal(verdict(ELA, 0.61, 0.59), "similar");
  assert.equal(verdict(ELA, 0.62, 0.59), "better");
  assert.equal(verdict(ELA, 0.5, null), null);
});

test("trend: last 3 years with a value, slope over the span, direction by higher-is-better", () => {
  const pts = (o) => Object.fromEntries(Object.entries(o).map(([y, v]) => [y, { v }]));
  assert.equal(trend(metric("grad_pct_4_all"), pts({ 2022: 0.8, 2023: 0.84, 2024: 0.86 })).dir, "improving");
  assert.equal(trend(metric("grad_pct_4_all"), pts({ 2022: 0.86, 2023: 0.85, 2024: 0.87 })).dir, "steady");
  assert.equal(trend(metric("grad_pct_4_all"), pts({ 2020: 0.95, 2022: 0.9, 2023: 0.86, 2024: 0.85 })).dir, "declining");
  // Falling absenteeism is improving
  const down = trend(ABSENT, pts({ 2022: 0.4, 2023: 0.35, 2024: 0.3 }));
  assert.equal(down.dir, "improving");
  assert.ok(down.change < 0);
  // Blanks are skipped, so the 3 years can span a gap
  assert.deepEqual(trend(metric("grad_pct_4_all"), pts({ 2017: 0.7, 2018: null, 2021: 0.75, 2022: 0.8 })).years, [2017, 2021, 2022]);
  // ELA trends start at the new tests (2022–23)
  const ela = trend(ELA, pts({ 2017: 0.3, 2018: 0.35, 2021: 0.4, 2022: 0.5, 2023: 0.52 }));
  assert.equal(ela.dir, null);
  assert.deepEqual(ela.years, [2022, 2023]);
  assert.equal(trend(ELA, {}).dir, null);
});

test("gaps: blank years inside the span, with the COVID-19 reason when known", () => {
  const points = { 2017: { v: 0.5 }, 2018: { v: 0.5 }, 2019: { v: null }, 2021: { v: 0.6 }, 2024: { v: null } };
  const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
  const gaps = gapYears(ELA, points, years);
  assert.deepEqual(gaps.map((g) => g.year), [2019, 2020]);
  assert.match(gaps[0].reason, /COVID-19/);
  assert.match(gaps[1].reason, /optional/);
  // Not a state test: no testing explanation
  assert.equal(gapYears(metric("grad_pct_4_all"), points, years)[0].reason, "Not reported this year.");
  assert.equal(latestYearWithValue(points), 2021);
});

// ---------- Matching ----------

test("words: P.S. and leading zeros normalize, ordinals drop", () => {
  assert.deepEqual(words("P.S. 015 Roberto Clemente"), ["ps", "15", "roberto", "clemente"]);
  assert.deepEqual(words("I.S 429"), ["is", "429"]);
  assert.deepEqual(words("Children's School"), ["childrens", "school"]);
  assert.deepEqual(words("7th Ave"), ["7", "ave"]);
});

test("DBN search: full, without the leading zero, or without the district", () => {
  assert.deepEqual(parseDbn("02M475"), { district: "02", letter: "M", number: "475" });
  assert.deepEqual(parseDbn("2m475"), { district: "02", letter: "M", number: "475" });
  assert.deepEqual(parseDbn("M475"), { district: null, letter: "M", number: "475" });
  assert.equal(parseDbn("ps 321"), null);
  assert.ok(dbnMatches("02M475", parseDbn("m475")));
  assert.ok(!dbnMatches("02M475", parseDbn("03M475")));
});

test("names: word starts, one-letter typos, and lined-up names rank first", () => {
  const ps321 = words("P.S. 321 William Penn");
  assert.ok(nameScore(words("ps 321"), ps321));
  assert.ok(nameScore(words("ps 32"), ps321)); // still typing
  assert.ok(nameScore(words("william pen"), ps321));
  assert.equal(nameScore(words("ps 322"), ps321), 0);
  assert.ok(nameScore(words("stuyvesent"), words("Stuyvesant High School")));
  assert.ok(nameScore(words("the stuyvesant"), words("Stuyvesant High School")));
  assert.equal(nameScore(words("xyz"), ps321), 0);
  assert.ok(nameScore(words("brooklyn tech"), words("Brooklyn Technical High School")) >
    nameScore(words("brooklyn tech"), words("Brooklyn High School for Law and Technology")));
  assert.equal(editDistance("stuyvesent", "stuyvesant"), 1);
});

test("addresses: abbreviations, ZIPs and numbers match whole words", () => {
  const place = words("180 7 Avenue 11215 Park Slope-Gowanus Brooklyn");
  assert.ok(addressMatches(words("7th ave"), place));
  assert.ok(addressMatches(words("11215"), place));
  assert.ok(addressMatches(words("park slope"), place));
  assert.ok(addressMatches(words("brooklyn"), place));
  assert.ok(!addressMatches(words("1121"), place));
  assert.ok(!addressMatches(words("17 ave"), place));
  assert.ok(addressMatches(words("st nicholas"), words("401 St Nicholas Avenue")));
  assert.ok(addressMatches(words("e 4 st"), words("333 East 4 Street")));
});

test("DBNs: short or lower-case links normalize to the full DBN", () => {
  assert.equal(normalizeDbn("02M475"), "02M475");
  assert.equal(normalizeDbn("2M475"), "02M475");
  assert.equal(normalizeDbn(" 2m475 "), "02M475");
  assert.equal(normalizeDbn("2M5"), "02M005");
  assert.equal(normalizeDbn("15k321"), "15K321");
  for (const bad of ["M475", "02Z475", "02M4750", "123M475", "", null, undefined]) assert.equal(normalizeDbn(bad), null);
});

// ---------- Search ----------

const school = (dbn, name, types, extra = {}) => ({
  dbn, name, boro: boroughFromDbn(dbn), district: districtFromDbn(dbn).label, current: true,
  loc: { address: "1 Main Street", zip: "10001", neighborhood: null, lat: 40.7, lon: -74 },
  types, reports: [{ report: types[0] === "high-school" ? "HS" : "EMS", type: types[0], year: 2024 }],
  values: {}, ...extra
});
const INDEX = {
  latestYear: 2024,
  cityAvg: { elementary: { prof_pct_ela_all: { 2024: 0.59 } }, middle: { prof_pct_ela_all: { 2024: 0.45 } } },
  schools: [
    school("15K321", "P.S. 321 William Penn", ["elementary"], {
      loc: { address: "180 7 Avenue", zip: "11215", neighborhood: "Park Slope-Gowanus", lat: 40.67, lon: -73.98 },
      values: { prof_pct_ela_all: { v: 0.887, s: null, y: 2024 }, chronic_absent_ems_all: { v: 0.061, s: 4.5, y: 2024 } }
    }),
    school("02M475", "Stuyvesant High School", ["high-school"], { values: { grad_pct_4_all: { v: 0.997, s: 4.9, y: 2024 } } }),
    school("17K382", "Academy for College Preparation", ["high-school", "middle"], {
      values: { prof_pct_ela_all: { v: 0.5, s: null, y: 2024 }, grad_pct_4_all: { v: 0.91, s: 4.1, y: 2024 } }
    }),
    school("10X100", "P.S. 100 Isaac Clason", ["elementary"], { loc: null }),
    school("21K411", "Abraham Lincoln Yabc", ["yabc"], { current: false, reports: [{ report: "YABC", type: "yabc", year: 2018 }] })
  ]
};

test("search: every current school by default, older ones on request, with counts", () => {
  const all = searchSchools(INDEX, q());
  assert.equal(all.total, 4);
  assert.equal(all.facets.older, 1);
  assert.deepEqual(all.results.map((r) => r.dbn), ["17K382", "10X100", "15K321", "02M475"]); // A–Z, numbers in order
  assert.equal(searchSchools(INDEX, q("all=1")).total, 5);
  assert.equal(all.facets.types.middle, 1);
  assert.equal(all.facets.types["high-school"], 2);
  assert.equal(all.facets.boros.brooklyn, 2);
});

test("search: filters combine; each count ignores its own filter", () => {
  const r = searchSchools(INDEX, q("type=high-school&boro=brooklyn"));
  assert.deepEqual(r.results.map((x) => x.dbn), ["17K382"]);
  assert.equal(r.facets.types.elementary, 1); // Brooklyn elementary schools, ignoring the type filter
  assert.equal(r.facets.boros.manhattan, 1); // high schools in Manhattan, ignoring the borough filter
  assert.deepEqual(searchSchools(INDEX, q("type=middle")).results.map((x) => x.dbn), ["17K382"]);
  assert.deepEqual(searchSchools(INDEX, q("where=park%20slope")).results.map((x) => x.dbn), ["15K321"]);
  assert.deepEqual(searchSchools(INDEX, q("q=02m475")).results.map((x) => x.dbn), ["02M475"]);
  assert.deepEqual(searchSchools(INDEX, q("q=ps%20100")).results.map((x) => x.dbn), ["10X100"]);
  assert.equal(searchSchools(INDEX, q("q=zzzz")).total, 0);
});

test("search: metric sorts put schools without the measure last", () => {
  assert.deepEqual(searchSchools(INDEX, q("sort=ela")).results.map((r) => r.dbn), ["15K321", "17K382", "10X100", "02M475"]);
  assert.deepEqual(searchSchools(INDEX, q("sort=grad")).results.slice(0, 2).map((r) => r.dbn), ["02M475", "17K382"]);
  assert.equal(searchSchools(INDEX, q("sort=absent")).results[0].dbn, "15K321");
  // Scores from before the 2023 tests aren't ranked with newer ones
  const old = school("01M999", "Old School", ["elementary"], { values: { prof_pct_ela_all: { v: 0.99, s: null, y: 2021 } } });
  assert.equal(sortValue(old, "ela"), null);
});

test("search: a metric sort uses the card report's measure, and cards show it when it isn't a card measure", () => {
  const sixTwelve = school("13K527", "Urban Assembly School", ["high-school", "middle"], {
    reports: [{ report: "HS", type: "high-school", year: 2024 }, { report: "EMS", type: "middle", year: 2024 }],
    values: { chronic_absent_ems_all: { v: 0.1, s: null, y: 2024 }, chronic_absent_hs_all: { v: 0.4, s: null, y: 2024 } }
  });
  const index = {
    ...INDEX,
    cityAvg: { ...INDEX.cityAvg, "high-school": { chronic_absent_hs_all: { 2024: 0.35 } }, middle: { ...INDEX.cityAvg.middle, chronic_absent_ems_all: { 2024: 0.3 } } },
    schools: [...INDEX.schools, sixTwelve]
  };
  assert.deepEqual(sortValue(sixTwelve, "absent"), { v: 0.4, higherIsBetter: false });
  const r = searchSchools(index, q("sort=absent"));
  assert.deepEqual(r.results.slice(0, 2).map((x) => x.dbn), ["15K321", "13K527"]);
  const card = r.results.find((x) => x.dbn === "13K527");
  assert.deepEqual(card.sorted, { id: "chronic_absent_hs_all", city: 0.35 });
  assert.match(cardsHtml([card], 2024), /Chronic absenteeism[\s\S]*40%[\s\S]*5 pts above NYC avg \(35%\)/);
  // A high school without the measure still shows it, as not reported; without a metric sort, nothing extra.
  const stuy = r.results.find((x) => x.dbn === "02M475");
  assert.equal(stuy.sorted.id, "chronic_absent_hs_all");
  assert.match(cardsHtml([stuy], 2024), /Chronic absenteeism[\s\S]*Not reported/);
  assert.equal(searchSchools(index, q()).results[0].sorted, null);
  // Elementary cards already show absenteeism: no second row.
  const ps321 = cardsHtml(r.results.filter((x) => x.dbn === "15K321"), 2024);
  assert.equal(ps321.match(/Chronic absenteeism/g).length, 1);
});

test("search: elementary, middle and K-8 cards each get their own type's NYC average", () => {
  const middle = school("13K113", "M.S. 113 Ronald Edmonds", ["middle"], { values: { prof_pct_ela_all: { v: 0.5, s: null, y: 2024 } } });
  const k8 = school("15K130", "P.S. 130 The Parkside", ["k-8"], { values: { prof_pct_ela_all: { v: 0.7, s: null, y: 2024 } } });
  const index = { ...INDEX, schools: [...INDEX.schools, middle, k8] };
  const card = (dbn) => searchSchools(index, q("all=1")).results.find((r) => r.dbn === dbn);
  assert.deepEqual(card("15K321").city, { prof_pct_ela_all: 0.59 });
  assert.deepEqual(card("13K113").city, { prof_pct_ela_all: 0.45 });
  assert.deepEqual(card("15K130").city, {}); // no K-8 average: nothing to compare, not the elementary one
  assert.match(cardsHtml([card("13K113")], 2024), /5 pts above NYC avg \(45%\)/);
  assert.equal(searchSchools(index, q("type=middle&sort=ela")).results.find((r) => r.dbn === "13K113").sorted.city, 0.45);
});

test("search: pages clamp, map points skip schools without a location", () => {
  const r = searchSchools(INDEX, q("page=9"), { pageSize: 2 });
  assert.equal(r.page, 2);
  assert.equal(r.pages, 2);
  const map = searchPoints(INDEX, q());
  assert.equal(map.total, 4);
  assert.equal(map.missing, 1);
  assert.deepEqual(map.points.find((p) => p[2] === "15K321"), [40.67, -73.98, "15K321", "P.S. 321 William Penn", "elementary"]);
});

test("URL state round-trips; bad values fall back to defaults; long text is refused", () => {
  const query = q("q=ps%20321&type=middle&boro=queens&where=11215&all=1&sort=ela&page=3");
  assert.equal(queryToParams(query).toString(), "q=ps+321&type=middle&boro=queens&where=11215&all=1&sort=ela&page=3");
  assert.deepEqual(q("type=nope&boro=jersey&sort=best&page=-2"), { q: "", type: "", boro: "", where: "", all: false, sort: "", page: 1 });
  assert.ok(normalizeQuery(new URLSearchParams(`q=${"a".repeat(81)}`)).error);
});

test("cards: card metrics with the NYC average, 'Address not available', older reports labeled", () => {
  const r = searchSchools(INDEX, q("all=1"));
  const html = cardsHtml(r.results, 2024);
  assert.match(html, /ELA proficiency/);
  assert.match(html, /89%/);
  assert.match(html, /data-verdict="better">30 pts above NYC avg \(59%\)<span class="sr-only"> \(better\)<\/span>/);
  assert.match(html, /Address not available/);
  assert.match(html, /Latest report: 2018–19/);
  assert.match(html, /href="\/school-quality\/15K321\/"/);
  assert.equal(addressText({ address: "180 7 Avenue", zip: "11215" }), "180 7 Avenue, 11215");
  assert.equal(statusText({ total: 30, page: 1, pages: 2, q: "ps", sort: "" }), "30 schools · page 1 of 2 · best matches first");
  assert.equal(statusText({ total: 30, page: 1, pages: 2 }, "map"), "30 schools");
});
