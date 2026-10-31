/*
 * "Where can I get help near me?": seven NYC Open Data directories of
 * social-service sites, one ETL dataset each. Builds on socrata.js; the
 * cleaning rules are in src/lib/help-near-me/normalize.js.
 *
 * The directories are small (a few to a few thousand rows) and change rarely
 * (yearly to monthly). The hourly ETL check (etl.js) rebuilds a directory's
 * sites job when it changes, at most daily, which keeps its normalized sites
 * in KV. The few rows with no lat/lon, or a lat/lon far from their ZIP, are
 * geocoded with NYC GeoSearch inside that job, never on a request
 * (geocode-sites.js); ones that don't geocode are logged.
 * A search (a rounded spot, or a borough) reads all seven from KV (never builds one), keeps what's near, and is
 * cached at the edge for an hour, so requests never wait on Socrata.
 */
import { env } from "cloudflare:workers";
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue, storedValue, edgeCached } from "./cache.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { checkRateLimit } from "./rate-limit.js";
import { CATEGORIES, datasetUrl } from "../help-near-me/config.js";
import { NORMALIZERS, AGING_TYPES, YOUTH_AREAS } from "../help-near-me/normalize.js";
import { sitesNear, sitesInBorough } from "../help-near-me/distance.js";
import { geocodeMissing } from "../help-near-me/geocode-sites.js";
import zipFile from "../../data/zip-centroids.json";

export const SEARCH_TTL = 3600;
const FETCH_PAGE = 5000;
const MAX_ROWS = 50000;   // stop paging past this; the biggest directory (DYCD, one year) is ~2,700

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function allRows(datasetId, params = {}) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += FETCH_PAGE) {
    const page = await soql(datasetId, { ...params, $order: ":id", $limit: String(FETCH_PAGE), $offset: String(offset) }, { timeoutMs: 60000 });
    rows.push(...page);
    if (page.length < FETCH_PAGE) break;
  }
  return rows;
}

async function latest(datasetId, column) {
  const [row] = await soql(datasetId, { $select: `max(${column}) AS v` });
  if (!row?.v) throw new Error(`${datasetId}: no ${column}`);
  return row.v;
}

// What to ask each directory for; the rest of the filtering is in normalize.js.
const FETCHERS = {
  "tc6u-8rnp": () => allRows("tc6u-8rnp"),
  "ntcm-2w4k": () => allRows("ntcm-2w4k"),
  "bmxf-3rd4": () => allRows("bmxf-3rd4"),
  // One row per site per calendar year: the latest year only.
  "sejx-2gn3": async () => allRows("sejx-2gn3", { $where: `calendar_year = ${Number(await latest("sejx-2gn3", "calendar_year"))}` }),
  // One row per program per site per fiscal year: the latest year, kept program areas only.
  "ebkm-iyma": async () => allRows("ebkm-iyma", {
    $where: `date = ${Number(await latest("ebkm-iyma", "date"))} AND program_area IN (${Object.keys(YOUTH_AREAS).map(quote).join(", ")})`
  }),
  "cqc8-am9x": () => allRows("cqc8-am9x", { $where: `providertype IN (${Object.keys(AGING_TYPES).map(quote).join(", ")})` }),
  "crns-fw6u": () => allRows("crns-fw6u", { $where: "upper(status) = 'OCCUPIED'" })
};

function definition(category) {
  const id = category.datasetId;
  const maxAgeHours = requestMaxAgeHours(category.cadence);
  const metadataJob = { key: `help-near-me:metadata:${id}`, maxAgeHours, run: () => datasetMetadata(id) };
  const sitesJob = {
    key: `help-near-me:sites:${id}:v3`, // v3: lettered house numbers and wrong boroughs retried
    maxAgeHours,
    async run() {
      const [meta, rows] = await Promise.all([datasetMetadata(id), FETCHERS[id]()]);
      const normalized = NORMALIZERS[id](rows, meta.rowsUpdatedAt);
      const { sites, failed, moved } = await geocodeMissing(normalized, { zips: zipFile.zips, label: id });
      if (!sites.length) throw new Error(`${id} gave no sites`);
      return { computedAt: new Date().toISOString(), sourceUpdatedAt: meta.rowsUpdatedAt, rows: rows.length, sites, notGeocoded: failed, moved };
    }
  };
  return {
    id: `help-near-me-${category.key}`,
    dashboard: "help-near-me",
    datasetId: id,
    cadence: category.cadence,
    metadataJob,
    jobs: [sitesJob]
  };
}

