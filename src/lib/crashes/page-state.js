/*
 * The crash lookup page's URL: the search form's fields and the crash
 * that's open, so a reload, Back or a shared link shows the same thing.
 * Browser-safe; the page script and the tests use it.
 *
 *   ?where=Broadway+%26+W+72+St&boro=MANHATTAN&zip=10023
 *   &lat=40.778&lon=-73.982&r=250&place=Broadway+%26+West+72nd+Street   (a spot picked from the suggestions)
 *   &from=2024-06-01&to=2024-06-30&at=17:30&within=60
 *   &make=Toyota&yfrom=2019&yto=2019&type=suv&state=NY&dir=North
 *   &role=driver&sex=F&afrom=30&ato=35&hurt=yes&seat=rear
 *   &pg=3                                                                (the page of results; left out for the first)
 *   &crash=<collision_id>                                                (the deep dive that's open)
 */
export const FIELDS = [
  "where", "boro", "zip", "lat", "lon", "r", "place",
  "from", "to", "at", "within",
  "make", "yfrom", "yto", "type", "state", "dir",
  "role", "sex", "afrom", "ato", "hurt", "seat"
];

const get = (params, k) => (params.get(k) ?? "").trim();

// The form's values (an object keyed by FIELDS) → the URL's search params, empty ones left out.
export function valuesToParams(values, crash = null) {
  const out = new URLSearchParams();
  for (const k of FIELDS) {
    const v = String(values[k] ?? "").trim();
    if (v) out.set(k, v);
  }
  // A spot without its coordinates (or the reverse) is noise.
  if (!out.get("lat") || !out.get("lon")) for (const k of ["lat", "lon", "r", "place"]) out.delete(k);
  if (!out.get("at")) out.delete("within");
  if (crash) out.set("crash", crash);
  return out;
}

export const paramsToValues = (params) => Object.fromEntries(FIELDS.map((k) => [k, get(params, k)]));

// The page of results the URL asks for, counting from 0.
export function pageOf(params) {
  const n = Number(get(params, "pg"));
  return Number.isInteger(n) && n > 1 ? n - 1 : 0;
}

// The URL's search, without the page or the open crash: what decides the results.
export function searchKey(params) {
  return new URLSearchParams([...params].filter(([k]) => FIELDS.includes(k))).toString();
}

// True when the URL holds a search (anything besides an open crash).
export const hasSearch = (params) => FIELDS.some((k) => get(params, k));

// The URL's search → the body POST /api/crashes/search takes (src/lib/crashes/query.js).
export function paramsToBody(params) {
  const v = paramsToValues(params);
  const body = {
    location: { text: v.where, borough: v.boro, zip: v.zip },
    date: { from: v.from, to: v.to },
    time: v.at ? { around: v.at, within: Number(v.within) || 60 } : {},
    vehicle: { make: v.make, yearFrom: v.yfrom, yearTo: v.yto, type: v.type, state: v.state, direction: v.dir },
    person: { role: v.role, sex: v.sex, ageFrom: v.afrom, ageTo: v.ato, injured: v.hurt, position: v.seat }
  };
  if (v.lat && v.lon) Object.assign(body.location, { lat: Number(v.lat), lon: Number(v.lon), radius: Number(v.r) || undefined });
  return body;
}

// The crash a link opens, if it looks like one of this data's ids.
export function openCrash(params) {
  const id = get(params, "crash").toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

// What the results heading says about how many crashes fit (the "too broad" hint is separate: render.js).
export function resultsSummary({ total, results, dateOnly }) {
  if (!results.length) return "No crashes fit those details.";
  const n = total.toLocaleString("en-US");
  const crashes = `crash${total === 1 ? "" : "es"}`;
  if (dateOnly) return `${n} ${crashes} in those dates. Add a place, vehicle or person to rank them.`;
  const shown = results.length < total ? ` Showing the best ${results.length}.` : "";
  return `${n} ${crashes} fit at least one detail.${shown}`;
}
