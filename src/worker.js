/*
 * Cloudflare Worker entry (wrangler.jsonc → main). Astro handles every HTTP
 * request. The data refresh runs outside the Worker (scripts/run-etl.mjs,
 * scheduled by .github/workflows/etl.yml) and writes to KV and D1.
 */
import { handle } from "@astrojs/cloudflare/handler";

export default { fetch: handle };
