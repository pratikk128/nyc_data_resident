/*
 * Two caches for Socrata results, both on Cloudflare:
 *
 * edgeCached()  Short-lived per-query results (search, restaurant detail),
 *               kept in the Workers Cache API for `ttl` seconds. The Cache API
 *               is per data center and only works on a custom domain (on
 *               *.workers.dev it's a no-op, so every request goes to Socrata).
 *
 * dailyValue()  Aggregates that are expensive and change only when their
 *               dataset does (benchmarks, indexes, dataset metadata), kept in
 *               the DATA_CACHE KV namespace. The scheduled refresh
 *               (scripts/run-etl.mjs → src/lib/server/etl.js) rebuilds each
 *               job when its source changes and writes it to KV.
 *               In production, requests only read KV: building a job takes
 *               more CPU and subrequests than a Worker request gets on the
 *               free plan, so a stale value is served as it is, and a job
 *               that was never built throws NotBuilt. Elsewhere (astro dev,
 *               tests, the refresh itself) a missing or stale value is built
 *               on the spot, as before.
 *               Each isolate also keeps the value in memory, asks KV every few
 *               minutes whether the refresh has written a newer one (a small
 *               "<key>:at" entry, so the full value is only read when it
 *               changed), and runs at most one refresh per job at a time, so
 *               concurrent requests share it.
 */
import { env, waitUntil } from "cloudflare:workers";

const CACHE_VERSION = "v1";
// Longer than any job's rebuild interval (30 days for yearly data, cadence.js),
// so a stale copy outlives a long Socrata outage.
const KV_EXPIRY_SECONDS = 90 * 24 * 3600;
const RECHECK_MS = 5 * 60e3; // how long an isolate trusts its in-memory copy

// True in the deployed Worker: Vite replaces import.meta.env.PROD at build
// time. Node (tests, scripts/run-etl.mjs) has no import.meta.env, so it throws.
let READ_ONLY = false;
try { READ_ONLY = import.meta.env.PROD === true; } catch {}

export class NotBuilt extends Error {}

// keep(data): false leaves an answer out of the cache (one missing a dataset that failed to load).
export async function edgeCached(requestUrl, key, ttl, compute, ctx, keep = () => true) {
  const cache = globalThis.caches?.default;
  if (!cache) return compute();

  const cacheKey = new Request(new URL(`/__cache/${CACHE_VERSION}/${key}`, requestUrl));
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  const data = await compute();
  if (!keep(data)) return data;
  const stored = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` }
  });
  const put = cache.put(cacheKey, stored);
  if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  return data;
}

/*
 * Like edgeCached(), for a Response made as it is (a stored value passed
 * through without parsing): make() → Response; only a 200 is cached.
 */
export async function edgeCachedResponse(requestUrl, key, make, ctx) {
  const cache = globalThis.caches?.default;
  const cacheKey = cache && new Request(new URL(`/__cache/${CACHE_VERSION}/${key}`, requestUrl));
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const res = await make();
  if (cache && res.status === 200) {
    const put = cache.put(cacheKey, res.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  }
  return res;
}

const REFRESH_LOCK_SECONDS = 120; // KV's minimum TTL is 60

// Per isolate: the last value seen ({ computedAt, value }), when it was last
// checked against KV, and refreshes in flight.
const memory = new Map();
const checkedAt = new Map();
const inFlight = new Map();

const isFresh = (stored, job) =>
  Boolean(stored) && Date.now() - Date.parse(stored.computedAt) < job.maxAgeHours * 3600e3;

const versionKey = (job) => `${job.key}:at`;

function remember(job, stored) {
  memory.set(job.key, stored);
  checkedAt.set(job.key, Date.now());
}

/*
 * A daily job is { key, maxAgeHours, run }. run() returns a JSON-safe value.
 */
export async function dailyValue(job) {
  const stored = await latestStored(job);
  if (isFresh(stored, job)) return stored.value;

  if (READ_ONLY) {
    if (stored) return stored.value; // the refresh is behind; /api/etl/status says so
    throw new NotBuilt(`${job.key} isn't in KV yet: run npm run etl -- --remote`);
  }
  if (stored) {
    // Stale (the refresh has stopped): serve it now and refresh behind the response.
    waitUntil(backgroundRefresh(job).catch((err) =>
      console.warn(`Serving stale ${job.key} from ${stored.computedAt}: ${err.message}`)));
    return stored.value;
  }
  return refreshDaily(job);
}

/*
 * The job's value as the refresh last built it, or null when KV has none. Never
 * runs the job: for jobs too slow to run on a request, whose page has a
 * fallback (City Payroll's bundled copy).
 */
export async function storedValue(job) {
  return (await latestStored(job))?.value ?? null;
}

// The newest { computedAt, value } this isolate can see: memory while it's
// fresh and KV hasn't built a newer one, otherwise KV (or memory if KV has none).
async function latestStored(job) {
  let stored = memory.get(job.key);
  if (isFresh(stored, job)) {
    if (Date.now() - (checkedAt.get(job.key) ?? 0) < RECHECK_MS) return stored;
    if ((await env.DATA_CACHE?.get(versionKey(job))) === stored.computedAt) {
      checkedAt.set(job.key, Date.now());
      return stored;
    }
  }

  stored = (await env.DATA_CACHE?.get(job.key, "json")) ?? stored;
  if (stored) remember(job, stored);
  return stored;
}

// One refresh per job per isolate; callers that arrive meanwhile get the same promise.
export function refreshDaily(job) {
  let pending = inFlight.get(job.key);
  if (!pending) {
    pending = runJob(job).finally(() => inFlight.delete(job.key));
    inFlight.set(job.key, pending);
  }
  return pending;
}

async function runJob(job) {
  const entry = { computedAt: new Date().toISOString(), value: await job.run() };
  remember(job, entry);
  const kv = env.DATA_CACHE;
  if (kv) {
    // The value first, so an isolate that sees the new version finds it.
    await kv.put(job.key, JSON.stringify(entry), { expirationTtl: KV_EXPIRY_SECONDS });
    await kv.put(versionKey(job), entry.computedAt, { expirationTtl: KV_EXPIRY_SECONDS });
  }
  return entry.value;
}

// Other isolates may see the same stale value; a short-lived KV marker keeps
// most of them from refreshing too. (KV is eventually consistent, so this
// thins out duplicate refreshes rather than ruling them out.)
async function backgroundRefresh(job) {
  if (inFlight.has(job.key)) return inFlight.get(job.key);
  const lockKey = `${job.key}:refreshing`;
  if (await env.DATA_CACHE?.get(lockKey)) return;
  await env.DATA_CACHE?.put(lockKey, "1", { expirationTtl: REFRESH_LOCK_SECONDS });
  return refreshDaily(job);
}
