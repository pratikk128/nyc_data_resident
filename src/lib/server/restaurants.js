/*
 * Restaurant inspection queries (DOHMH New York City Restaurant Inspection
 * Results, dataset 43nn-pn8j). Builds on socrata.js; the query text comes from
 * src/lib/restaurants/soql.js and the counting rules from inspections.js.
 */
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue } from "./cache.js";
import { nycToday } from "../format.js";
import {
  SEARCH_LIMIT, searchParams, milesBetween, gradesParams, detailParams,
  restaurantCountParams, familyCountParams, similarKey,
  latestInspectionParams, leadViolationParams, leadInspectionParams
} from "../restaurants/soql.js";
import {
  day, isInspected, latestGrade, groupInspections, latestScored, closesRestaurant, cutoffDate, countByCategory, inspectionsByCategory,
  totalsFromFamilies, perInspection, compareToMeans, titleCase, addressLine, boroLabel,
  NOT_INSPECTED_DATE
} from "../restaurants/inspections.js";
import { LOOKBACK_YEARS, MIN_SIMILAR_RESTAURANTS } from "../restaurants/violation-categories.js";
import { LEADS_CONFIG, MAPPED_CODES } from "../restaurants/business-groups.js";
import { buildLeads, windowRange } from "../restaurants/leads.js";

export const DATASET_ID = "43nn-pn8j";
export const SEARCH_TTL = 3600;  // 1 hour
export const DETAIL_TTL = 3600;
export const LEADS_TTL = 3600;   // the leads API response (the value itself lives in KV)
const LEADS_ROW_LIMIT = 50000;    // the $limit in leadViolationParams / leadInspectionParams

// ---------- Daily jobs (see daily-jobs.js) ----------

export const metadataJob = {
  key: `restaurants:metadata:${DATASET_ID}`,
  maxAgeHours: 26, // cron runs daily; a little slack so a late run doesn't trigger request-time work
  run: () => datasetMetadata(DATASET_ID)
};

// Citywide and same-cuisine-and-borough violation totals per category, plus the number
// of inspections in the window (the denominator for the mean) and of restaurants behind them.
export const benchmarksJob = {
  key: `restaurants:benchmarks:violations-per-inspection:v3:${LOOKBACK_YEARS}y`,
  maxAgeHours: 26,
  async run() {
    const since = cutoffDate(nycToday(), LOOKBACK_YEARS);
    const [cityCount, cityFamilies, similarCounts, similarFamilies] = await Promise.all([
      soql(DATASET_ID, restaurantCountParams(since)),
      soql(DATASET_ID, familyCountParams(since)),
      soql(DATASET_ID, restaurantCountParams(since, { bySimilar: true })),
      soql(DATASET_ID, familyCountParams(since, { bySimilar: true }))
    ]);

    const similar = {};
    for (const row of similarCounts) {
      similar[similarKey(row.cuisine_description, row.boro)] = {
        restaurants: Number(row.restaurants), inspections: Number(row.inspections), rows: []
      };
    }
    for (const row of similarFamilies) {
      similar[similarKey(row.cuisine_description, row.boro)]?.rows.push(row);
    }
    for (const group of Object.values(similar)) {
      group.totals = totalsFromFamilies(group.rows);
      delete group.rows;
    }

    return {
      since,
      years: LOOKBACK_YEARS,
      computedAt: new Date().toISOString(),
      citywide: {
        restaurants: Number(cityCount[0]?.restaurants) || 0,
        inspections: Number(cityCount[0]?.inspections) || 0,
        totals: totalsFromFamilies(cityFamilies)
      },
      similar
    };
  }
};

