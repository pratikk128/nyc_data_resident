/*
 * "Park Amenities Near Me": four NYC Parks datasets (playgrounds, dog runs,
 * drinking fountains, pools), one ETL dataset each, plus Parks Properties for
 * the park names the others only give as an id. Builds on socrata.js; the
 * field mapping is in src/lib/park-amenities/config.js, the cleaning in
 * normalize.js.
 *
 * The datasets are small (under 4,000 rows) and change at most monthly. The
 * hourly ETL check (etl.js) rebuilds a dataset's amenities job when it
 * changes (or the park names do, the run after), keeping its normalized amenities (one point each) in KV, so the
 * geometry is fetched once per change, not per search. A search reads all
 * four (built on the request only when KV has none yet: local dev, or a
 * fresh deploy before its first search or cron run), keeps what's near the
 * rounded spot, and is cached at the edge for an hour, so requests don't wait
 * on Socrata.
 */
import { env } from "cloudflare:workers";
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue, edgeCached } from "./cache.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { checkRateLimit } from "./rate-limit.js";
import { CATEGORIES, PARK_NAMES, datasetUrl } from "../park-amenities/config.js";
import { normalizeRows, parkNameIndex } from "../park-amenities/normalize.js";
import { amenitiesNear, seasonOutdated } from "../park-amenities/nearby.js";

export const SEARCH_TTL = 3600;
const FETCH_PAGE = 5000;
const MAX_ROWS = 50000; // stop paging past this; the biggest (fountains) is ~3,800

async function allRows(datasetId, params = {}) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += FETCH_PAGE) {
    const page = await soql(datasetId, { ...params, $order: ":id", $limit: String(FETCH_PAGE), $offset: String(offset) }, { timeoutMs: 60000 });
    rows.push(...page);
    if (page.length < FETCH_PAGE) break;
  }
  return rows;
}

// Parks Properties: { [gispropnum]: sign name }, its own dataset so the footer can date it.
const parkNamesMaxAge = requestMaxAgeHours(PARK_NAMES.cadence);
const parkNamesJob = {
  key: `park-amenities:park-names:${PARK_NAMES.datasetId}:v1`,
  maxAgeHours: parkNamesMaxAge,
  async run() {
    const names = parkNameIndex(await allRows(PARK_NAMES.datasetId, { $select: "gispropnum, signname" }));
    if (!Object.keys(names).length) throw new Error(`${PARK_NAMES.datasetId} gave no park names`);
    return names;
  }
};
const parkNamesDataset = {
  id: "park-amenities-park-names",
  dashboard: "park-amenities",
  datasetId: PARK_NAMES.datasetId,
  cadence: PARK_NAMES.cadence,
  metadataJob: { key: `park-amenities:metadata:${PARK_NAMES.datasetId}`, maxAgeHours: parkNamesMaxAge, run: () => datasetMetadata(PARK_NAMES.datasetId) },
  jobs: [parkNamesJob]
};

function definition(category) {
  const id = category.datasetId;
  const maxAgeHours = requestMaxAgeHours(category.cadence);
  const metadataJob = { key: `park-amenities:metadata:${id}`, maxAgeHours, run: () => datasetMetadata(id) };
  const amenitiesJob = {
    key: `park-amenities:amenities:${id}:v3`,
    maxAgeHours,
    after: metadataJob, // the ETL has just read the metadata; this reads it from there
    async run() {
      const [meta, rows, parkNames] = await Promise.all([
        dailyValue(metadataJob),
        allRows(id, { $select: category.select.join(", ") }),
        // A category whose rows name their park doesn't need these; a failure here shouldn't stop it.
        dailyValue(parkNamesJob).catch((err) => { console.warn(`park names: ${err.message}`); return {}; })
      ]);
      const amenities = normalizeRows(category, rows, { parkNames, updatedAt: meta.rowsUpdatedAt });
      if (!amenities.length) throw new Error(`${id} gave no amenities`);
      return { computedAt: new Date().toISOString(), sourceUpdatedAt: meta.rowsUpdatedAt, rows: rows.length, amenities };
    }
  };
  return {
    id: `park-amenities-${category.key}`,
    dashboard: "park-amenities",
    datasetId: id,
    cadence: category.cadence,
    // New park names rebuild the amenities named from them.
    dependsOn: [parkNamesJob.key],
    metadataJob,
    jobs: [amenitiesJob],
    // For the data status page: season dates (config.js) are published yearly and kept by hand.
    async attention(now = Date.now()) {
      if (!seasonOutdated(category, new Date(now))) return [];
      return [`park-amenities-${category.key}: the season dates in src/lib/park-amenities/config.js are for ${category.season.year}; the page uses the usual ones until they're updated to this year's`];
    }
  };
}

