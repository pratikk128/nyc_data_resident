/*
 * The finder script's decisions (ClosureFinder.astro): which mode's results
 * are on screen, what a typed street or address leads to, what the "try a
 * wider view" buttons do, when to fetch again, and the words around the
 * results. Pure functions, so the tests cover them without a browser; the
 * script does the DOM work.
 */
import { WINDOWS } from "./config.js";
import { groupLabel } from "./purposes.js";
import { suggestStreets, resolveStreet, streetKey } from "./streets.js";
import { searchParams } from "./filter.js";
import { placeText } from "./render.js";
import { count } from "../format.js";

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const round3 = (n) => Math.round(n * 1e3) / 1e3;

// The mode buttons have no "city": all five boroughs is "By borough" with no borough picked.
export const viewMode = (query) => (query.mode === "city" ? "borough" : query.mode);

// After switching to "By street" or "Near me", the last place's results are
// hidden until a search in the new mode runs.
export const isPending = (mode, query) => mode !== viewMode(query);

// The summary while pending, or null (borough mode shows something at once).
export function pendingText(mode) {
  if (mode === "street") return "Pick a street above to see its closures.";
  if (mode === "near") return "Type an address or ZIP code above, or use your location, to see closures near it.";
  return null;
}

// A new place; the time window and purpose stay.
export const streetQuery = (query, street, boro) => ({ ...query, mode: "street", street, boro: boro || null, lat: null, lon: null });
export const boroughQuery = (query, boro) => ({ ...query, mode: boro ? "borough" : "city", street: null, boro: boro || null, lat: null, lon: null });
export const nearQuery = (query, lat, lon) => ({ ...query, mode: "near", street: null, boro: null, lat: round3(lat), lon: round3(lon) });

// Clicking a mode button: borough mode shows its place at once (the borough
// picked in its menu); the others wait for a street or spot → null.
export function switchModeQuery(query, mode, boro) {
  return mode === "borough" && viewMode(query) !== "borough" ? boroughQuery(query, boro) : null;
}

/*
 * The street form's submit →
 *   { kind: "empty" }                 nothing (that spells a street) typed
 *   { kind: "go", street }            a street key to search (the label too, when it's from the list)
 *   { kind: "choose", options }       a few streets match: pick one
 *   { kind: "none" }                  no street with closures by that name
 * Without the street list (streetsOk false), whatever spells a street goes to the API as is.
 */
export function streetSearch(streets, text, streetsOk) {
  text = text.trim();
  if (!text) return { kind: "empty" };
  if (!streetsOk) {
    const key = streetKey(text);
    return key ? { kind: "go", street: key, label: null } : { kind: "empty" };
  }
  const hit = resolveStreet(streets, text);
  if (hit) return { kind: "go", street: hit.key, label: hit.label };
  const options = suggestStreets(streets, text, 6);
  return options.length ? { kind: "choose", options } : { kind: "none" };
}

export const noStreetText = (text) =>
  `No closures on a street called “${text.trim()}” right now. Check the spelling, or search near an address instead.`;

// parseLocationInput() names boroughs the 311 way
const BOROUGH_CODES = { MANHATTAN: "M", BRONX: "X", BROOKLYN: "B", QUEENS: "Q", "STATEN ISLAND": "S" };

/*
 * The "Near me" form's submit, from parseLocationInput() and the ZIP centroids →
 *   { kind: "message", text, focus }   say why not (focus: back to the box)
 *   { kind: "borough", boro }          a borough name: switch to that borough
 *   { kind: "point", lat, lon, label } a ZIP's middle
 *   { kind: "lookup" }                 an address: geocode it
 */
export function nearSearch(parsed, zips) {
  if (parsed.kind === "empty") return { kind: "message", text: "Type an address or ZIP code, or use your location.", focus: true };
  if (parsed.kind === "error") return { kind: "message", text: parsed.message, focus: false };
  if (parsed.kind === "borough") return { kind: "borough", boro: BOROUGH_CODES[parsed.borough] };
  if (parsed.kind === "zip") {
    const c = zips[parsed.zip];
    if (!c) return { kind: "message", text: `We don’t have a location for ZIP ${parsed.zip}. Try an address in it.`, focus: false };
    return { kind: "point", lat: c[0], lon: c[1], label: `the middle of ZIP ${parsed.zip}` };
  }
  return { kind: "lookup" };
}

