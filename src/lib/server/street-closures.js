/*
 * Street Closures Near You (NYC DOT, dataset i6b5-j7bu). Builds on socrata.js;
 * the rules are in src/lib/street-closures/closures.js.
 *
 * The dataset is small (~4,500 rows, one per permit per block, about 2 MB)
 * and DOT updates it about weekly. The scheduled ETL check (etl.js) rebuilds a
 * job when it changes, which keeps every block in KV, deduped by uniqueid and
 * grouped by segmentid.
 * Searches (a street, a borough or a radius) filter that copy in the Worker
 * and are cached at the edge for an hour, so requests never wait on Socrata.
 * The browser gets every upcoming permit for the place and picks the time
 * window and purpose itself, so switching tabs needs no request.
 */
import { env } from "cloudflare:workers";
import { soql, datasetMetadata } from "./socrata.js";
import { dailyValue, edgeCached } from "./cache.js";
import { requestMaxAgeHours } from "../etl/cadence.js";
import { checkRateLimit } from "./rate-limit.js";
import { nycToday } from "../format.js";
import { DATASET_ID } from "../street-closures/config.js";
import { buildIndex, selectBlocks, streetList } from "../street-closures/closures.js";
import { searchParams, selection } from "../street-closures/filter.js";

export const SEARCH_TTL = 3600;
const CADENCE = "weekly";
const MAX_AGE_HOURS = requestMaxAgeHours(CADENCE);
const FETCH_PAGE = 10000;
const MAX_ROWS = 100000; // stop paging past this; the dataset is ~4,500
const COLUMNS = "uniqueid,segmentid,onstreetname,fromstreetname,tostreetname,borough_code,work_start_date,work_end_date,purpose,the_geom";

export const metadataJob = {
  key: `street-closures:metadata:${DATASET_ID}`,
  maxAgeHours: MAX_AGE_HOURS,
  run: () => datasetMetadata(DATASET_ID)
};

export const blocksJob = {
  key: "street-closures:blocks:v4", // v4: matching permits on one segment kept apart; street list built per request
  maxAgeHours: MAX_AGE_HOURS,
  async run() {
    const rows = [];
    for (let offset = 0; offset < MAX_ROWS; offset += FETCH_PAGE) {
      const page = await soql(DATASET_ID, {
        $select: COLUMNS,
        $order: "uniqueid",
        $limit: String(FETCH_PAGE),
        $offset: String(offset)
      }, { timeoutMs: 60000 });
      rows.push(...page);
      if (page.length < FETCH_PAGE) break;
    }
    const index = buildIndex(rows, nycToday());
    if (!index.blocks.length) throw new Error("Street closures returned no blocks");
    return { computedAt: new Date().toISOString(), rows: rows.length, ...index };
  }
};

export const streetClosuresDataset = {
  id: "street-closures",
  dashboard: "street-closures",
  datasetId: DATASET_ID,
  cadence: CADENCE,
  metadataJob,
  jobs: [blocksJob]
};

export const getMetadata = () => dailyValue(metadataJob);
export const getIndex = () => dailyValue(blocksJob);

// The autocomplete's streets, counting only blocks with a permit that hasn't ended.
export const getStreets = async () => streetList((await getIndex()).blocks, nycToday());

const codeVersion = () => env.CF_VERSION_METADATA?.id ?? "dev";

// What the browser needs of a block.
const slim = ({ fromKey, toKey, segs, ...b }) => b;

/*
 * The blocks for one place (filter.js normalizeQuery()), with their upcoming
 * permits. Cached at the edge per place, NYC date, data version and code
 * version; misses are rate limited per client. Throws RateLimited.
 * → { today, computedAt, postedThrough, blocks }
 */
export async function loadSearch(query, requestUrl, ctx, clientAddress) {
  const index = await getIndex();
  const today = nycToday();
  const key = `street-closures/search/${codeVersion()}/${index.computedAt}/${today}/${searchParams(query)}`;
  return edgeCached(requestUrl, key, SEARCH_TTL, async () => {
    await checkRateLimit("CLOSURES_RATE_LIMITER", clientAddress);
    return { today, computedAt: index.computedAt, postedThrough: index.postedThrough, blocks: selectBlocks(index.blocks, selection(query), today).map(slim) };
  }, ctx);
}
