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
 *               src/lib/server/daily-jobs.js; a request only computes one when
 *               KV has nothing fresh (first deploy, local dev, a failed cron).
 */
import { env } from "cloudflare:workers";

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

/*
 * A daily job is { key, maxAgeHours, run }. run() returns a JSON-safe value.
 */
export async function dailyValue(job) {
  const stored = await env.DATA_CACHE?.get(job.key, "json");
  const fresh = stored && Date.now() - Date.parse(stored.computedAt) < job.maxAgeHours * 3600e3;
  if (fresh) return stored.value;
  try {
    return await refreshDaily(job);
  } catch (err) {
    // Socrata down: an old value beats an error page
    if (stored) {
      console.warn(`Serving stale ${job.key} from ${stored.computedAt}: ${err.message}`);
      return stored.value;
    }
    throw err;
  }
}

export async function refreshDaily(job) {
  const value = await job.run();
  await env.DATA_CACHE?.put(
    job.key,
    JSON.stringify({ computedAt: new Date().toISOString(), value }),
    { expirationTtl: KV_EXPIRY_SECONDS }
  );
  return value;
}