/*
 * resolveLocation()'s answer →
 *   { kind: "point", lat, lon, label }
 *   { kind: "choose", text, choices }   choices: [{ lat, lon, label }]
 *   { kind: "message", text }
 */
export function addressOutcome(result) {
  if (result.status === "resolved") {
    const { lat, lon, label } = result.location;
    return { kind: "point", lat, lon, label };
  }
  if (result.status === "choose") {
    const text = result.reason === "ambiguous" ? "That could be a few places. Which one?" : "No exact match. Did you mean one of these?";
    return { kind: "choose", text, choices: result.suggestions };
  }
  return { kind: "message", text: "No matches. Try a nearby ZIP code or fewer words." };
}

/*
 * Nothing here: buttons for the next wider views that would show something.
 * allCount is the "All upcoming" count with the purpose kept. Each button's
 * data-widen is one of widenQuery()'s tokens.
 */
export function emptyHtml(query, placeLabel, allCount) {
  const ideas = [];
  if (query.purpose) ideas.push(`<button type="button" class="copy-link" data-widen="purpose">Show all kinds of work</button>`);
  if (query.when !== "all" && allCount) ideas.push(`<button type="button" class="copy-link" data-widen="when:all">See all upcoming (${count(allCount)})</button>`);
  if (query.mode === "near" && query.r < 1) ideas.push(`<button type="button" class="copy-link" data-widen="r:1">Widen to 1 mile</button>`);
  if (query.mode === "street" && query.boro) ideas.push(`<button type="button" class="copy-link" data-widen="boro">Look in every borough</button>`);
  const where = placeText(query, placeLabel);
  return `<p><strong>Nothing closed ${where} ${query.when === "all" ? "now or coming up" : "in this window"}.</strong> The asphalt gets a rest.</p>` +
    (ideas.length ? `<p>Try a wider view:</p><div class="scl-widen">${ideas.join("")}</div>` : "");
}

// A data-widen token → { query, refill } (refill: the form shows the change), or null.
export function widenQuery(query, token) {
  const [k, v] = String(token).split(":");
  if (k === "r" && Number(v) > 0) return { query: { ...query, r: Number(v) }, refill: true };
  if (k === "when" && WINDOWS.some((w) => w.key === v)) return { query: { ...query, when: v }, refill: false };
  if (k === "purpose") return { query: { ...query, purpose: null }, refill: false };
  if (k === "boro") return { query: { ...query, boro: null }, refill: true };
  return null;
}

// Fetch again when the place changed, nothing's loaded, or the loaded day isn't today any more.
export const needsLoad = (query, loadedFor, data, today) =>
  searchParams(query).toString() !== loadedFor || !data || data.today !== today;

// ---------- Words around the results ----------

const windowName = (when) => WINDOWS.find((w) => w.key === when).label.toLowerCase();

// "3 blocks closed today on or crossing Broadway, for gas lines."
export function summaryText(query, n, placeLabel) {
  const when = query.when === "all" ? "now or coming up" : ["today", "tomorrow"].includes(query.when) ? query.when : `at some point ${windowName(query.when)}`;
  const purpose = query.purpose ? `, for ${groupLabel(query.purpose).toLowerCase()}` : "";
  return `${plural(n, "block")} closed ${when} ${placeText(query, placeLabel)}${purpose}.`;
}

export const breakdownIntro = (query, placeLabel) =>
  `Closed blocks ${placeText(query, placeLabel)}, ${query.when === "all" ? "now or coming up" : windowName(query.when)}.`;

export const windowLabel = (label, n) => `${label}: ${plural(n, "closed block")}`;

export const topNote = (query) => query.mode === "near"
  ? "Streets with the most closed blocks on or crossing them within your radius. Tap one to see the whole street."
  : "Streets with the most closed blocks on or crossing them.";

export const moreText = (left, pageSize) => `Show ${count(Math.min(left, pageSize))} more (${count(left)} left)`;

// How many cards to show so the block picked on the map has one.
export function shownFor(sorted, seg, shown) {
  const i = sorted.findIndex((b) => b.seg === seg);
  return i >= shown ? i + 1 : shown;
}
