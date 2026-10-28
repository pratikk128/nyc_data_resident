/*
 * Two caches for Socrata results, both on Cloudflare:
 *
 * edgeCached()  Short-lived per-query results (search, restaurant detail),
 *               kept in the Workers Cache API for `ttl` seconds. The Cache API
 *               is per data center and only works on a custom domain (on
 *               *.workers.dev it's a no-op, so every request goes to Socrata).
 *
 * dailyValue()  Aggregates that are expensive and change once a day
 *               (benchmarks, dataset metadata), kept in the DATA_CACHE KV
 *               namespace. The cron trigger refreshes every job in
 *               src/lib/server/daily-jobs.js. When KV's copy is stale (a failed
 *               cron) requests keep serving it and refresh it in the background;
 *               only an empty KV (first deploy, local dev) makes a request wait.
 *               Each isolate also keeps the value in memory and runs at most one
 *               refresh per job at a time, so concurrent requests share it.
 */
import { env, waitUntil } from "cloudflare:workers";

const CACHE_VERSION = "v1";
const KV_EXPIRY_SECONDS = 7 * 24 * 3600; // keep a stale copy for a week in case Socrata is down

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

// Per isolate: the last value seen ({ computedAt, value }) and refreshes in flight.
const memory = new Map();
const inFlight = new Map();

const isFresh = (stored, job) =>
  Boolean(stored) && Date.now() - Date.parse(stored.computedAt) < job.maxAgeHours * 3600e3;

/*
 * A daily job is { key, maxAgeHours, run }. run() returns a JSON-safe value.
 */
export async function dailyValue(job) {
  let stored = memory.get(job.key);
  if (isFresh(stored, job)) return stored.value;

  stored = (await env.DATA_CACHE?.get(job.key, "json")) ?? stored;
  if (stored) memory.set(job.key, stored);
  if (isFresh(stored, job)) return stored.value;

  if (stored) {
    // Stale (a failed cron): serve it now and refresh behind the response.
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
  memory.set(job.key, entry);
  await env.DATA_CACHE?.put(job.key, JSON.stringify(entry), { expirationTtl: KV_EXPIRY_SECONDS });
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
