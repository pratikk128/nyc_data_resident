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
import { waitUntil } from "cloudflare:workers";
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue, edgeCached } from "./cache.js";
import { checkRateLimit, RateLimited } from "./rate-limit.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { nycToday } from "../format.js";
import {
  DATASETS, LOT_DATASETS, SECTIONS, BUILDING_TTL, SECTION_TTL, bblParts, datasetUrl, isBbl
} from "../building-report/config.js";
import {
  yearAgo, lotQueries, violationsQueries, complaintsQueries, hygieneQueries, bedbugsQueries, flagsQueries, courtQueries,
  repairsQueries, registrationQuery, contactsQuery, dobQueries, ownerMatchQuery, portfolioRegistrationsQueries,
  portfolioViolationsQueries, portfolioUnitsQueries
} from "../building-report/soql.js";
import {
  summarizeLot, summarizeViolations, summarizeComplaints, summarizeHygiene, summarizeBedbugs, summarizeFlags,
  summarizeCourt, summarizeRepairs, summarizeLandlord, summarizeDob, ownerKeys, portfolioLots, summarizePortfolio,
  PORTFOLIO_YEARS, PORTFOLIO_MAX
} from "../building-report/summarize.js";

const CACHE_VERSION = "v4";
const LIMITER = "BUILDING_RATE_LIMITER";
// How long a page waits for a lot it hasn't cached before sending the page
// without it (the browser then asks /api/building-report/lot). A cold lot
// can take Socrata 5 seconds or more; a cached one is back in milliseconds.
export const LOT_WAIT_MS = 1000;

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

// [{ dataset, params }, …] → every query's rows, in one list.
async function runList(queries) {
  return (await Promise.all(queries.map((x) => soql(x.dataset, x.params)))).flat();
}

// The lot's registrations (one per building) and who's on them. Contacts are keyed by the registration, so they wait for it.
async function lotRegistration(lot) {
  const reg = registrationQuery(lot);
  const registrations = await soql(reg.dataset, reg.params);
  const ids = [...new Set(registrations.map((r) => String(r.registrationid ?? "")).filter(Boolean))].slice(0, 10);
  let contacts = [];
  if (ids.length) {
    const c = contactsQuery(ids);
    contacts = await soql(c.dataset, c.params);
  }
  return { registrations, contacts, ids };
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

// Per isolate: lot lookups in flight, so a page and the requests it starts share one.
const lotsInFlight = new Map();

/*
 * bbl: a valid BBL (isBbl()). → the lot (summarizeLot()), or null when no
 * dataset knows it (also cached, as { missing: true }). Throws RateLimited.
 */
export function loadLot(bbl, requestUrl, ctx, clientAddress) {
  if (lotsInFlight.has(bbl)) return lotsInFlight.get(bbl);
  const promise = edgeCached(
    requestUrl,
    `building-report/${CACHE_VERSION}/lot/${bbl}`,
    BUILDING_TTL,
    async () => {
      await checkRateLimit(LIMITER, clientAddress);
      return (await lookUpLot(bbl)) ?? { missing: true };
    },
    ctx
  ).then((data) => (data.missing ? null : data))
    .finally(() => lotsInFlight.delete(bbl));
  lotsInFlight.set(bbl, promise);
  return promise;
}

/*
 * For a report page: the ?bbl= in the URL → { bbl, lot, error }. error:
 * null, "not-found" (a bad or unknown BBL), "rate-limited" or "upstream". No
 * ?bbl= at all is the search page: { bbl: null, lot: null, error: null }.
 * A lot that takes longer than waitMs is { bbl, lot: null, error: null }:
 * the page goes out without it, and the lookup carries on so the browser's
 * request for it finds it cached.
 */
export async function lotForPage(url, ctx, clientAddress, { waitMs = LOT_WAIT_MS } = {}) {
  const bbl = url.searchParams.get("bbl");
  if (bbl === null) return { bbl: null, lot: null, error: null };
  if (!isBbl(bbl)) return { bbl: null, lot: null, error: "not-found" };
  const lookup = loadLot(bbl, url, ctx, clientAddress).then(
    (lot) => ({ bbl, lot, error: lot ? null : "not-found" }),
    (err) => {
      if (err instanceof RateLimited) return { bbl, lot: null, error: "rate-limited" };
      console.error(err);
      return { bbl, lot: null, error: "upstream" };
    }
  );
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  const result = await Promise.race([lookup, late]);
  clearTimeout(timer);
  if (result) return result;
  waitUntil(lookup);
  return { bbl, lot: null, error: null };
}

// ---------- Sections ----------

const LOADERS = {
  violations: async (lot, today) => summarizeViolations(await runAll(violationsQueries(lot, today)), today),
  complaints: async (lot, today) => summarizeComplaints(await runAll(complaintsQueries(lot, today)), today),
  hygiene: async (lot, today) => summarizeHygiene(await runAll(hygieneQueries(lot, today)), today),
  bedbugs: async (lot, today) => summarizeBedbugs((await runAll(bedbugsQueries(lot))).filings, today),
  flags: async (lot) => summarizeFlags(await runAll(flagsQueries(lot))),
  court: async (lot, today) => summarizeCourt(await runAll(courtQueries(lot)), today),
  repairs: async (lot) => summarizeRepairs(await runAll(repairsQueries(lot))),
  async landlord(lot, today) {
    const { registrations, contacts } = await lotRegistration(lot);
    return summarizeLandlord(registrations, contacts, today);
  },
  /*
   * The owner's other buildings: this lot's owner names, the recent
   * registrations that list the same names, then those lots' open repair
   * orders and apartments (in pieces, all at once).
   */
  async portfolio(lot, today) {
    let since = today;
    for (let i = 0; i < PORTFOLIO_YEARS; i++) since = yearAgo(since);
    const { registrations, contacts, ids } = await lotRegistration(lot);
    const keys = ownerKeys(contacts);
    const empty = { registered: registrations.length > 0, keys, lots: [], since };
    if (!keys.length) return summarizePortfolio(empty);
    const m = ownerMatchQuery(keys);
    const matches = await soql(m.dataset, m.params);
    const matchedIds = [...new Set(matches.map((c) => String(c.registrationid)))]
      .filter((id) => id && !ids.includes(id));
    // Highest registration IDs first (ownerMatchQuery's order): a cap drops the oldest filings.
    const capped = matchedIds.length > PORTFOLIO_MAX * 2;
    const regs = matchedIds.length ? await runList(portfolioRegistrationsQueries(matchedIds.slice(0, PORTFOLIO_MAX * 2), since)) : [];
    const lots = portfolioLots(lot, keys, matches, regs, ids);
    if (!lots.length) return summarizePortfolio({ ...empty, capped });
    const [violations, units] = await Promise.all([
      runList(portfolioViolationsQueries(lots.map((l) => l.bbl))),
      runList(portfolioUnitsQueries(lots.flatMap((l) => l.buildingIds)).map((u) => ({ dataset: LOT_DATASETS.hpdBuildings.id, ...u })))
    ]);
    return summarizePortfolio({ ...empty, lots, violations, units, capped: capped || lots.length >= PORTFOLIO_MAX });
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
