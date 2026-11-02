/*
 * Shop Local: the resident side of the SBS Certified Business List. It reads
 * the same daily vendor list as Shop Diverse (getVendors() in
 * shop-diverse.js), so there's no job of its own and requests never reach
 * Socrata, except the detail panel, which reads one vendor live by id like
 * Shop Diverse's. Filters, ranking and the detail's fields are in
 * src/lib/shop-local/filter.js. Both share Shop Diverse's rate limiters.
 */
import { env } from "cloudflare:workers";
import { edgeCached } from "./cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { soql } from "./socrata.js";
import { nycToday } from "../format.js";
import { getVendors, isAccount } from "./shop-diverse.js";
import { DATASET_ID } from "../shop-diverse/config.js";
import { cleanVendor } from "../shop-diverse/clean.js";
import { searchLocal, queryToParams, localDetail } from "../shop-local/filter.js";
import zipFile from "../../data/zip-centroids.json";

export { isAccount };
export const SEARCH_TTL = 3600;
export const DETAIL_TTL = 6 * 3600;

const codeVersion = () => env.CF_VERSION_METADATA?.id ?? "dev";

// One view of the page for a normalized query. Cached at the edge per query,
// day (lapsed certifications and the tie shuffle change with the date), data
// version and deploy. Misses are rate limited per client. Throws RateLimited.
export async function loadLocalSearch(query, requestUrl, ctx, clientAddress) {
  const { computedAt, vendors } = await getVendors();
  const today = nycToday();
  const key = `shop-local/search/${codeVersion()}/${computedAt}/${today}/${queryToParams(query)}`;
  return edgeCached(requestUrl, key, SEARCH_TTL, async () => {
    await checkRateLimit("SHOP_SEARCH_RATE_LIMITER", clientAddress);
    return searchLocal(vendors, query, { today, zips: zipFile.zips });
  }, ctx);
}

// The detail panel's fields for one business, or null (not on the list, not
// a business residents use, or a lapsed certification).
export async function localBusiness(id) {
  const [row] = await soql(DATASET_ID, { $where: `account_number = '${id}'`, $limit: "1" });
  const today = nycToday();
  return localDetail(row ? cleanVendor(row, today) : null, today);
}

// Cached per id and deploy; misses are rate limited per client. Throws RateLimited.
export async function loadLocalBusiness(id, requestUrl, ctx, clientAddress) {
  const data = await edgeCached(requestUrl, `shop-local/business/${codeVersion()}/${id}`, DETAIL_TTL, async () => {
    await checkRateLimit("SHOP_DETAIL_RATE_LIMITER", clientAddress);
    return (await localBusiness(id)) ?? { missing: true };
  }, ctx);
  return data.missing ? null : data;
}