// For DATASETS in etl.js: one per amenity, plus the park names.
const amenityDatasets = CATEGORIES.map(definition);
export const parkAmenitiesDatasets = [...amenityDatasets, parkNamesDataset];
const byKey = new Map(CATEGORIES.map((c, i) => [c.key, amenityDatasets[i]]));

const sourceOf = (key, datasetId, name, updatedAt) => ({ key, datasetId, name, url: datasetUrl(datasetId), updatedAt });

/*
 * Every source's name, page and last update, for the page footer (from the
 * metadata jobs), the park names last. One that can't be read has updatedAt null.
 */
export async function getSources() {
  const read = async (job) => {
    try { return (await dailyValue(job))?.rowsUpdatedAt ?? null; } catch (err) { console.error(err); return null; }
  };
  return Promise.all([
    ...CATEGORIES.map(async (c) => sourceOf(c.key, c.datasetId, c.datasetName, await read(byKey.get(c.key).metadataJob))),
    read(parkNamesDataset.metadataJob).then((d) => sourceOf("park-names", PARK_NAMES.datasetId, PARK_NAMES.datasetName, d))
  ]);
}

const codeVersion = () => env.CF_VERSION_METADATA?.id ?? "dev";
const round3 = (n) => Math.round(n * 1e3) / 1e3;

/*
 * { lat, lon } → the amenities near that spot: everything within MAX_RADIUS,
 * plus the nearest of any category with none that close (nearby.js
 * amenitiesNear()), measured from the rounded spot with SPOT_SLACK to spare,
 * so the page can measure again from the exact one. A dataset that fails to
 * load is reported in sources and left out; the rest still show. Cached at
 * the edge per rounded spot (about a block) and code version, so a hit reads
 * nothing from KV; a rebuilt dataset shows once the hour is up (they change
 * at most monthly). An answer missing a dataset isn't cached. Misses are rate
 * limited per client. Throws RateLimited.
 * → { point, amenities, sources: [{ key, datasetId, name, url, updatedAt, error }] }
 */
export async function loadSearch(where, requestUrl, ctx, clientAddress) {
  const point = { lat: round3(where.lat), lon: round3(where.lon) };
  const key = `park-amenities/search/${codeVersion()}/${point.lat},${point.lon}`;
  return edgeCached(requestUrl, key, SEARCH_TTL, async () => {
    await checkRateLimit("PARKS_RATE_LIMITER", clientAddress);
    const loaded = await Promise.allSettled(CATEGORIES.map((c) => dailyValue(byKey.get(c.key).jobs[0])));
    const sources = CATEGORIES.map((c, i) => {
      const r = loaded[i];
      if (r.status === "rejected") console.error(`park-amenities ${c.datasetId}: ${r.reason?.message ?? r.reason}`);
      return { ...sourceOf(c.key, c.datasetId, c.datasetName, r.status === "fulfilled" ? r.value.sourceUpdatedAt : null), error: r.status === "rejected" };
    });
    const all = loaded.flatMap((r) => (r.status === "fulfilled" ? r.value.amenities : []));
    return { point, amenities: amenitiesNear(all, point), sources };
  }, ctx, (body) => !body.sources.some((s) => s.error));
}