// Short, stable tag for the mapping, so changing business-groups.js starts a new KV entry.
function mappingTag() {
  const text = [...MAPPED_CODES, "|", ...LEADS_CONFIG.includeNonCriticalCodes, "|", LEADS_CONFIG.reinspectionScore].join(",");
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const LEADS_DAYS = Math.max(...LEADS_CONFIG.windows);

// Restaurants with lead violations in the longest window, through the latest
// inspection date in the data. The page narrows that to a group and window.
export const leadsJob = {
  key: `restaurants:leads:v2:${LEADS_DAYS}d:${mappingTag()}`, // v2: re-inspection likely needs an initial inspection
  maxAgeHours: 26,
  async run() {
    const [{ latest } = {}] = await soql(DATASET_ID, latestInspectionParams(nycToday()));
    const referenceDate = day(latest);
    if (!referenceDate) throw new Error("No latest inspection date in the restaurant data");
    const { since, through } = windowRange(referenceDate, LEADS_DAYS);
    const [violationRows, inspectionRows] = await Promise.all([
      soql(DATASET_ID, leadViolationParams(since, through, MAPPED_CODES, LEADS_CONFIG.includeNonCriticalCodes)),
      soql(DATASET_ID, leadInspectionParams(since, through))
    ]);
    if (violationRows.length >= LEADS_ROW_LIMIT || inspectionRows.length >= LEADS_ROW_LIMIT) {
      throw new Error(`Restaurant leads hit the ${LEADS_ROW_LIMIT}-row limit; page the queries`);
    }
    const { restaurants, descriptions } = buildLeads(violationRows, inspectionRows, LEADS_CONFIG);
    return {
      referenceDate,
      since,
      days: LEADS_DAYS,
      computedAt: new Date().toISOString(),
      descriptions,
      restaurants
    };
  }
};

export const restaurantDailyJobs = [metadataJob, benchmarksJob, leadsJob];

export function getLeads() {
  return dailyValue(leadsJob);
}

export function getMetadata() {
  return dailyValue(metadataJob);
}

// ---------- Search ----------

function summarize(row, near) {
  const last = day(row.last_inspected);
  const lat = Number(row.latitude), lng = Number(row.longitude);
  return {
    ...(near && lat && lng && { miles: milesBetween(near, { lat, lng }) }),
    camis: row.camis,
    name: titleCase(row.dba) || "Name not listed",
    address: addressLine(row),
    boro: boroLabel(row.boro),
    zipcode: row.zipcode ?? "",
    cuisine: row.cuisine_description ?? "",
    lastInspected: last && last !== NOT_INSPECTED_DATE ? last : null
  };
}

export async function searchRestaurants(query) {
  const rows = await soql(DATASET_ID, searchParams(query));

  // One card per camis: keep the spelling with the latest inspection, in the
  // place the first spelling sorted (nearest or closest name first).
  const byCamis = new Map();
  for (const row of rows) {
    const prev = byCamis.get(row.camis);
    if (!prev || (row.last_inspected ?? "") > (prev.last_inspected ?? "")) byCamis.set(row.camis, row);
  }
  const unique = [...byCamis.values()];
  const results = unique.slice(0, SEARCH_LIMIT).map((row) => summarize(row, query.near));

  if (results.length) {
    const graded = await soql(DATASET_ID, gradesParams(results.map((r) => r.camis)));
    const rowsByCamis = Map.groupBy(graded, (g) => g.camis);
    for (const r of results) r.grade = latestGrade(rowsByCamis.get(r.camis) ?? []);
  }

  // More rows than we fetched also means "more than 25".
  const more = unique.length > SEARCH_LIMIT || rows.length >= Number(searchParams(query).$limit);
  return { results, more };
}

// ---------- One restaurant ----------

function categoryComparison(inspections, benchmarks, cuisine, boro) {
  const counts = countByCategory(inspections, benchmarks.since);
  const inWindow = inspections.filter((insp) => insp.date >= benchmarks.since).length;
  const rates = perInspection(counts, inWindow);
  const citedAt = inspectionsByCategory(inspections, benchmarks.since);
  const city = benchmarks.citywide;
  const group = benchmarks.similar[similarKey(cuisine, boro)];
  const similarOk = group && group.restaurants >= MIN_SIMILAR_RESTAURANTS;
  // The raw boro can be "0" or blank; the notes show it, so use the same label as the header.
  const boroText = boroLabel(boro);
  return {
    since: benchmarks.since,
    years: benchmarks.years,
    computedAt: benchmarks.computedAt,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    inspections: inWindow,
    citywide: { restaurants: city.restaurants, rows: compareToMeans(rates, perInspection(city.totals, city.inspections), citedAt) },
    similar: similarOk
      ? { restaurants: group.restaurants, cuisine, boro: boroText, rows: compareToMeans(rates, perInspection(group.totals, group.inspections), citedAt) }
      : { restaurants: group?.restaurants ?? 0, cuisine, boro: boroText, rows: null, minRestaurants: MIN_SIMILAR_RESTAURANTS }
  };
}

// Everything the detail view needs, or null for an unknown camis.
export async function restaurantDetail(camis) {
  const [rows, benchmarks] = await Promise.all([
    soql(DATASET_ID, detailParams(camis)),
    dailyValue(benchmarksJob)
  ]);
  if (!rows.length) return null;

  // Rows are newest first, so rows[0] has the current name and address.
  const info = rows[0];
  const inspections = groupInspections(rows);
  const newest = inspections[0] ?? null;
  const latest = latestScored(inspections);

  return {
    camis,
    name: titleCase(info.dba) || "Name not listed",
    address: addressLine(info),
    boro: boroLabel(info.boro),
    zipcode: info.zipcode ?? "",
    cuisine: info.cuisine_description ?? "",
    notYetInspected: !rows.some(isInspected),
    latestGrade: latestGrade(rows),
    latest,
    // A newer visit that isn't scored, noted under the latest inspection.
    newerUnscored: newest && newest !== latest ? { date: newest.date, types: newest.types } : null,
    // Any visit type can close a restaurant, so this goes by the newest one.
    closedOn: newest && closesRestaurant(newest.actions) ? newest.date : null,
    // Scored inspections, newest first, for the history table.
    history: inspections.filter((insp) => insp.score != null)
      .map(({ date, types, score, grade }) => ({ date, types, score, grade })),
    categories: categoryComparison(inspections, benchmarks, info.cuisine_description, info.boro)
  };
}
