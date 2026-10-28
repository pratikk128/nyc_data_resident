/*
 * Page state for the 311 dashboard (browser only). One place holds the chosen
 * location, the view settings and the data for each part of the page; every
 * section subscribes and redraws its own part, so a slow query only holds up
 * the sections that need it.
 *
 * state.immediate / .neighborhood / .zip / .baseline / .distribution are each
 *   { status: "idle" | "loading" | "ready" | "error", data, error }
 * and state.borough is the borough the comparisons use (from the geocoder, the
 * ZIP, or the most common borough among nearby requests).
 */
import { locationFromParams, locationToParams } from "./location-input.js";

const IDLE = Object.freeze({ status: "idle", data: null, error: null });
const LOADING = Object.freeze({ status: "loading", data: null, error: null });

export const state = {
  location: null,
  window: "12m",
  area: "neighborhood",
  vs: "borough",
  borough: null,
  onStreet: null, // street name when a spot was picked along a street with no house number
  immediate: IDLE,
  neighborhood: IDLE,
  zip: IDLE,
  baseline: IDLE,
  distribution: IDLE
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
function patch(changes) {
  Object.assign(state, changes);
  for (const fn of listeners) fn(state);
}

// A reader-facing error: the server's 400/429 text, or a 404.
export class LoadError extends Error {
  constructor(status, shown) {
    super(shown ?? "upstream");
    this.status = status;
    this.shown = shown ?? null;
  }
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  const data = await res.json().catch(() => null); // an HTML error page from the platform
  if (!res.ok) {
    const shown = (res.status === 400 || res.status === 429) && typeof data?.error === "string" ? data.error : null;
    throw new LoadError(res.status, shown);
  }
  return data;
}

let generation = 0;
let controller = null;

// Loads one piece into state[key]; responses from an older load() are dropped.
function track(key, url, gen) {
  patch({ [key]: LOADING });
  return getJson(url, controller.signal).then(
    (data) => { if (gen === generation) patch({ [key]: { status: "ready", data, error: null } }); return data; },
    (err) => {
      if (err.name !== "AbortError" && gen === generation) patch({ [key]: { status: "error", data: null, error: err } });
      return null;
    }
  );
}

export function load() {
  const gen = ++generation;
  controller?.abort();
  controller = new AbortController();
  const loc = state.location;
  patch({ immediate: IDLE, neighborhood: IDLE, zip: IDLE, baseline: IDLE, distribution: IDLE, borough: loc?.borough ?? null });
  if (!loc) return;

  const w = encodeURIComponent(state.window);
  let baselineStarted = false;
  const loadBaseline = (borough) => {
    if (baselineStarted || gen !== generation) return;
    baselineStarted = true;
    patch({ borough: borough ?? null });
    track("baseline", `/api/311/baseline?window=${w}${borough ? `&boro=${encodeURIComponent(borough)}` : ""}`, gen);
  };

  if (loc.kind === "borough") {
    loadBaseline(loc.borough);
    return;
  }

  // A spot's counts are ranked against the rest of the city; not needed for a whole borough.
  track("distribution", `/api/311/distribution?window=${w}`, gen);

  const loadRadii = (center, borough) => {
    if (borough) loadBaseline(borough);
    const q = `lat=${center.lat}&lon=${center.lon}&window=${w}`;
    track("immediate", `/api/311/area?${q}&area=immediate`, gen);
    track("neighborhood", `/api/311/area?${q}&area=neighborhood`, gen)
      .then((data) => loadBaseline(data?.topBorough)); // no-op when the borough was already known
  };

  if (loc.kind === "zip") {
    track("zip", `/api/311/zip?zip=${encodeURIComponent(loc.zip)}&window=${w}`, gen).then((z) => {
      if (z?.center) loadRadii(z.center, loc.borough ?? z.borough);
    });
    return;
  }
  loadRadii({ lat: loc.lat, lon: loc.lon }, loc.borough);
}

// ---------- URL ----------

function writeUrl(push) {
  const params = locationToParams(state.location, state);
  const url = new URL(location.href);
  url.search = params.toString();
  if (url.href === location.href) return;
  if (push) history.pushState(null, "", url);
  else history.replaceState(history.state, "", url);
}

export function readUrl() {
  const { location: loc, window: windowKey, area, vs } = locationFromParams(new URL(location.href).searchParams);
  patch({ location: loc, window: windowKey, area, vs, onStreet: null });
  load();
}

export function setLocation(loc, { onStreet = null } = {}) {
  patch({ location: loc, onStreet });
  writeUrl(true);
  load();
}

export function setWindow(windowKey) {
  if (windowKey === state.window) return;
  patch({ window: windowKey });
  writeUrl(false);
  load();
}

// The comparison toggles: no new data needed.
export function setView(changes) {
  patch(changes);
  writeUrl(false);
}

window.addEventListener("popstate", readUrl);
