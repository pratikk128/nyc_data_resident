/*
 * NYC School Quality Explorer (School Quality Reports Data, dnpx-dfnc).
 * Builds on socrata.js; the curated metrics are in src/lib/schools/metrics.js,
 * search in filter.js.
 *
 * The dataset is 1.5 million rows (school × year × metric) and changes about
 * once a year, so a daily job keeps a small index in KV for the browse page:
 * every school's latest report types, name, location (joined from
 * src/data/school-locations.json by DBN), the card and sort metrics for its
 * latest year, and the NYC average of every curated metric for every year,
 * weighted by number_of_students (computed by Socrata). Browse searches
 * filter that index in the Worker.
 *
 * A school page reads that school's curated metrics for every year live, by
 * DBN (one query, a few hundred rows), cached at the edge.
 */
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue, edgeCached } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import locations from "../../data/school-locations.json";
import {
  DATASET_ID, REPORT_ORDER, typeSlug, boroughFromDbn, districtFromDbn
} from "../schools/config.js";
import { METRICS, METRIC_KEYS, CARD_KEYS, metricsFor } from "../schools/metrics.js";
import { normalize, pointFromRow, trend, toNumber } from "../schools/values.js";
import { searchSchools, searchPoints, queryToParams } from "../schools/filter.js";

export const SEARCH_TTL = 3600;
export const SCHOOL_TTL = 6 * 3600;
const MAX_AGE_HOURS = 26;
const QUERY_TIMEOUT_MS = 90000;
const ROW_LIMIT = 50000;

const inList = (values) => values.map((v) => `'${v}'`).join(", ");

export const metadataJob = {
  key: `schools:metadata:${DATASET_ID}`,
  maxAgeHours: MAX_AGE_HOURS,
  run: () => datasetMetadata(DATASET_ID)
};

/*
 * index value: {
 *   computedAt, latestYear, years: [2015, ...],
 *   schools: [{ dbn, name, boro, district, current, loc,
 *               types: [type slug] from its newest year's reports,
 *               reports: [{ report, schoolType, type, year }],   newest year first, card report first
 *               values: { [metric id]: { v, s, y } } }],
 *   cityAvg: { [report]: { [metric id]: { [year]: value } } }
 * }
 */
export const indexJob = {
  key: "schools:index:v2", // v2: types from the newest year only
  maxAgeHours: MAX_AGE_HOURS,
  async run() {
    const [reportRows, nameRows, cityRows] = await Promise.all([
      soql(DATASET_ID, {
        $select: "dbn, report_type, school_type, max(school_year) AS year",
        $group: "dbn, report_type, school_type",
        $limit: String(ROW_LIMIT)
      }, { timeoutMs: QUERY_TIMEOUT_MS }),
      soql(DATASET_ID, {
        $select: "dbn, school_name, max(school_year) AS year",
        $group: "dbn, school_name",
        $limit: String(ROW_LIMIT)
      }, { timeoutMs: QUERY_TIMEOUT_MS }),
      soql(DATASET_ID, {
        $select: "report_type, school_year, metric_variable_name, " +
          "sum(metric_value * number_of_students) AS weighted, sum(number_of_students) AS students",
        $where: `metric_variable_name in (${inList(METRIC_KEYS)}) AND metric_value IS NOT NULL AND number_of_students > 0`,
        $group: "report_type, school_year, metric_variable_name",
        $limit: String(ROW_LIMIT)
      }, { timeoutMs: QUERY_TIMEOUT_MS })
    ]);
    if (!reportRows.length) throw new Error("School Quality Reports Data returned no schools");

    const years = [...new Set(reportRows.map((r) => Number(r.year)))].sort((a, b) => a - b);
    const latestYear = years[years.length - 1];
    const allYears = [];
    for (let y = Math.min(...cityRows.map((r) => Number(r.school_year)), years[0]); y <= latestYear; y++) allYears.push(y);

    // The newest name for each DBN (315 schools changed names over the years).
    const names = new Map();
    for (const r of nameRows) {
      const prev = names.get(r.dbn);
      if (!prev || Number(r.year) > prev.year) names.set(r.dbn, { name: r.school_name.trim(), year: Number(r.year) });
    }

    // Each school's reports, at the school type it had in that report's latest year.
    const schools = new Map();
    for (const r of reportRows) {
      const dbn = r.dbn.trim();
      const school = schools.get(dbn) ?? { dbn, reports: new Map() };
      const prev = school.reports.get(r.report_type);
      if (!prev || Number(r.year) > prev.year) {
        school.reports.set(r.report_type, {
          report: r.report_type, schoolType: r.school_type, type: typeSlug(r.report_type, r.school_type), year: Number(r.year)
        });
      }
      schools.set(dbn, school);
    }

    // Card and sort values, from each report's latest year: one query for the
    // newest year, one for the schools whose newest report is older.
    const older = [...schools.values()].filter((s) => [...s.reports.values()].some((r) => r.year < latestYear)).map((s) => s.dbn);
    const columns = "dbn, school_year, report_type, metric_variable_name, metric_value, metric_score, number_of_students";
    const [latestValues, olderValues] = await Promise.all([
      soql(DATASET_ID, {
        $select: columns,
        $where: `school_year = '${latestYear}' AND metric_variable_name in (${inList(CARD_KEYS)})`,
        $limit: String(ROW_LIMIT)
      }, { timeoutMs: QUERY_TIMEOUT_MS }),
      older.length ? soql(DATASET_ID, {
        $select: columns,
        $where: `dbn in (${inList(older)}) AND metric_variable_name in (${inList(CARD_KEYS)})`,
        $limit: String(ROW_LIMIT)
      }, { timeoutMs: QUERY_TIMEOUT_MS }) : []
    ]);
    const values = new Map();
    for (const row of [...latestValues, ...olderValues]) {
      const report = schools.get(row.dbn)?.reports.get(row.report_type);
      if (!report || Number(row.school_year) !== report.year) continue;
      for (const m of METRICS) {
        if (m.key !== row.metric_variable_name || !m.reports.includes(row.report_type) || m.field) continue;
        const p = pointFromRow(m, row);
        const forSchool = values.get(row.dbn) ?? {};
        forSchool[m.id] = { v: p.v, s: p.score, y: report.year };
        values.set(row.dbn, forSchool);
      }
    }

    const cityAvg = {};
    for (const r of cityRows) {
      const students = toNumber(r.students), weighted = toNumber(r.weighted);
      if (!students || weighted == null) continue;
      for (const m of METRICS) {
        if (m.key !== r.metric_variable_name || !m.reports.includes(r.report_type) || m.field) continue;
        const byMetric = (cityAvg[r.report_type] ??= {})[m.id] ??= {};
        byMetric[r.school_year] = normalize(m, weighted / students);
      }
    }

    // Reports from the school's newest year first (they set its type and
    // card); older ones (a K-3 school that grew into a K-5) stay for its page.
    const list = [...schools.values()].map((s) => {
      const newest = Math.max(...[...s.reports.values()].map((r) => r.year));
      const order = (r) => (r.year === newest ? 0 : 10) + REPORT_ORDER.indexOf(r.report);
      const reports = [...s.reports.values()].sort((a, b) => order(a) - order(b));
      const loc = locations[s.dbn] ?? null;
      return {
        dbn: s.dbn,
        name: names.get(s.dbn)?.name ?? s.dbn,
        boro: boroughFromDbn(s.dbn),
        district: districtFromDbn(s.dbn)?.label ?? null,
        current: newest === latestYear,
        loc: loc && { address: loc.address, zip: loc.zip, neighborhood: loc.neighborhood, lat: loc.lat, lon: loc.lon },
        types: [...new Set(reports.filter((r) => r.year === newest).map((r) => r.type))],
        reports,
        values: values.get(s.dbn) ?? {}
      };
    });
    return { computedAt: new Date().toISOString(), latestYear, years: allYears, schools: list, cityAvg };
  }
};

