/*
 * City Payroll Spending: fiscal-year CPI averages (including months BLS
 * skipped), inflation adjustment, the "after inflation" card, and how
 * overtime is spread across agencies.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cpiByFiscalYear } from "../src/lib/payroll/cpi.js";
import { inflationFactor, inRealDollars, changeSince, realChangeCard } from "../src/lib/payroll-inflation.js";
import { overtimeDependence, overtimeLeaders, dependenceHtml } from "../src/lib/payroll-overtime.js";

// Every month of calendar years 2023–2025 at a flat value per calendar year.
const months = [2023, 2024, 2025].flatMap((year) =>
  Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1, value: { 2023: 100, 2024: 110, 2025: 120 }[year] })));

test("a fiscal year averages July through June", () => {
  const { index, short, missing } = cpiByFiscalYear(months, [2024, 2025]);
  assert.deepEqual(index, { 2024: 105, 2025: 115 });
  assert.deepEqual(short, {});
  assert.deepEqual(missing, []);
});

test("a skipped month is averaged around; too many skipped leaves the year out", () => {
  const noOctober = months.filter((m) => !(m.year === 2024 && m.month === 10));
  const { index, short } = cpiByFiscalYear(noOctober, [2025]);
  assert.equal(index[2025], Number(((5 * 110 + 6 * 120) / 11).toFixed(3)));
  assert.deepEqual(short, { 2025: 11 });

  const sparse = months.filter((m) => !(m.year === 2024 && m.month >= 9));
  const result = cpiByFiscalYear(sparse, [2025, 2026]);
  assert.deepEqual(result.missing, [2025, 2026]);
  assert.deepEqual(result.index, {});
});

const cpi = { baseFiscalYear: 2026, index: { 2024: 100, 2025: 110, 2026: 125 } };
const year = (fiscalYear, regular, overtime, other) =>
  ({ fiscalYear, regular, overtime, other, total: regular + overtime + other, peoplePaid: 1, activeJune30: 1 });

test("amounts are restated in the latest fiscal year's dollars", () => {
  assert.equal(inflationFactor(cpi, 2024), 1.25);
  assert.equal(inflationFactor(cpi, 2026), 1);
  assert.equal(inflationFactor(cpi, 2019), null);

  const [y24, y26] = inRealDollars([year(2024, 80, 16, 4), year(2026, 100, 20, 5)], cpi);
  assert.deepEqual([y24.regular, y24.overtime, y24.other, y24.total, y24.asPaid], [100, 20, 5, 125, 100]);
  assert.deepEqual([y26.total, y26.asPaid], [125, 125]);
  assert.equal(y26.peoplePaid, 1);
});

test("change since the first year, as paid and after inflation", () => {
  const years = [year(2024, 100, 0, 0), year(2025, 120, 0, 0), year(2026, 150, 0, 0)];
  const change = changeSince(years, cpi);
  assert.equal(change.from, 2024);
  assert.equal(change.to, 2026);
  assert.ok(Math.abs(change.nominal - 0.5) < 1e-9);
  assert.ok(Math.abs(change.prices - 0.25) < 1e-9);
  assert.ok(Math.abs(change.real - 0.2) < 1e-9); // 150 / (100 × 1.25)

  const [label, value, context] = realChangeCard(change, "Overtime");
  assert.equal(label, "Overtime, change since FY2024 after inflation");
  assert.equal(value, "+20.0%");
  assert.equal(context, "As paid: +50.0%. NYC-area prices rose 25.0% from FY2024 to FY2026.");

  assert.equal(changeSince(years.slice(-1), cpi), null);
  assert.equal(realChangeCard(null)[1], "—");
  assert.equal(realChangeCard(changeSince([year(2024, 100, 0, 0), year(2026, 100, 0, 0)], cpi))[1], "−20.0%");
});

const agency = (id, overtime, total, fiscalYear = 2026) =>
  ({ id, label: id.toUpperCase(), years: [{ fiscalYear, overtime, total }] });

test("agencies are ranked by overtime as a share of their own payroll", () => {
  const agencies = [
    agency("big", 100e6, 1000e6),
    agency("lean", 30e6, 100e6),
    agency("tiny", 5e6, 10e6),          // under $50M: left out
    agency("old", 90e6, 100e6, 2025)    // no FY2026 row
  ];
  const ranked = overtimeDependence(agencies, 2026);
  assert.deepEqual(ranked.map((r) => r.id), ["lean", "big"]);
  assert.equal(ranked[0].share, 0.3);

  const html = dependenceHtml(ranked);
  assert.match(html, /href="\/city-payroll\/\?agency=lean#workforce">LEAN</);
  assert.match(html, /30\.0%/);
});

test("the top agencies' share counts every agency's overtime", () => {
  const agencies = [agency("a", 60, 600), agency("b", 30, 300), agency("c", 10, 100), agency("d", -5, 50)];
  const top = overtimeLeaders(agencies, 2026, 2);
  assert.deepEqual(top.agencies.map((a) => a.id), ["a", "b"]);
  assert.equal(top.overtime, 90);
  assert.equal(top.cityOvertime, 100); // a negative net is counted as $0
  assert.equal(top.share, 0.9);
});
