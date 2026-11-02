/*
 * Shop Diverse NYC (SBS Certified Business List, dataset ci93-uc8s). Builds
 * on socrata.js; cleaning is in src/lib/shop-diverse/clean.js, filters and
 * ranking in filter.js and ranking.js.
 *
 * The list is ~12,000 vendors (one row each) and SBS updates it about every
 * two weeks, so a job rebuilt when it changes (etl.js) keeps a slim copy in KV (the fields the search,
 * ranking and cards use, with each description cut to an excerpt and its
 * search words, and the industry names kept once in a table: packIndex()).
 * Searches filter and rank that copy in the
 * Worker, because the "Recommended" order has to rank every match before a
 * page is cut, which SoQL can't do (the renewal dates are text, and ties are
 * broken by a seeded hash). The detail view reads one vendor live by id, and
 * the shortlist CSV reads its vendors live the same way.
 */
import { env } from "cloudflare:workers";
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue, edgeCached } from "./cache.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { checkRateLimit } from "./rate-limit.js";
import { nycToday } from "../format.js";
import { DATASET_ID, MAX_EXPORT } from "../shop-diverse/config.js";
import { cleanVendor, indexRecord, packIndex, unpackIndex } from "../shop-diverse/clean.js";
import { searchBusinesses, queryToParams, outsideShare } from "../shop-diverse/filter.js";
import { certStatus, yearsInBusiness } from "../shop-diverse/ranking.js";
import { vendorsCsv } from "../shop-diverse/export.js";
import { KINDS } from "../shop-local/config.js";

export const SEARCH_TTL = 3600;
export const DETAIL_TTL = 6 * 3600;
const CADENCE = "biweekly";
const MAX_AGE_HOURS = requestMaxAgeHours(CADENCE);
const FETCH_PAGE = 5000;
const MAX_ROWS = 50000; // stop paging past this; the list is ~12,000
const QUERY_TIMEOUT_MS = 60000;

// The columns indexRecord() keeps, under their dataset names.
const INDEX_COLUMNS = [
  "account_number", "vendor_formal_name", "vendor_dba", "certification", "cert_renewal_date", "ethnicity",
  "naics_sector", "naics_subsector", "naics_title", "business_description", "telephone", "website",
  "address1", "address2", "city", "state", "zip", "borough", "date_of_establishment",
  "id6_digit_naics_code", "nigp_codes", "aggregate_bonding_limit", "largest_value_of_contract", "signatory_to_union_contracts"
].join(",");

export const metadataJob = {
  key: `shop-diverse:metadata:${DATASET_ID}`,
  maxAgeHours: MAX_AGE_HOURS,
  run: () => datasetMetadata(DATASET_ID)
};

export const vendorsJob = {
  // v2: excerpt and search words in place of the description; v3: industry
  // table, fewer search words, outsideShare; v4: NAICS and NIGP codes,
  // bonding, largest contract, union, coverage; v5: street lines for Shop
  // Local's walk-in businesses
  key: "shop-diverse:vendors:v5",
  maxAgeHours: MAX_AGE_HOURS,
  async run() {
    const today = nycToday();
    const rows = [];
    for (let offset = 0; offset < MAX_ROWS; offset += FETCH_PAGE) {
      const page = await soql(DATASET_ID, {
        $select: INDEX_COLUMNS,
        $order: "account_number",
        $limit: String(FETCH_PAGE),
        $offset: String(offset)
      }, { timeoutMs: QUERY_TIMEOUT_MS });
      rows.push(...page);
      if (page.length < FETCH_PAGE) break;
    }
    // One row per vendor today; keep the first if that ever changes.
    const seen = new Set();
    const vendors = [];
    for (const row of rows) {
      const v = cleanVendor(row, today);
      if (!v || seen.has(v.id)) continue;
      seen.add(v.id);
      vendors.push(indexRecord(v, { street: Boolean(KINDS.get(v.title)?.walk) }));
    }
    if (!vendors.length) throw new Error("SBS Certified Business List returned no vendors");
    // How many firms give each procurement field, for the About section
    const coverage = {
      total: vendors.length,
      bonding: vendors.filter((v) => v.bonding).length,
      union: vendors.filter((v) => v.union).length,
      largestContract: vendors.filter((v) => v.largestContract).length
    };
    return { computedAt: new Date().toISOString(), outsideShare: outsideShare(vendors), coverage, ...packIndex(vendors) };
  }
};