export const schoolsDailyJobs = [metadataJob, indexJob];

export const getMetadata = () => dailyValue(metadataJob);
export const getIndex = () => dailyValue(indexJob);

// One page of the browse list (or every match as map points when view = "map").
// Cached at the edge per query and index version; misses are rate limited.
export async function loadSearch(query, { view = "list" } = {}, requestUrl, ctx, clientAddress) {
  const index = await getIndex();
  const key = `schools/${view}/${index.computedAt}/${queryToParams(view === "map" ? { ...query, page: 1, sort: "" } : query)}`;
  return edgeCached(requestUrl, key, SEARCH_TTL, async () => {
    await checkRateLimit("SCHOOL_SEARCH_RATE_LIMITER", clientAddress);
    return view === "map" ? searchPoints(index, query) : searchSchools(index, query);
  }, ctx);
}

export const normalizeDbn = (value) => {
  const dbn = String(value ?? "").trim().toUpperCase();
  return /^\d{2}[MXKQR]\d{3}$/.test(dbn) ? dbn : null;
};

/*
 * Everything a school page shows: the index record plus, per report, each
 * curated metric with a value in any year: { id, points: { [year]:
 * { v, cmp, score, n } }, city: { [year]: value }, trend }.
 */
export async function schoolDetail(dbn, index) {
  const school = index.schools.find((s) => s.dbn === dbn);
  if (!school) return null;
  const rows = await soql(DATASET_ID, {
    $select: "school_year, report_type, metric_variable_name, metric_value, comparison_group_average, metric_score, number_of_students",
    $where: `dbn = '${dbn}' AND metric_variable_name in (${inList(METRIC_KEYS)})`,
    $order: "school_year",
    $limit: "5000"
  });
  const reports = school.reports.map((r) => {
    const reportRows = rows.filter((row) => row.report_type === r.report);
    const reportYears = [...new Set(reportRows.map((row) => Number(row.school_year)))];
    const years = reportYears.length
      ? index.years.filter((y) => y >= Math.min(...reportYears) && y <= Math.max(...reportYears))
      : [];
    const metrics = [];
    for (const m of metricsFor(r.report)) {
      const points = {};
      for (const row of reportRows) {
        if (row.metric_variable_name === m.key) points[row.school_year] = pointFromRow(m, row);
      }
      if (!Object.values(points).some((p) => p.v != null)) continue;
      metrics.push({ id: m.id, points, city: m.field ? {} : index.cityAvg?.[r.report]?.[m.id] ?? {}, trend: trend(m, points) });
    }
    return { ...r, years, metrics };
  });
  return {
    dbn: school.dbn,
    name: school.name,
    boro: school.boro,
    district: school.district,
    current: school.current,
    types: school.types,
    loc: school.loc,
    latestYear: index.latestYear,
    reports
  };
}

// Cached per school and index version; misses are rate limited. null: no such school. Throws RateLimited.
export async function loadSchool(dbn, requestUrl, ctx, clientAddress) {
  const index = await getIndex();
  const data = await edgeCached(requestUrl, `schools/school/v2/${index.computedAt}/${dbn}`, SCHOOL_TTL, async () => {
    if (!index.schools.some((s) => s.dbn === dbn)) return { missing: true };
    await checkRateLimit("DETAIL_RATE_LIMITER", clientAddress);
    return schoolDetail(dbn, index);
  }, ctx);
  return data?.missing ? null : data;
}
