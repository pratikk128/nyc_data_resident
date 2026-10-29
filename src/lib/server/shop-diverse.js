/*
 * Shop Diverse NYC (SBS Certified Business List, dataset ci93-uc8s). Builds
 * on socrata.js; cleaning is in src/lib/shop-diverse/clean.js, filters and
 * ranking in filter.js and ranking.js.
 *
 * The list is ~12,000 vendors (one row each) and SBS updates it about every
 * two weeks, so a daily job keeps a slim copy in KV (the fields the search,
 * ranking and cards use, ~10 MB). Searches filter and rank that copy in the
 * Worker, because the "Recommended" order has to rank every match before a
 * page is cut, which SoQL can't do (the renewal dates are text, and ties are
 * broken by a seeded hash). The detail view reads one vendor live by id.
 */
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue, edgeCached } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { nycToday } from "../format.js";
import { DATASET_ID } from "../shop-diverse/config.js";
import { cleanVendor, indexRecord } from "../shop-diverse/clean.js";
import { searchBusinesses, queryToParams } from "../shop-diverse/filter.js";
import { certStatus, yearsInBusiness } from "../shop-diverse/ranking.js";

export const SEARCH_TTL = 3600;
export const DETAIL_TTL = 6 * 3600;
const MAX_AGE_HOURS = 26;
const FETCH_PAGE = 5000;
const MAX_ROWS = 50000; // stop paging past this; the list is ~12,000
const QUERY_TIMEOUT_MS = 60000;

// The columns indexRecord() keeps, under their dataset names.
const INDEX_COLUMNS = [
  "account_number", "vendor_formal_name", "vendor_dba", "certification", "cert_renewal_date", "ethnicity",
  "naics_sector", "naics_subsector", "naics_title", "business_description", "telephone", "website",
  "city", "state", "zip", "borough", "date_of_establishment"
].join(",");

export const metadataJob = {
  key: `shop-diverse:metadata:${DATASET_ID}`,
  maxAgeHours: MAX_AGE_HOURS,
  run: () => datasetMetadata(DATASET_ID)
};

export const vendorsJob = {
  key: "shop-diverse:vendors:v1",
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
      vendors.push(indexRecord(v));
    }
    if (!vendors.length) throw new Error("SBS Certified Business List returned no vendors");
    return { computedAt: new Date().toISOString(), vendors };
  }
};

export const shopDiverseDailyJobs = [metadataJob, vendorsJob];

export const getMetadata = () => dailyValue(metadataJob);
export const getVendors = () => dailyValue(vendorsJob);

// One view of the page for a normalized query (filter.js). Cached at the edge
// per query, day (the order and lapsed status change with the date) and
// data version. It reads only KV, so it needs no rate limit.
export async function loadSearch(query, requestUrl, ctx) {
  const { computedAt, vendors } = await getVendors();
  const today = nycToday();
  const key = `shop-diverse/search/${computedAt}/${today}/${queryToParams(query)}`;
  return edgeCached(requestUrl, key, SEARCH_TTL, async () => searchBusinesses(vendors, query, { today }), ctx);
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

// Cached; misses are rate limited per client. Throws RateLimited.
export async function loadBusiness(id, requestUrl, ctx, clientAddress) {
  const data = await edgeCached(requestUrl, `shop-diverse/business/${id}`, DETAIL_TTL, async () => {
    await checkRateLimit("DETAIL_RATE_LIMITER", clientAddress);
    return (await businessDetail(id)) ?? { missing: true };
  }, ctx);
  return data.missing ? null : data;
}