export const shopDiverseDataset = {
  id: "shop-diverse",
  dashboard: "shop-diverse",
  datasetId: DATASET_ID,
  cadence: CADENCE,
  metadataJob,
  jobs: [vendorsJob]
};

export const getMetadata = () => dailyValue(metadataJob);

// → { computedAt, outsideShare, coverage, vendors }, the vendors unpacked once per
// stored value (per isolate), so filter.js's haystacks are built once too.
const unpacked = new WeakMap();
export async function getVendors() {
  const stored = await dailyValue(vendorsJob);
  let value = unpacked.get(stored);
  if (!value) {
    value = {
      computedAt: stored.computedAt, outsideShare: stored.outsideShare, coverage: stored.coverage ?? null,
      vendors: unpackIndex(stored)
    };
    unpacked.set(stored, value);
  }
  return value;
}

// Part of every edge cache key, so a deploy that changes the ranking or the
// cleaning shows at once rather than when the old entries expire. The
// Worker's version id (wrangler.jsonc → version_metadata) changes with every
// deploy; local setups without the binding fall back to "dev".
const codeVersion = () => env.CF_VERSION_METADATA?.id ?? "dev";

// One view of the page for a normalized query (filter.js). Cached at the edge
// per query, day (the order and lapsed status change with the date), data
// version and code version. It reads only KV, but a miss filters and ranks the whole
// list, so misses are rate limited per client. Throws RateLimited.
export async function loadSearch(query, requestUrl, ctx, clientAddress) {
  const { computedAt, vendors } = await getVendors();
  const today = nycToday();
  const key = `shop-diverse/search/${codeVersion()}/${computedAt}/${today}/${queryToParams(query)}`;
  return edgeCached(requestUrl, key, SEARCH_TTL, async () => {
    await checkRateLimit("SHOP_SEARCH_RATE_LIMITER", clientAddress);
    return searchBusinesses(vendors, query, { today });
  }, ctx);
}

export const isAccount = (value) => /^\d{1,12}$/.test(String(value ?? ""));

// Everything the detail view shows for one vendor, or null.
export async function businessDetail(id) {
  const [row] = await soql(DATASET_ID, { $where: `account_number = '${id}'`, $limit: "1" });
  const today = nycToday();
  const vendor = row ? cleanVendor(row, today) : null;
  if (!vendor) return null;
  return {
    ...vendor,
    status: certStatus(vendor, today),
    years: yearsInBusiness(vendor.established, today)
  };
}

// Cached per id and code version; misses are rate limited per client. Throws RateLimited.
export async function loadBusiness(id, requestUrl, ctx, clientAddress) {
  const data = await edgeCached(requestUrl, `shop-diverse/business/${codeVersion()}/${id}`, DETAIL_TTL, async () => {
    await checkRateLimit("SHOP_DETAIL_RATE_LIMITER", clientAddress);
    return (await businessDetail(id)) ?? { missing: true };
  }, ctx);
  return data.missing ? null : data;
}

const EXPORT_CHUNK = 50;

// The shortlist CSV: { ids } (isAccount-checked account numbers, in that
// order) or { query } (that search's first MAX_EXPORT results, in its
// order). Vendors are read live in chunks so the URL stays short; firms no
// longer on the list are left out. Not cached: shortlists rarely repeat.
// Rate limited per client on the detail limiter, since it reads Socrata.
// Throws RateLimited.
export async function loadExport({ ids, query }, clientAddress) {
  await checkRateLimit("SHOP_DETAIL_RATE_LIMITER", clientAddress);
  const today = nycToday();
  let wanted = ids;
  if (query) {
    const { vendors } = await getVendors();
    wanted = searchBusinesses(vendors, { ...query, page: 1 }, { today, pageSize: MAX_EXPORT }).results.map((r) => r.id);
  }
  wanted = wanted.filter(isAccount).slice(0, MAX_EXPORT);
  const chunks = [];
  for (let i = 0; i < wanted.length; i += EXPORT_CHUNK) chunks.push(wanted.slice(i, i + EXPORT_CHUNK));
  const pages = await Promise.all(chunks.map((chunk) => soql(DATASET_ID, {
    $where: `account_number in (${chunk.map((id) => `'${id}'`).join(",")})`,
    $limit: String(EXPORT_CHUNK * 2)
  }, { timeoutMs: QUERY_TIMEOUT_MS })));
  const byId = new Map();
  for (const row of pages.flat()) {
    const v = cleanVendor(row, today);
    if (v && !byId.has(v.id)) byId.set(v.id, v);
  }
  return vendorsCsv(wanted.map((id) => byId.get(id)).filter(Boolean));
}
