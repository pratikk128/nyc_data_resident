/*
 * NYC Crash Hotspots in the browser: a view's { summary, map }, for the
 * dashboard and the address report. All of NYC and each borough come built,
 * one static file each (hotspot-query.js viewFile()); any other place is
 * counted here from the year of crashes in facts.json (hotspot-compute.js),
 * downloaded once per page and kept. The files are the snapshot
 * `npm run data:hotspots` writes to public/data/crash-hotspots/.
 */
import { HOTSPOTS_PATH, FACTS_FILE, isPrebuilt, viewFile } from "./hotspot-query.js";
import { unpackFacts, summarize, mapOf, FACTS_FORMAT } from "./hotspot-compute.js";
import snapshots from "../../data/snapshots.json";

export const ERROR_TEXT = "We couldn’t load the crash numbers. Check your connection and try again.";

/*
 * The snapshot's version (a hash of its files, scripts/lib/hotspot-files.mjs)
 * in every URL the page asks for. The files are cached for a year as
 * immutable (public/_headers), so a deploy with a new snapshot has to be a
 * new URL. Static assets ignore the query string.
 */
const V = `v=${snapshots["crash-hotspots"]?.version ?? FACTS_FORMAT}`;

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(typeof body?.error === "string" && body.error !== "upstream" ? body.error : ERROR_TEXT);
  return body;
}

// The unpacked facts, once per page; a failed download is tried again next time.
let facts = null;
function loadFacts() {
  facts ??= getJson(`${HOTSPOTS_PATH}/${FACTS_FILE}?${V}`).then(unpackFacts);
  facts.catch(() => { facts = null; });
  return facts;
}

/*
 * A query from readQuery() → { summary, map }
 *   summary: { dataThrough, dateFrom, area, compareTo, here, compare, city, boroughs, corners, rank }
 *   map: { dataThrough, dateFrom, points, capped }
 * signal aborts the wait (a shared facts download carries on for the next view).
 */
export async function loadHotspots(query, { signal } = {}) {
  if (isPrebuilt(query)) {
    return getJson(`${HOTSPOTS_PATH}/${viewFile(query)}?${V}`, signal);
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
