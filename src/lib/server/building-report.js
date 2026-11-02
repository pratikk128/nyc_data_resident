/*
 * The Building Report Card's data: the lot (address, BINs, whether HPD
 * covers it) and each section's summary, read live from NYC Open Data with
 * SoQL that counts on Socrata (src/lib/building-report/soql.js) and kept at
 * the edge for an hour per lot and section. Lookups that miss the cache are
 * rate limited per client (BUILDING_RATE_LIMITER in wrangler.jsonc). Each
 * dataset's "last updated" comes from its metadata job, which the hourly
 * ETL keeps current (buildingReportDatasets, registered in etl.js).
 *
 * Sections load one request each, so a slow or broken dataset only holds up
 * its own section (the page retries it on its own).
 */
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue, edgeCached } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { nycToday } from "../format.js";
import {
  DATASETS, LOT_DATASETS, SECTIONS, BUILDING_TTL, SECTION_TTL, bblParts, datasetUrl
} from "../building-report/config.js";
import {
  lotQueries, violationsQueries, complaintsQueries, bedbugsQueries, flagsQueries, courtQueries,
  repairsQueries, registrationQuery, contactsQuery, dobQueries
} from "../building-report/soql.js";
import {
  summarizeLot, summarizeViolations, summarizeComplaints, summarizeBedbugs, summarizeFlags,
  summarizeCourt, summarizeRepairs, summarizeLandlord, summarizeDob
} from "../building-report/summarize.js";

const CACHE_VERSION = "v1";
const LIMITER = "BUILDING_RATE_LIMITER";

// ---------- Daily jobs (see src/lib/server/etl.js) ----------

// One per dataset, only for its "last updated" date: every query is per lot, so there's nothing to prebuild.
export const buildingReportDatasets = Object.entries(DATASETS).map(([key, ds]) => ({
  id: `building-report-${key}`,
  dashboard: "building-report",
  datasetId: ds.id,
  cadence: ds.cadence,
  metadataJob: {
    key: `building-report:metadata:${ds.id}`,
    maxAgeHours: requestMaxAgeHours(ds.cadence),
    run: () => datasetMetadata(ds.id)
  },
  jobs: []
}));
const jobByKey = new Map(Object.keys(DATASETS).map((key, i) => [key, buildingReportDatasets[i]]));

// A section's datasets, for its "last updated" line and source links. A date that can't be read is null.
export function sectionSources(sectionKey) {
  const section = SECTIONS.find((s) => s.key === sectionKey);
  return Promise.all(section.datasets.map(async (key) => {
    let meta = null;
    try { meta = await dailyValue(jobByKey.get(key).metadataJob); } catch (err) { console.error(err); }
    const ds = DATASETS[key];
    return { id: ds.id, name: ds.name, url: datasetUrl(ds.id), updatedAt: meta?.rowsUpdatedAt ?? null };
  }));
}

// ---------- Running a section's queries ----------

// { name: { dataset, params } } → { name: rows }, all at once.
async function runAll(queries) {
  const names = Object.keys(queries);
  const results = await Promise.all(names.map((n) => soql(queries[n].dataset, queries[n].params)));
  return Object.fromEntries(names.map((n, i) => [n, results[i]]));
}

// ---------- The lot ----------

async function lookUpLot(bbl) {
  const parts = bblParts(bbl);
  const qs = lotQueries(bbl, parts);
  const [pluto, footprints, hpdBuildings] = await Promise.all([
    soql(LOT_DATASETS.pluto.id, qs.pluto.params),
    soql(LOT_DATASETS.footprints.id, qs.footprints.params),
    soql(LOT_DATASETS.hpdBuildings.id, qs.hpdBuildings.params)
  ]);
  return summarizeLot(bbl, parts, { pluto, footprints, hpdBuildings });
}

/*
 * bbl: a valid BBL (isBbl()). → the lot (summarizeLot()), or null when no
 * dataset knows it (also cached, as { missing: true }). Throws RateLimited.
 */
export async function loadLot(bbl, requestUrl, ctx, clientAddress) {
  const data = await edgeCached(
    requestUrl,
    `building-report/${CACHE_VERSION}/lot/${bbl}`,
    BUILDING_TTL,
    async () => {
      await checkRateLimit(LIMITER, clientAddress);
      return (await lookUpLot(bbl)) ?? { missing: true };
    },
    ctx
  );
  return data.missing ? null : data;
}

// ---------- Sections ----------

const LOADERS = {
  violations: async (lot, today) => summarizeViolations(await runAll(violationsQueries(lot, today)), today),
  complaints: async (lot, today) => summarizeComplaints(await runAll(complaintsQueries(lot, today)), today),
  bedbugs: async (lot, today) => summarizeBedbugs((await runAll(bedbugsQueries(lot))).filings, today),
  flags: async (lot) => summarizeFlags(await runAll(flagsQueries(lot))),
  court: async (lot) => summarizeCourt(await runAll(courtQueries(lot))),
  repairs: async (lot) => summarizeRepairs(await runAll(repairsQueries(lot))),
  // Contacts are keyed by the registration, so they wait for it.
  async landlord(lot, today) {
    const reg = registrationQuery(lot);
    const registrations = await soql(reg.dataset, reg.params);
    const ids = [...new Set(registrations.map((r) => r.registrationid).filter(Boolean))].slice(0, 10);
    let contacts = [];
    if (ids.length) {
      const c = contactsQuery(ids);
      contacts = await soql(c.dataset, c.params);
    }
    return summarizeLandlord(registrations, contacts, today);
  },
  // DOB keys every record to one building (BIN): the lot's BINs, all at once.
  async dob(lot, today) {
    if (!lot.bins.length) return summarizeDob({}, today, []);
    return summarizeDob(await runAll(dobQueries(lot, today)), today, lot.bins);
  }
};

/*
 * One section for a lot from loadLot(). → { section, ...summary, sources }.
 * Throws RateLimited, or a SocrataError when the dataset can't be read.
 */
export async function loadSection(key, lot, requestUrl, ctx, clientAddress) {
  const today = nycToday();
  const [data, sources] = await Promise.all([
    edgeCached(
      requestUrl,
      `building-report/${CACHE_VERSION}/${key}/${lot.bbl}/${today}`,
      SECTION_TTL,
      async () => {
        await checkRateLimit(LIMITER, clientAddress);
        return LOADERS[key](lot, today);
      },
      ctx
    ),
    sectionSources(key)
  ]);
  return { section: key, ...data, sources };
}
