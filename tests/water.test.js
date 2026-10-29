/*
 * Drinking water dashboard logic: the lab value parser ("<1", "ND", blanks,
 * placeholders), month completeness and gaps, report card tiles, the history
 * takeaway, nearest stations and the State Plane conversion.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMeasurement, isDetected, measurementText } from "../src/lib/water/parse.js";
import { meaningText, stationVerdict } from "../src/lib/water/near-me.js";
import {
  normalizeMonth, latestCompleteMonth, missingMonths, reportCard, verdict, historyTakeaway, summerShare, sharePct, tileStatus,
  nearestSites, addMonths, monthLabel, monthsBetween, isStale, normalizeDetection, hasEcoli, plainDescription, completeMonths,
  laterSamples, followUpText
} from "../src/lib/water/stats.js";
import { historySeries, historyCsvHref } from "../src/lib/water/history.js";
import { bacteriaHtml, compareText } from "../src/lib/water/near-me.js";
import { monthlyParams, siteMonthlyParams, windowTotalParams, detectionParams, followUpParams, latestDateParams } from "../src/lib/water/soql.js";
import { statePlaneToLatLon } from "../src/lib/water/state-plane.js";

// ---------- Parser ----------

test("'<X' is not detected: 0 for bacteria, below the limit for chemistry", () => {
  assert.deepEqual(parseMeasurement("<1", "bacteria"), { status: "not-detected", value: 0, limit: 1, above: false, raw: "<1" });
  assert.deepEqual(parseMeasurement("<0.10", "chemistry"), { status: "not-detected", value: null, limit: 0.1, above: false, raw: "<0.10" });
  assert.equal(parseMeasurement("< 0.3").limit, 0.3);
  assert.equal(isDetected(parseMeasurement("<1", "bacteria")), false);
});

test("'ND' is not detected, in any case, with no limit", () => {
  for (const raw of ["ND", "nd", "N.D.", " ND "]) {
    const b = parseMeasurement(raw, "bacteria");
    assert.equal(b.status, "not-detected", raw);
    assert.equal(b.value, 0);
    assert.equal(b.limit, null);
    assert.equal(parseMeasurement(raw, "chemistry").value, null);
  }
  assert.equal(measurementText(parseMeasurement("ND", "bacteria")), "Not detected");
  assert.equal(measurementText(parseMeasurement("<1", "bacteria")), "Not detected (below 1)");
});

test("blank, null and whitespace are missing, not zero", () => {
  for (const raw of [null, undefined, "", "   "]) {
    const m = parseMeasurement(raw, "bacteria");
    assert.equal(m.status, "missing");
    assert.equal(m.value, null);
    assert.equal(isDetected(m), false);
  }
  assert.equal(measurementText(parseMeasurement("")), "No result");
});

test("negative placeholders (-9, -9.99) and junk are missing", () => {
  assert.equal(parseMeasurement("-9", "bacteria").status, "missing");
  assert.equal(parseMeasurement("-9.99", "chemistry").status, "missing");
  assert.equal(parseMeasurement("pending").status, "missing");
  assert.equal(parseMeasurement("<abc").status, "missing");
});

test("numbers and '>X' are measured; '>X' is flagged as at least X", () => {
  assert.deepEqual(parseMeasurement("0.66"), { status: "measured", value: 0.66, limit: null, above: false, raw: "0.66" });
  const over = parseMeasurement(">200.5", "bacteria");
  assert.equal(over.status, "measured");
  assert.equal(over.value, 200.5);
  assert.equal(over.above, true);
  assert.ok(isDetected(over));
  assert.equal(measurementText(over), "≥200.5");
  assert.ok(isDetected(parseMeasurement("2", "bacteria")));
  assert.equal(isDetected(parseMeasurement("0", "bacteria")), false); // a measured 0 is none found
});

// ---------- SoQL mirrors the parser ----------

test("queries count '<X'/'ND' as not detected, skip negatives and use routine samples", () => {
  const q = monthlyParams().$query;
  assert.match(q, /upper\(coli_t\) IN \('ND', 'ND\.', 'N\.D', 'N\.D\.'\), 'below'/);
  assert.match(q, /case\(cl_k = 'number', cl_t::number\) > 0 AND case\(cl_k = 'number', cl_t::number\) <= 4/);
  assert.match(q, /case\(turb_k = 'number', turb_t::number\) <= 5/);
  assert.match(q, /WHERE sample_class IN \('Compliance', 'Operational'\) \|>/);
  assert.match(siteMonthlyParams("2025-10-01", "2026-10-01").$query, /sample_date >= '2025-10-01' AND sample_date < '2026-10-01'/);
  assert.doesNotMatch(detectionParams().$query, /sample_class IN/); // detections from every class
});

// Text like "NA" must never reach a ::number cast, or Socrata rejects the whole query.
test("queries only cast number-shaped text, and stay under Socrata's URL limit", () => {
  const queries = [monthlyParams(), siteMonthlyParams("2025-10-01", "2026-10-01"),
    windowTotalParams("2025-10-01", "2026-10-01", { bySite: true }), detectionParams()].map((p) => p.$query);
  for (const q of queries) {
    const casts = q.match(/[\w()]+::number/g);
    assert.ok(casts.length > 0);
    for (const cast of casts) assert.match(cast, /^\w+_t::number$/);
    for (const [, k] of q.matchAll(/(\w+)_t::number/g)) {
      assert.ok(q.includes(`case(${k}_k = 'number', ${k}_t::number)`));
    }
    assert.equal(q.match(/::number/g).length, q.match(/case\(\w+_k = 'number', \w+_t::number\)/g).length);
    assert.ok(new URLSearchParams({ $query: q }).toString().length < 7000);
  }
});

test("monthly queries group by month with fluoride; window totals don't ask for it", () => {
  const monthly = monthlyParams().$query;
  assert.match(monthly, /count\(distinct site\) AS sites/);
  assert.match(monthly, /AS fl_ok GROUP BY month ORDER BY month/);
  const site = siteMonthlyParams("2025-10-01", "2026-10-01").$query;
  assert.match(site, /GROUP BY site, month ORDER BY site, month/);
  assert.doesNotMatch(site, /fl_ok/);
  const city = windowTotalParams("2025-10-01", "2026-10-01").$query;
  assert.match(city, /\|> SELECT count\(\*\) AS n, .* LIMIT 1$/);
  assert.doesNotMatch(city, /GROUP BY|AS site/);
  assert.match(windowTotalParams("2025-10-01", "2026-10-01", { bySite: true }).$query, /^SELECT sample_site AS site, .* GROUP BY site ORDER BY site LIMIT 50000$/);
  assert.deepEqual(latestDateParams(), { $select: "max(sample_date) AS latest" });
});

test("detection query lists coliform or E. coli finds, newest first, under the dataset's column names", () => {
  const q = detectionParams().$query;
  assert.match(q, /^SELECT sample_number AS sample_number, sample_date AS sample_date,/);
  assert.match(q, /\|> SELECT sample_number, sample_date, sample_time, sample_site, sample_class, coliform_quanti_tray_mpn_100ml, e_coli_quanti_tray_mpn_100ml WHERE \(coli_k = 'above' OR .*\) OR \(ecoli_k = 'above' OR /);
  assert.match(q, /ORDER BY sample_date DESC, sample_number LIMIT 50000$/);
});

test("follow-up query covers each detection's 14 days and escapes quotes in site codes", () => {
  const p = followUpParams([{ site: "1SCL1", date: "2026-12-25" }, { site: "O'1", date: "2026-08-03" }], 7);
  assert.equal(p.$where,
    "(sample_site = '1SCL1' AND sample_date >= '2026-12-25' AND sample_date <= '2027-01-01') OR " +
    "(sample_site = 'O''1' AND sample_date >= '2026-08-03' AND sample_date <= '2026-08-10')");
  assert.equal(p.$order, "sample_date, sample_number");
});

// ---------- Months ----------

const row = (month, n, extra = {}) => normalizeMonth({
  month: `${month}-01T00:00:00.000`, n: String(n), sites: "370",
  coli_n: String(n), coli_pos: "0", ecoli_n: String(n), ecoli_pos: "0",
  cl_n: String(n), cl_med: "0.6", cl_ok: String(n), turb_n: String(n), turb_med: "0.6", turb_ok: String(n),
  fl_n: "150", fl_med: "0.7", fl_ok: "150", ...extra
});
const year = (from, k, n = 1200) => Array.from({ length: k }, (_, i) => row(addMonths(from, i), n));

test("missingMonths lists months with no samples between the first and last", () => {
  const months = [row("2021-10", 1), row("2021-12", 1), row("2022-01", 1), row("2022-03", 1)];
  assert.deepEqual(missingMonths(months), ["2021-11", "2022-02"]);
  assert.deepEqual(missingMonths([]), []);
});

test("latestCompleteMonth skips a month the data doesn't reach the end of", () => {
  const months = year("2025-10", 12);
  assert.equal(latestCompleteMonth(months, "2026-09-30"), "2026-09");
  assert.equal(latestCompleteMonth(months, "2026-09-28"), "2026-09");
  assert.equal(latestCompleteMonth(months, "2026-09-15"), "2026-08");
});

test("latestCompleteMonth skips a month with far fewer samples than usual", () => {
  const months = [...year("2025-09", 12), row("2026-09", 300)];
  assert.equal(latestCompleteMonth(months, "2026-09-30"), "2026-08");
  // A dip like Feb–Sep 2025 (about 80% of normal) still counts.
  assert.equal(latestCompleteMonth([...year("2025-09", 12), row("2026-09", 1000)], "2026-09-30"), "2026-09");
  assert.equal(latestCompleteMonth([], null), null);
});

test("monthLabel and addMonths cross year boundaries", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2025-11", 2), "2026-01");
  assert.equal(monthLabel("2026-09"), "September 2026");
  assert.equal(monthLabel("2026-09", "short"), "Sep 2026");
});

// ---------- Report card ----------

test("sharePct never rounds to 100% or 0% unless it is", () => {
  assert.equal(sharePct(1124, 1124), "100%");
  assert.equal(sharePct(11239, 11240), ">99.9%");
  assert.equal(sharePct(1117, 1124), "99.4%");
  assert.equal(sharePct(1, 20000), "<0.1%");
  assert.equal(sharePct(0, 0), "–");
});

test("tile colors: 95%+ green, 90–95% amber, below red", () => {
  assert.equal(tileStatus(0.998), "green");
  assert.equal(tileStatus(0.95), "green");
  assert.equal(tileStatus(0.92), "amber");
  assert.equal(tileStatus(0.5), "red");
  assert.equal(tileStatus(null), "none");
});

test("report card: five tiles; E. coli amber on any detection", () => {
  const clean = reportCard(row("2026-09", 1124));
  assert.deepEqual(clean.map((t) => t.key), ["ecoli", "coliform", "chlorine", "turbidity", "fluoride"]);
  assert.ok(clean.every((t) => t.status === "green"));
  assert.equal(clean[2].sentence, "Keeps germs out of the pipes. In the normal range in 100% of samples.");

  const tiles = reportCard(row("2026-08", 1100, { ecoli_pos: "1", coli_pos: "9", cl_ok: "1098" }));
  assert.equal(tiles[0].status, "amber");
  assert.match(tiles[0].sentence, /Found in 1 of 1,100 samples/);
  assert.equal(tiles[1].value, "99.2%");
  assert.equal(tiles[2].status, "green");
});

test("report card: a resample with E. coli turns the tile amber even with no routine detection", () => {
  const only = reportCard(row("2026-09", 1124), { resampleEcoli: 1 })[0];
  assert.equal(only.status, "amber");
  assert.equal(only.sentence, "A sign of sewage. Found in none of 1,124 routine samples, but in 1 resample; details below.");
  assert.equal(only.valueLabel, "of routine samples clear");
  const both = reportCard(row("2026-09", 1124, { ecoli_pos: "2" }), { resampleEcoli: 3 })[0];
  assert.match(both.sentence, /Found in 2 of 1,124 routine samples and in 3 resamples; details below\./);
  assert.equal(verdict(reportCard(row("2026-09", 1124), { resampleEcoli: 1 })).title, "Mostly clear");
});

test("report card leaves fluoride out when no samples were tested for it", () => {
  const tiles = reportCard(row("2026-09", 1000, { fl_n: "0", fl_ok: "0", fl_med: null }));
  assert.equal(tiles.length, 4);
});

test("report card: fluoride below the city's target band isn't green", () => {
  const ok = reportCard(row("2026-09", 1000)).find((t) => t.key === "fluoride");
  assert.equal(ok.status, "green");
  assert.equal(ok.sentence, "Added to prevent cavities. The city aims for about 0.7 mg/L; 100% of samples were between 0.5 and 1.0 mg/L.");
  // No fluoridation: safe, but far under 0.7 in every sample.
  const none = reportCard(row("2026-09", 1000, { fl_med: "0.1", fl_ok: "0" })).find((t) => t.key === "fluoride");
  assert.equal(none.status, "red");
});

test("report card is flagged as old after two months without a newer full month", () => {
  assert.equal(monthsBetween("2025-11", "2026-02"), 3);
  assert.equal(isStale("2026-09", "2026-10-29"), false);
  assert.equal(isStale("2026-09", "2026-11-30"), false);
  assert.equal(isStale("2026-09", "2026-12-01"), true);
});

test("near me: each card gets a one-line verdict", () => {
  const totals = { n: 60, coliN: 60, coliPos: 0, ecoliPos: 0, clN: 60, clOk: 60, turbN: 60, turbOk: 60 };
  assert.deepEqual(stationVerdict({ totals, detections: [] }),
    { status: "green", text: "Looks good. No bacteria found; chlorine and cloudiness normal." });
  const ecoli = stationVerdict({ totals: { ...totals, coliPos: 1, ecoliPos: 1 }, detections: [] });
  assert.equal(ecoli.status, "amber");
  assert.equal(ecoli.text, "Worth a look. E. coli in 1 sample, details below; chlorine and cloudiness normal.");
  const resample = { sampleClass: "Resample_Compliance", ecoli: { status: "measured", value: 1 } };
  assert.match(stationVerdict({ totals, detections: [resample] }).text, /E\. coli in 1 sample/);
  const lowChlorine = stationVerdict({ totals: { ...totals, clOk: 50 }, detections: [] });
  assert.equal(lowChlorine.status, "red");
  assert.equal(lowChlorine.text, "Outside the usual range. No bacteria found; chlorine out of range in more than 5% of samples.");
  assert.equal(stationVerdict({ totals: { n: 0 }, detections: [] }), null);
});

test("near me: the chlorine and cloudiness lines say what normal is", () => {
  assert.equal(meaningText("cl", 995, 1000),
    "Any detectable amount up to 4 mg/L is normal, higher or lower; 99.5% of samples here were in that range.");
  assert.equal(meaningText("turb", 1000, 1000), "Lower is clearer: 100% of samples here were under the state’s 5 NTU standard.");
  assert.equal(meaningText("cl", 0, 0), "");
});

test("verdict: all clear when every tile is green, else names the ones to check", () => {
  assert.deepEqual(verdict(reportCard(row("2026-09", 1124))),
    { status: "green", title: "All clear", sentence: "Every measure looked normal, with at least 95% of samples in range for each." });
  const v = verdict(reportCard(row("2026-08", 1100, { ecoli_pos: "1" })));
  assert.equal(v.status, "amber");
  assert.equal(v.title, "Mostly clear");
  assert.equal(v.sentence, "4 of 5 measures looked normal. Check E. coli below.");
  assert.match(verdict(reportCard(row("2026-08", 100, { coli_pos: "20" }))).sentence, /Check coliform bacteria below/);
});

test("summer share counts coliform detections in June through September", () => {
  const months = [...year("2015-01", 12, 1000)];
  months[6] = row(months[6].month, 1000, { coli_pos: "3" });  // July
  months[0] = row(months[0].month, 1000, { coli_pos: "1" });  // January
  assert.deepEqual(summerShare(months), { share: 0.75, positives: 4 });
  assert.equal(summerShare([...year("2015-01", 12, 1000)]), null);
});

test("history takeaway summarizes bacteria-free samples over the period", () => {
  const months = [...year("2015-01", 60, 1000)];
  months[3] = row(months[3].month, 1000, { coli_pos: "120", ecoli_pos: "1" });
  assert.equal(historyTakeaway(months),
    "Over 5 years (since January 2015), 99.8% of 60,000 routine samples were free of coliform bacteria, and E. coli turned up in 1 (<0.1%).");
  assert.equal(historyTakeaway([]), "");
  assert.match(historyTakeaway(months, 2), /E\. coli turned up in 1 \(<0\.1%\), plus 2 resamples\.$/);
  assert.match(historyTakeaway([...year("2015-01", 12, 1000)], 1), /none had E\. coli \(it turned up in 1 resample\)\.$/);
});

test("history leaves out months after the latest complete one", () => {
  const months = [...year("2026-07", 4, 1000)];   // Jul–Oct
  months[3] = row("2026-10", 200, { coli_pos: "40", ecoli_pos: "1" });  // October, still loading
  const monthly = { completeMonth: "2026-09", months };
  assert.deepEqual(completeMonths(monthly).map((m) => m.month), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(completeMonths({ completeMonth: null, months }), []);
  const det = (date, sampleClass) => ({ date, site: "1", sampleClass, ecoli: parseMeasurement("2", "bacteria") });
  const s = historySeries(monthly, [det("2026-10-02", "Compliance"), det("2026-08-04", "Resample_Compliance")]);
  assert.deepEqual(s.months, ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(Object.keys(s.ecoli), ["2026-08"]);
  assert.equal(s.rows[1].ecoliPositive, 0);   // routine, from the monthly counts
  assert.equal(s.rows[1].ecoliResample, 1);
});

test("history fills gaps with null and leaves out E. coli from outside its months", () => {
  const monthly = { completeMonth: "2026-04", months: [row("2026-01", 1000, { coli_pos: "10" }), row("2026-04", 1000)] };
  const det = (date) => ({ date, site: "1", sampleClass: "Resample_Compliance", ecoli: parseMeasurement("2", "bacteria") });
  const s = historySeries(monthly, [det("2025-12-30"), det("2026-02-10"), det("2026-05-01"),
    { ...det("2026-01-05"), ecoli: parseMeasurement("<1", "bacteria") }]);
  assert.deepEqual(s.months, ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(Object.keys(s.ecoli), ["2026-02"]);
  assert.deepEqual(s.rows[1], { month: "2026-02", samples: 0, coliTested: 0, coliPositive: 0, ecoliPositive: 0, ecoliResample: 1, chlorineMedian: null });
  assert.deepEqual(historySeries({ completeMonth: null, months: [] }), { months: [], ecoli: {}, rows: [] });
});

test("history CSV has one line per month, blanks for unknowns", () => {
  const href = historyCsvHref([
    { month: "2026-01", samples: 1000, coliTested: 990, coliPositive: 3, ecoliPositive: 1, ecoliResample: 2, chlorineMedian: 0.61 },
    { month: "2026-02", samples: 0, coliTested: 0, coliPositive: 0, ecoliPositive: 0, ecoliResample: null, chlorineMedian: null }
  ]);
  assert.match(href, /^data:text\/csv;charset=utf-8,/);
  const lines = decodeURIComponent(href.slice(href.indexOf(",") + 1)).split("\n");
  assert.deepEqual(lines, [
    "month,routine_samples,coliform_tested,coliform_positive,coliform_positive_pct,ecoli_positive,ecoli_positive_resamples,median_free_chlorine_mg_l",
    "2026-01,1000,990,3,0.30,1,2,0.61",
    "2026-02,0,0,0,,0,,",
    ""
  ]);
});

test("station card counts resample detections next to the routine ones", () => {
  const found = [{ date: "2026-08-04", sampleClass: "Resample_Compliance",
    ecoli: parseMeasurement("1", "bacteria"), coliform: parseMeasurement("3", "bacteria") }];
  const html = bacteriaHtml({ totals: { coliN: 40, coliPos: 0 }, detections: found }, "Oct 2025–Sep 2026");
  assert.match(html, /Found in none of 40 routine samples, but in 1 resample \(Oct 2025–Sep 2026\)/);
});

test("station card bacteria: no results, none found, and routine finds listed", () => {
  assert.equal(bacteriaHtml({ totals: { coliN: 0 }, detections: [] }, "Oct 2025–Sep 2026"),
    "<p>None of this station’s samples in Oct 2025–Sep 2026 were tested for bacteria.</p>");
  assert.equal(bacteriaHtml({ totals: { coliN: 1, coliPos: 0 }, detections: [] }, "<range>"),
    "<p>1 sample tested for coliform and E. coli (&#60;range&#62;).</p>");
  const found = [
    { date: "2026-08-04", sampleClass: "Compliance", ecoli: parseMeasurement("1", "bacteria"), coliform: parseMeasurement("2", "bacteria") },
    { date: "2026-03-10", sampleClass: "Operational", ecoli: parseMeasurement("<1", "bacteria"), coliform: parseMeasurement(">200.5", "bacteria") }
  ];
  const html = bacteriaHtml({ totals: { coliN: 40, coliPos: 2 }, detections: found }, "Oct 2025–Sep 2026");
  assert.match(html, /^<p>Found in 2 of 40 routine samples \(Oct 2025–Sep 2026\)\. /);
  const items = html.match(/<li>.*?<\/li>/g);
  assert.equal(items.length, 2);
  assert.match(items[0], /<strong>E\. coli 1<\/strong>, coliform 2 MPN\/100 mL<\/li>$/);
  assert.doesNotMatch(items[1], /E\. coli|resample/);
  assert.match(items[1], /coliform ≥200\.5 MPN\/100 mL/);
});

test("compareText: within 10% (or 0.05) is about the same", () => {
  assert.equal(compareText(0.52, 0.66, "mg/L"), "Lower than the citywide median (0.52 vs. 0.66 mg/L).");
  assert.equal(compareText(0.9, 0.66, "mg/L"), "Higher than the citywide median (0.9 vs. 0.66 mg/L).");
  assert.equal(compareText(0.7, 0.66, "mg/L"), "About the same as the citywide median (0.7 vs. 0.66 mg/L).");
  assert.equal(compareText(0.1, 0.06, "NTU"), "About the same as the citywide median (0.1 vs. 0.06 NTU).");
  assert.equal(compareText(1.09, 1, "NTU"), "About the same as the citywide median (1.09 vs. 1 NTU).");
  assert.equal(compareText(1.11, 1, "NTU"), "Higher than the citywide median (1.11 vs. 1 NTU).");
  assert.equal(compareText(null, 0.66, "mg/L"), "Not enough results to compare.");
  assert.equal(compareText(0.5, null, "mg/L"), "Not enough results to compare.");
});

test("detections parse coliform and E. coli values", () => {
  const d = normalizeDetection({ sample_number: "1", sample_date: "2026-08-03T00:00:00.000", sample_site: "45050",
    sample_class: "Compliance", coliform_quanti_tray_mpn_100ml: "4.2", e_coli_quanti_tray_mpn_100ml: "2" });
  assert.equal(d.date, "2026-08-03");
  assert.ok(hasEcoli(d));
  assert.equal(hasEcoli({ ...d, ecoli: parseMeasurement("<1", "bacteria") }), false);
});

const sample = (date, time, sampleClass, ecoli = "<1", coliform = "<1", number = `${date}-${time}`) => normalizeDetection({
  sample_number: number, sample_date: `${date}T00:00:00.000`, sample_time: time, sample_site: "45050",
  sample_class: sampleClass, coliform_quanti_tray_mpn_100ml: coliform, e_coli_quanti_tray_mpn_100ml: ecoli
});

test("later samples include same-day ones taken after the detection, not the detection itself", () => {
  const d = sample("2026-08-03", "8:41", "Compliance", "2", "4.2", "1");
  const all = [
    d,
    sample("2026-08-03", "7:10", "Compliance"),             // earlier that morning
    sample("2026-08-03", "11:05", "Resample_Compliance"),   // same day, later
    { ...sample("2026-08-05", "8:34", "Compliance"), site: "99999" },
    sample("2026-08-17", "9:00", "Compliance"),             // the 14th day
    sample("2026-08-18", "9:00", "Compliance")              // too late
  ];
  assert.deepEqual(laterSamples(d, all).map((f) => `${f.date} ${f.time}`), ["2026-08-03 11:05", "2026-08-17 9:00"]);
  // Without times, same-day samples other than the detection count.
  assert.equal(laterSamples({ ...d, time: null }, all).length, 3);
  assert.match(followUpParams([d]).$where, /sample_date >= '2026-08-03' AND sample_date <= '2026-08-17'/);
});

test("follow-up text only calls labeled resamples resamples", () => {
  const d = sample("2026-08-03", "8:41", "Compliance", "2");
  assert.equal(followUpText({ ...d, followUps: [] }), "No later samples at this station in the data within 14 days.");
  assert.equal(followUpText({ ...d, followUps: [sample("2026-08-05", "8:34", "Compliance"), sample("2026-08-15", "10:01", "Compliance")] }),
    "2 later routine samples Aug 5–Aug 15: all clear (no coliform or E. coli).");
  assert.equal(followUpText({ ...d, followUps: [
    sample("2026-08-04", "8:00", "Resample_Compliance"), sample("2026-08-04", "8:20", "Resample_Compliance", "<1", "3"),
    sample("2026-08-12", "9:00", "Compliance", "1")
  ] }), "2 resamples on Aug 4: no E. coli; 1 had coliform bacteria. Also 1 later routine sample on Aug 12: it also had E. coli.");
});

// ---------- Places ----------

test("nearestSites sorts by distance and skips sites with no coordinates", () => {
  const sites = [
    { site: "far", lat: 40.9, lon: -73.9 },
    { site: "none", lat: null, lon: null },
    { site: "near", lat: 40.7485, lon: -73.9857 },
    { site: "mid", lat: 40.76, lon: -73.98 }
  ];
  const got = nearestSites(sites, { lat: 40.7484, lon: -73.9857 }, 2);
  assert.deepEqual(got.map((s) => s.site), ["near", "mid"]);
  assert.ok(got[0].miles < 0.01);
});

test("State Plane (EPSG:2263) feet convert to lat/lon", () => {
  // Empire State Building
  const { lat, lon } = statePlaneToLatLon(988224, 211951);
  assert.ok(Math.abs(lat - 40.7484) < 0.0002, String(lat));
  assert.ok(Math.abs(lon - -73.9857) < 0.0002, String(lon));
});

test("plainDescription expands DEP's surveyor shorthand", () => {
  assert.equal(plainDescription("SS - IFO 127-11 E/S Farmers Blvd (Keyspan), 2nd SS N/O Merrick Blvd"),
    "In front of 127-11 on the east side of Farmers Blvd (Keyspan), 2nd station north of Merrick Blvd");
});