// For DATASETS in etl.js, one per directory.
export const helpNearMeDatasets = CATEGORIES.map(definition);
const byKey = new Map(CATEGORIES.map((c, i) => [c.key, helpNearMeDatasets[i]]));

/*
 * Each directory's name, page and last update, for the page footer (from the
 * metadata jobs). A directory that can't be read has updatedAt null.
 */
export async function getSources() {
  return Promise.all(CATEGORIES.map(async (c) => {
    let meta = null;
    try { meta = await dailyValue(byKey.get(c.key).metadataJob); } catch (err) { console.error(err); }
    return { key: c.key, datasetId: c.datasetId, name: c.datasetName, url: datasetUrl(c.datasetId), updatedAt: meta?.rowsUpdatedAt ?? null };
  }));
}

const codeVersion = () => env.CF_VERSION_METADATA?.id ?? "dev";
const round3 = (n) => Math.round(n * 1e3) / 1e3;

/*
 * where: { lat, lon } → the sites near that spot: everything within MAX_RADIUS,
 *   plus the nearest few of any category with none that close (distance.js sitesNear());
 * or { borough } (a BOROUGHS entry) → every site in it, A to Z, no distances.
 * A directory that fails to load is reported in sources and left out; the
 * rest still show. Cached at the edge per rounded spot (about a block) or
 * borough, data version and code version; misses are rate limited per client.
 * Throws RateLimited.
 * → { point, borough, sites, sources: [{ key, datasetId, name, url, updatedAt, error }] }
 */
export async function loadSearch(where, requestUrl, ctx, clientAddress) {
  const point = where.borough ? null : { lat: round3(where.lat), lon: round3(where.lon) };
  const borough = where.borough?.key ?? null;
  // What the ETL last stored, never a build on the request (a directory not built yet counts as failed).
  const loaded = await Promise.allSettled(CATEGORIES.map(async (c) => {
    const value = await storedValue(byKey.get(c.key).jobs[0]);
    if (!value) throw new Error("not built yet");
    return value;
  }));
  const versions = loaded.map((r) => (r.status === "fulfilled" ? r.value.computedAt : "x")).join(",");
  const key = `help-near-me/search/${codeVersion()}/${versions}/${borough ?? `${point.lat},${point.lon}`}`;
  return edgeCached(requestUrl, key, SEARCH_TTL, async () => {
    await checkRateLimit("HELP_RATE_LIMITER", clientAddress);
    const sources = CATEGORIES.map((c, i) => {
      const r = loaded[i];
      if (r.status === "rejected") console.error(`help-near-me ${c.datasetId}: ${r.reason?.message ?? r.reason}`);
      return {
        key: c.key, datasetId: c.datasetId, name: c.datasetName, url: datasetUrl(c.datasetId),
        updatedAt: r.status === "fulfilled" ? r.value.sourceUpdatedAt : null,
        error: r.status === "rejected"
      };
    });
    const all = loaded.flatMap((r) => (r.status === "fulfilled" ? r.value.sites : []));
    // sourceUpdatedAt is per directory, in sources; the rest is what a card shows.
    const picked = borough ? sitesInBorough(all, where.borough.label) : sitesNear(all, point);
    const sites = picked.map(({ sourceUpdatedAt, geocoded, ...s }) => s);
    return { point, borough, sites, sources };
  }, ctx);
}
