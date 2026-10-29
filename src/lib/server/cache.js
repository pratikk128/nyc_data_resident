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
 *               the DATA_CACHE KV namespace. The hourly cron rebuilds each job
 *               when its source changes (src/lib/server/etl.js). When KV's copy
 *               is past the job's maxAgeHours (the cron has stopped) requests
 *               keep serving it and refresh it in the background; only an
 *               empty KV (first deploy, local dev) makes a request wait.
 *               Each isolate also keeps the value in memory, asks KV every few
 *               minutes whether the cron has built a newer one (a small
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

export async function edgeCached(requestUrl, key, ttl, compute, ctx) {
  const cache = globalThis.caches?.default;
  if (!cache) return compute();

  const cacheKey = new Request(new URL(`/__cache/${CACHE_VERSION}/${key}`, requestUrl));
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  const data = await compute();
  const stored = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` }
  });
  const put = cache.put(cacheKey, stored);
  if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  return data;
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
  let stored = memory.get(job.key);
  if (isFresh(stored, job)) {
    if (Date.now() - (checkedAt.get(job.key) ?? 0) < RECHECK_MS) return stored.value;
    if ((await env.DATA_CACHE?.get(versionKey(job))) === stored.computedAt) {
      checkedAt.set(job.key, Date.now());
      return stored.value;
    }
  }

  stored = (await env.DATA_CACHE?.get(job.key, "json")) ?? stored;
  if (stored) remember(job, stored);
  if (isFresh(stored, job)) return stored.value;

  if (stored) {
    // Stale (the cron has stopped): serve it now and refresh behind the response.
    waitUntil(backgroundRefresh(job).catch((err) =>
      console.warn(`Serving stale ${job.key} from ${stored.computedAt}: ${err.message}`)));
    return stored.value;
  }
  return refreshDaily(job);
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
