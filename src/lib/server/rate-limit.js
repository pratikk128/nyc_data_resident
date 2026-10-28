/*
 * Per-client limits on requests that miss the edge cache and go to Socrata on
 * our app token. The limiters are Workers rate-limit bindings (wrangler.jsonc
 * → ratelimits). Call checkRateLimit() inside the edgeCached() compute
 * function, so cached responses stay free.
 */
import { env } from "cloudflare:workers";

export class RateLimited extends Error {}

export const RATE_LIMITED_TEXT = "That’s a lot of lookups in a row. Wait a minute and try again.";

// binding: "SEARCH_RATE_LIMITER" or "DETAIL_RATE_LIMITER". Throws RateLimited.
export async function checkRateLimit(binding, clientAddress) {
  const limiter = env[binding];
  if (!limiter) return; // no binding (some local setups): don't limit
  const { success } = await limiter.limit({ key: clientAddress || "unknown" });
  if (!success) throw new RateLimited();
}
