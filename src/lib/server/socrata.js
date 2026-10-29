/*
 * The one place the site talks to NYC Open Data (Socrata) at request time.
 * Server-only: it reads SOCRATA_APP_TOKEN from the Worker's secrets, so never
 * import it from a client <script>. Dataset-specific queries live next to it
 * (src/lib/server/restaurants.js, ...).
 */
import { env } from "cloudflare:workers";

export const DOMAIN = "https://data.cityofnewyork.us";
const TIMEOUT_MS = 20000;

export class SocrataError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function get(url, timeoutMs = TIMEOUT_MS) {
  const headers = { Accept: "application/json" };
  if (env.SOCRATA_APP_TOKEN) headers["X-App-Token"] = env.SOCRATA_APP_TOKEN;
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new SocrataError(`NYC Open Data request failed: ${err.message}`, 0);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new SocrataError(`NYC Open Data returned ${res.status}: ${body}`, res.status);
  }
  return res.json();
}

// Runs a SoQL query: params are the $-parameters ($select, $where, ...).
// timeoutMs: for the daily aggregates that take Socrata a minute or more.
export function soql(datasetId, params, { timeoutMs } = {}) {
  const url = new URL(`/resource/${datasetId}.json`, DOMAIN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return get(url, timeoutMs);
}

// Name, source page and when the rows were last updated: rowsUpdatedAt is
// the date the pages show, rowsUpdatedTime the full timestamp the ETL
// compares (src/lib/server/etl.js), plus attached files ({ name, assetId }).
export async function datasetMetadata(datasetId) {
  const meta = await get(new URL(`/api/views/${datasetId}.json`, DOMAIN));
  const updated = meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString() : null;
  return {
    id: datasetId,
    name: meta.name,
    url: `${DOMAIN}/d/${datasetId}`,
    rowsUpdatedAt: updated?.slice(0, 10) ?? null,
    rowsUpdatedTime: updated,
    attachments: (meta.metadata?.attachments ?? []).map((a) => ({ name: a.name ?? a.filename, assetId: a.assetId }))
  };
}
