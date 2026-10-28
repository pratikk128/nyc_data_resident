/*
 * Drinking Water Quality queries (dataset bkwf-xfky). Builds on socrata.js;
 * the query text is in src/lib/water/soql.js and the math in stats.js.
 *
 * DEP adds a month of samples at a time, so everything here is a daily job
 * kept in KV (daily-jobs.js), and every page and API response reads from it:
 * a reader never waits on Socrata unless KV is empty (first deploy, local dev).
 *   monthly     citywide aggregates for every month (~140 rows, one query)
 *   detections  every sample with coliform or E. coli (~750 rows), and for
 *               each E. coli detection the station's samples in the next 14 days
 *   stations    per site and month for the last 12 complete months (~4,500 rows)
 */
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue } from "./cache.js";
import { DATASET_ID, STATION_MONTHS } from "../water/config.js";
import {
  monthlyParams, latestDateParams, siteMonthlyParams, detectionParams, followUpParams, windowTotalParams
} from "../water/soql.js";
import {
  normalizeMonth, normalizeDetection, latestCompleteMonth, missingMonths, addMonths, nextMonth, hasEcoli
} from "../water/stats.js";

const MAX_AGE_HOURS = 26;
const QUERY_TIMEOUT_MS = 60000; // the monthly query takes ~2–5 s warm

export const metadataJob = {
  key: `water:metadata:${DATASET_ID}`,
  maxAgeHours: MAX_AGE_HOURS,
  run: () => datasetMetadata(DATASET_ID)
};

export const monthlyJob = {
  key: "water:monthly:v1",
  maxAgeHours: MAX_AGE_HOURS,
  async run() {
    const opts = { timeoutMs: QUERY_TIMEOUT_MS };
    const [rows, [latest]] = await Promise.all([
      soql(DATASET_ID, monthlyParams(), opts),
      soql(DATASET_ID, latestDateParams(), opts)
    ]);
    const months = rows.filter((r) => r.month).map(normalizeMonth);
    const latestDate = latest?.latest ? String(latest.latest).slice(0, 10) : null;
    return {
      computedAt: new Date().toISOString(),
      latestDate,
      completeMonth: latestCompleteMonth(months, latestDate),
      gaps: missingMonths(months),
      months
    };
  }
};

export const FOLLOW_UP_DAYS = 14;

export const detectionsJob = {
  key: "water:detections:v1",
  maxAgeHours: MAX_AGE_HOURS,
  async run() {
    const opts = { timeoutMs: QUERY_TIMEOUT_MS };
    const detections = (await soql(DATASET_ID, detectionParams(), opts)).map(normalizeDetection);
    // Follow-ups aren't always labeled as resamples, so they're found by station and date.
    const ecoli = detections.filter((d) => hasEcoli(d) && d.site && d.date);
    const later = ecoli.length ? (await soql(DATASET_ID, followUpParams(ecoli, FOLLOW_UP_DAYS), opts)).map(normalizeDetection) : [];
    for (const d of ecoli) {
      const end = new Date(Date.parse(`${d.date}T00:00:00Z`) + FOLLOW_UP_DAYS * 864e5).toISOString().slice(0, 10);
      d.followUps = later.filter((f) => f.site === d.site && f.date > d.date && f.date <= end);
    }
    return { computedAt: new Date().toISOString(), detections };
  }
};

// Compact per-site rows: [month, n, clMed, turbMed, coliN, coliPos, ecoliPos]; and
// per-site and citywide totals over the whole window, for "here vs. citywide".
const totals = (m) => ({ n: m.n, clMed: m.cl.med, turbMed: m.turb.med, coliN: m.coli.n, coliPos: m.coli.pos, ecoliPos: m.ecoli.pos });

export const stationsJob = {
  key: "water:stations:v1",
  maxAgeHours: MAX_AGE_HOURS,
  async run() {
    const { completeMonth } = await dailyValue(monthlyJob);
    if (!completeMonth) return { computedAt: new Date().toISOString(), months: [], sites: {}, totals: {}, city: null };
    const first = addMonths(completeMonth, -(STATION_MONTHS - 1));
    const since = `${first}-01`, until = `${nextMonth(completeMonth)}-01`;
    const opts = { timeoutMs: QUERY_TIMEOUT_MS };
    const [rows, siteRows, [cityRow]] = await Promise.all([
      soql(DATASET_ID, siteMonthlyParams(since, until), opts),
      soql(DATASET_ID, windowTotalParams(since, until, { bySite: true }), opts),
      soql(DATASET_ID, windowTotalParams(since, until), opts)
    ]);
    const sites = {};
    for (const row of rows) {
      if (!row.site) continue;
      const m = normalizeMonth(row);
      (sites[row.site] ??= []).push([m.month, m.n, m.cl.med, m.turb.med, m.coli.n, m.coli.pos, m.ecoli.pos]);
    }
    const siteTotals = {};
    for (const row of siteRows) if (row.site) siteTotals[row.site] = totals(normalizeMonth({ ...row, month: first }));
    const months = Array.from({ length: STATION_MONTHS }, (_, i) => addMonths(first, i));
    return {
      computedAt: new Date().toISOString(),
      months,
      sites,
      totals: siteTotals,
      city: cityRow ? totals(normalizeMonth({ ...cityRow, month: first })) : null
    };
  }
};

export const waterDailyJobs = [metadataJob, monthlyJob, detectionsJob, stationsJob];

export const getMetadata = () => dailyValue(metadataJob);
export const getMonthly = () => dailyValue(monthlyJob);
export const getDetections = () => dailyValue(detectionsJob);
export const getStations = () => dailyValue(stationsJob);

/*
 * The near-me page's station details: for each requested site, its last 12
 * months lined up with `months` (null for a month with no samples), its
 * totals over the 12 months and its bacteria detections in that window; plus
 * the citywide medians per month and over the 12 months.
 */
export async function stationDetails(siteCodes) {
  const [stations, monthly, { detections }] = await Promise.all([getStations(), getMonthly(), getDetections()]);
  const { months } = stations;
  const byMonth = new Map(monthly.months.map((m) => [m.month, m]));
  const city = months.map((k) => {
    const m = byMonth.get(k);
    return m ? { clMed: m.cl.med, turbMed: m.turb.med } : null;
  });
  const first = months[0], last = months[months.length - 1];
  const inWindow = (d) => first && d.date.slice(0, 7) >= first && d.date.slice(0, 7) <= last;

  const out = {};
  for (const site of siteCodes) {
    const rows = new Map((stations.sites[site] ?? []).map((r) => [r[0], r]));
    out[site] = {
      series: months.map((k) => {
        const r = rows.get(k);
        return r ? { n: r[1], clMed: r[2], turbMed: r[3], coliN: r[4], coliPos: r[5], ecoliPos: r[6] } : null;
      }),
      totals: stations.totals[site] ?? null,
      detections: detections.filter((d) => d.site === site && inWindow(d))
    };
  }
  return {
    months, completeMonth: monthly.completeMonth, city, cityTotals: stations.city, stations: out
  };
}
