/*
 * Drinking water dashboard logic: the lab value parser ("<1", "ND", blanks,
 * placeholders), month completeness and gaps, report card tiles, the history
 * takeaway, nearest stations and the State Plane conversion.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMeasurement, isDetected, measurementText } from "../src/lib/water/parse.js";
import {
  normalizeMonth, latestCompleteMonth, missingMonths, reportCard, verdict, historyTakeaway, summerShare, sharePct, tileStatus,
  nearestSites, addMonths, monthLabel, normalizeDetection, hasEcoli, plainDescription
} from "../src/lib/water/stats.js";
import { monthlyParams, siteMonthlyParams, detectionParams } from "../src/lib/water/soql.js";
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
  const p = monthlyParams();
  assert.match(p.$select, /LIKE '<%' OR upper\(coliform_quanti_tray_mpn_100ml\) = 'ND'/);
  assert.match(p.$select, /residual_free_chlorine_mg_l NOT LIKE '-%'/);
  assert.match(p.$select, /residual_free_chlorine_mg_l::number <= 4/);
  assert.match(p.$select, /turbidity_ntu::number <= 5/);
  assert.match(p.$where, /sample_class IN \('Compliance', 'Operational'\)/);
  assert.match(siteMonthlyParams("2025-10-01", "2026-10-01").$where, /sample_date >= '2025-10-01' AND sample_date < '2026-10-01'/);
  assert.doesNotMatch(detectionParams().$where, /sample_class/); // detections from every class
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

test("report card leaves fluoride out when no samples were tested for it", () => {
  const tiles = reportCard(row("2026-09", 1000, { fl_n: "0", fl_ok: "0", fl_med: null }));
  assert.equal(tiles.length, 4);
});

test("verdict: all clear when every tile is green, else names the ones to check", () => {
  assert.deepEqual(verdict(reportCard(row("2026-09", 1124))),
    { status: "green", title: "All clear", sentence: "Every measure was in its normal range." });
  const v = verdict(reportCard(row("2026-08", 1100, { ecoli_pos: "1" })));
  assert.equal(v.status, "amber");
  assert.equal(v.title, "Mostly clear");
  assert.equal(v.sentence, "4 of 5 measures were in their normal range. Check E. coli below.");
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
});

test("detections parse coliform and E. coli values", () => {
  const d = normalizeDetection({ sample_number: "1", sample_date: "2026-08-03T00:00:00.000", sample_site: "45050",
    sample_class: "Compliance", coliform_quanti_tray_mpn_100ml: "4.2", e_coli_quanti_tray_mpn_100ml: "2" });
  assert.equal(d.date, "2026-08-03");
  assert.ok(hasEcoli(d));
  assert.equal(hasEcoli({ ...d, ecoli: parseMeasurement("<1", "bacteria") }), false);
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
