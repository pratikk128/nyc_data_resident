/*
 * The page's URL state, shared by the page script, the API and the server.
 * Browser-safe.
 *
 *   ?street=WEST+8+STREET&boro=B   a street (as streetKey() spells it), optionally in one borough
 *   ?boro=Q                        a whole borough
 *   ?lat=40.712&lon=-74.006&r=0.25 near a spot (rounded to about a block; r: 0.25, 0.5 or 1 mile, default 0.5)
 *   (none)                         all five boroughs
 * plus &when=today|week|month|90d|all (default today) and &purpose=<group>.
 * A spot wins over a street or borough. A typed address never goes in the
 * URL (it would sit in browser history and shared links), only its spot.
 */
import { BOROUGHS, RADII, DEFAULT_RADIUS, WINDOWS, DEFAULT_WINDOW, METERS_PER_MILE } from "./config.js";
import { GROUPS } from "./purposes.js";
import { streetKey } from "./streets.js";
import { inNyc } from "../complaints311/location-input.js";

export const MAX_STREET_LENGTH = 80;
const round3 = (n) => Math.round(n * 1e3) / 1e3;

/*
 * → { mode: "near" | "street" | "borough" | "city", street, boro, lat, lon, r, when, purpose }
 * Unknown or malformed values fall back to their defaults.
 */
export function normalizeQuery(params) {
  const get = (k) => String(params.get(k) ?? "").trim();
  const when = WINDOWS.some((w) => w.key === get("when")) ? get("when") : DEFAULT_WINDOW;
  const purpose = GROUPS.some((g) => g.key === get("purpose")) ? get("purpose") : null;
  const view = { when, purpose };

  const lat = Number(get("lat")), lon = Number(get("lon"));
  if (get("lat") && get("lon") && Number.isFinite(lat) && Number.isFinite(lon) && inNyc(lat, lon)) {
    const r = RADII.includes(Number(get("r"))) ? Number(get("r")) : DEFAULT_RADIUS;
    return { mode: "near", street: null, boro: null, lat: round3(lat), lon: round3(lon), r, ...view };
  }
  const boro = BOROUGHS.some((b) => b.value === get("boro").toUpperCase()) ? get("boro").toUpperCase() : null;
  const street = streetKey(get("street").slice(0, MAX_STREET_LENGTH)) || null;
  const mode = street ? "street" : boro ? "borough" : "city";
  return { mode, street, boro, lat: null, lon: null, r: DEFAULT_RADIUS, ...view };
}

// The page URL's query string for a view; defaults are left out.
export function queryToParams(q, { view = true } = {}) {
  const p = new URLSearchParams();
  if (q.mode === "near") {
    p.set("lat", String(q.lat));
    p.set("lon", String(q.lon));
    if (q.r !== DEFAULT_RADIUS) p.set("r", String(q.r));
  } else {
    if (q.street) p.set("street", q.street);
    if (q.boro) p.set("boro", q.boro);
  }
  if (view) {
    if (q.when !== DEFAULT_WINDOW) p.set("when", q.when);
    if (q.purpose) p.set("purpose", q.purpose);
  }
  return p;
}

// What the API needs: the place only (the window and purpose are picked in the browser).
export const searchParams = (q) => queryToParams(q, { view: false });

// The selection for selectBlocks().
export function selection(q) {
  if (q.mode === "near") return { near: { lat: q.lat, lon: q.lon, meters: q.r * METERS_PER_MILE } };
  return { street: q.street, boro: q.boro };
}
