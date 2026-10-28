/*
 * Restaurant inspection queries (DOHMH New York City Restaurant Inspection
 * Results, dataset 43nn-pn8j). Builds on socrata.js; the query text comes from
 * src/lib/restaurants/soql.js and the counting rules from inspections.js.
 */
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue } from "./cache.js";
import {
  SEARCH_LIMIT, searchParams, gradesParams, detailParams,
  restaurantCountParams, familyCountParams, similarKey
} from "../restaurants/soql.js";
import {
  day, isInspected, latestGrade, groupInspections, cutoffDate, countByCategory,
  totalsFromFamilies, perInspection, compareToMeans, titleCase, addressLine, boroLabel,
  NOT_INSPECTED_DATE
} from "../restaurants/inspections.js";
import { LOOKBACK_YEARS, MIN_SIMILAR_RESTAURANTS } from "../restaurants/violation-categories.js";

export const DATASET_ID = "43nn-pn8j";
export const SEARCH_TTL = 3600;  // 1 hour
export const DETAIL_TTL = 3600;

// ---------- Daily jobs (see daily-jobs.js) ----------

export const metadataJob = {
  key: `restaurants:metadata:${DATASET_ID}`,
  maxAgeHours: 26, // cron runs daily; a little slack so a late run doesn't trigger request-time work
  run: () => datasetMetadata(DATASET_ID)
};

// Citywide and same-cuisine-and-borough critical-violation totals per category, plus the number
// of inspections in the window (the denominator for the mean) and of restaurants behind them.
export const benchmarksJob = {
  key: `restaurants:benchmarks:critical-per-inspection:v2:${LOOKBACK_YEARS}y`,
  maxAgeHours: 26,
  async run() {
    const since = cutoffDate(new Date(), LOOKBACK_YEARS);
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

export const restaurantDailyJobs = [metadataJob, benchmarksJob];

export function getMetadata() {
  return dailyValue(metadataJob);
}

// ---------- Search ----------

function summarize(row) {
  const last = day(row.last_inspected);
  return {
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

  // One card per camis: keep the spelling with the latest inspection.
  const byCamis = new Map();
  for (const row of rows) {
    const prev = byCamis.get(row.camis);
    if (!prev || (row.last_inspected ?? "") > (prev.last_inspected ?? "")) byCamis.set(row.camis, row);
  }
  const unique = [...byCamis.values()];
  const results = unique.slice(0, SEARCH_LIMIT).map(summarize);

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
  const city = benchmarks.citywide;
  const group = benchmarks.similar[similarKey(cuisine, boro)];
  const similarOk = group && group.restaurants >= MIN_SIMILAR_RESTAURANTS;
  return {
    since: benchmarks.since,
    years: benchmarks.years,
    computedAt: benchmarks.computedAt,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    inspections: inWindow,
    citywide: { restaurants: city.restaurants, rows: compareToMeans(rates, perInspection(city.totals, city.inspections)) },
    similar: similarOk
      ? { restaurants: group.restaurants, cuisine, boro, rows: compareToMeans(rates, perInspection(group.totals, group.inspections)) }
      : { restaurants: group?.restaurants ?? 0, cuisine, boro, rows: null, minRestaurants: MIN_SIMILAR_RESTAURANTS }
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
  const latest = inspections[0] ?? null;

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
    inspectionCount: inspections.length,
    categories: categoryComparison(inspections, benchmarks, info.cuisine_description, info.boro)
  };
}
