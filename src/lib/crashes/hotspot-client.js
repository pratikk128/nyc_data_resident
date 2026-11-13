/*
 * NYC Crash Hotspots in the browser: a view's { summary, map }, for the
 * dashboard and the address report. All of NYC and each borough come built
 * from /api/crash-hotspots/view; any other place is counted here from the
 * year of crashes at /api/crash-hotspots/facts (hotspot-compute.js),
 * downloaded once per page and kept.
 */
import { queryToParams } from "./hotspot-query.js";
import { unpackFacts, summarize, mapOf } from "./hotspot-compute.js";

export const ERROR_TEXT = "We couldn’t load the crash numbers. Check your connection and try again.";

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(typeof body?.error === "string" && body.error !== "upstream" ? body.error : ERROR_TEXT);
  return body;
}

// The unpacked facts, once per page; a failed download is tried again next time.
let facts = null;
function loadFacts() {
  facts ??= getJson("/api/crash-hotspots/facts").then(unpackFacts);
  facts.catch(() => { facts = null; });
  return facts;
}

const isPrebuilt = (query) => !query.area || query.area.kind === "borough";

/*
 * A query from readQuery() → { summary, map }
 *   summary: { dataThrough, dateFrom, area, compareTo, here, compare, city, boroughs, corners, rank }
 *   map: { dataThrough, dateFrom, points, capped }
 * signal aborts the wait (a shared facts download carries on for the next view).
 */
export async function loadHotspots(query, { signal } = {}) {
  if (isPrebuilt(query)) {
    const p = queryToParams({ area: query.area, mode: query.mode });
    return getJson(`/api/crash-hotspots/view${p.size ? `?${p}` : ""}`, signal);
  }
  const t = await abortable(loadFacts(), signal);
  const dates = { dataThrough: t.meta.dataThrough, dateFrom: t.meta.dateFrom };
  return { summary: { ...dates, ...summarize(t, query) }, map: { ...dates, ...mapOf(t, query) } };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    promise.then(resolve, reject);
  });
}
