/*
 * The math behind the 311 dashboard: shares, ratios, the low-data fallback and
 * the summary sentences. Pure functions on the shapes the server returns, used
 * by the server (to build summaries) and the page (to compare), and covered by
 * tests/complaints311.test.js.
 *
 * An area summary is
 *   { total, types: { KEY: n }, locations: { group: n }, status: { open, closed } }
 * with complaint types keyed by typeKey() and location types by locationGroup().
 */
import { typeKey, typeLabel, locationGroup, OTHER_LOCATION, LOCATION_NOUNS } from "./labels.js";
import {
  STATUS_CLOSED, MIN_IMMEDIATE_REQUESTS, MIN_LOCAL_COUNT, ABOVE_RATIO, BELOW_RATIO,
  TOP_LOCATION_TYPES, TOP_COMPLAINT_TYPES, AREAS
} from "./config.js";
import { count } from "../format.js";

// ---------- Folding Socrata rows ----------

// [{ complaint_type: "Noise", n: "12" }, ...] → { NOISE: 12 }, merging spellings.
export function countBy(rows, column, keyFn) {
  const out = {};
  for (const row of rows) {
    const key = keyFn(row[column]);
    out[key] = (out[key] ?? 0) + Number(row.n || 0);
  }
  return out;
}

export const typeCounts = (rows, column = "complaint_type") => countBy(rows, column, typeKey);
export const locationCounts = (rows, column = "location_type") => countBy(rows, column, locationGroup);

// Status rows → { closed, open }. Everything that isn't "Closed" (Open, In Progress,
// Assigned, Pending, Started, Unspecified) counts as still open.
export function statusCounts(rows, column = "status") {
  let closed = 0, open = 0;
  for (const row of rows) {
    if (row[column] === STATUS_CLOSED) closed += Number(row.n || 0);
    else open += Number(row.n || 0);
  }
  return { closed, open };
}

export const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

// ---------- Shares and ratios ----------

// { KEY: n } → { KEY: n / total }. Empty counts → {}.
export function shares(counts) {
  const total = sum(counts);
  const out = {};
  if (!total) return out;
  for (const [k, n] of Object.entries(counts)) out[k] = n / total;
  return out;
}

// Local share ÷ baseline share. null when the baseline has none of it (nothing to compare with).
export function ratio(localShare, baseShare) {
  if (!baseShare) return null;
  return localShare / baseShare;
}

/*
 * Each type's share here against its share in the baseline.
 *   above: ratio ≥ ABOVE_RATIO and at least MIN_LOCAL_COUNT requests here, highest first.
 *   below: ratio ≤ BELOW_RATIO, where the baseline share would predict at least
 *          MIN_LOCAL_COUNT requests here (so a type that's rare everywhere doesn't
 *          show up just because there happen to be none), lowest first.
 */
export function compareShares(local, baseline, {
  minCount = MIN_LOCAL_COUNT, above = ABOVE_RATIO, below = BELOW_RATIO
} = {}) {
  const localTotal = sum(local);
  const localShares = shares(local);
  const baseShares = shares(baseline);
  const rows = [];
  for (const key of new Set([...Object.keys(local), ...Object.keys(baseline)])) {
    const n = local[key] ?? 0;
    const localShare = localShares[key] ?? 0;
    const baseShare = baseShares[key] ?? 0;
    const r = ratio(localShare, baseShare);
    if (r == null) continue;
    rows.push({ key, count: n, localShare, baseShare, ratio: r, expected: baseShare * localTotal });
  }
  return {
    above: rows.filter((r) => r.ratio >= above && r.count >= minCount).sort((a, b) => b.ratio - a.ratio),
    below: rows.filter((r) => r.ratio <= below && r.expected >= minCount).sort((a, b) => a.ratio - b.ratio)
  };
}

// ---------- Which area to compare ----------

/*
 * The ¼ mile is used for comparisons only when it has enough requests;
 * otherwise everything compares the 1 mile. `requested` is what the reader
 * picked with the toggle (default "neighborhood").
 */
export function comparisonArea(immediateTotal, requested = "neighborhood", min = MIN_IMMEDIATE_REQUESTS) {
  const immediateOk = Number(immediateTotal) >= min;
  return {
    area: requested === "immediate" && immediateOk ? "immediate" : "neighborhood",
    immediateOk,
    lowData: !immediateOk
  };
}

// ---------- Overview ----------

export function topTypes(types, n = TOP_COMPLAINT_TYPES) {
  return Object.entries(types)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, value]) => ({ key, label: typeLabel(key), count: value }));
}

export function openShare(status) {
  const total = (status?.open ?? 0) + (status?.closed ?? 0);
  return total ? status.open / total : 0;
}

// "Within about a 5-minute walk, residents filed 820 requests in the last 12 months. Noise from homes came up most often."
export function overviewSentence(summary, { where, phrase }) {
  if (!summary.total) return `${where[0].toUpperCase()}${where.slice(1)}, nobody filed a 311 request ${phrase}.`;
  const top = topTypes(summary.types, 1)[0];
  const n = summary.total;
  return `${where[0].toUpperCase()}${where.slice(1)}, residents filed ${count(n)} ${n === 1 ? "request" : "requests"} ${phrase}. ` +
    `${top.label} came up most often.`;
}

export const areaWhere = (areaKey) => `within ${AREAS[areaKey].walk}`;

// ---------- Location types ----------

/*
 * Rows for the grouped bar chart: the top `n` location groups by share here,
 * with "Other / Not specified" always last and holding everything else.
 */
export function locationComparison(local, borough, city, n = TOP_LOCATION_TYPES) {
  const s = { here: shares(local), borough: shares(borough ?? {}), city: shares(city) };
  const ranked = Object.keys({ ...local, ...city })
    .filter((k) => k !== OTHER_LOCATION)
    .sort((a, b) => (s.here[b] ?? 0) - (s.here[a] ?? 0) || (s.city[b] ?? 0) - (s.city[a] ?? 0));
  const shown = ranked.slice(0, n - 1);
  const rest = (which) => 1 - shown.reduce((acc, k) => acc + (s[which][k] ?? 0), 0);
  const rows = shown.map((key) => ({
    key, here: s.here[key] ?? 0, borough: borough ? s.borough[key] ?? 0 : null, city: s.city[key] ?? 0
  }));
  const hasLocal = sum(local) > 0;
  rows.push({
    key: OTHER_LOCATION,
    here: hasLocal ? Math.max(0, rest("here")) : 0,
    borough: borough ? Math.max(0, rest("borough")) : null,
    city: Math.max(0, rest("city"))
  });
  return rows;
}

// The location group whose share here differs most from the city's (in percentage
// points, so a tiny group with a big ratio doesn't win), as a sentence.
export function locationSentence(rows, { where = "near you", baselineName = "the city average" } = {}) {
  const candidates = rows.filter((r) => r.key !== OTHER_LOCATION && r.city > 0);
  if (!candidates.length) return "";
  const best = candidates.reduce((a, b) => (Math.abs(b.here - b.city) > Math.abs(a.here - a.city) ? b : a));
  const r = best.here / best.city;
  const noun = LOCATION_NOUNS[best.key] ?? best.key.toLowerCase();
  if (r >= 1.1) return `Complaints ${where} are more likely to be about ${noun} than ${baselineName}.`;
  if (r <= 0.9) return `Complaints ${where} are less likely to be about ${noun} than ${baselineName}.`;
  return `Where complaints happen ${where} looks a lot like ${baselineName}.`;
}

// "2.3×" — one decimal under 10, whole numbers above.
export function ratioText(r) {
  if (r >= 10) return `${Math.round(r)}×`;
  return `${(Math.round(r * 10) / 10).toFixed(1)}×`;
}

// "Rodents: 2.3× more common here than the Brooklyn average" (localName: "here", "in Queens")
export function ratioSentence(row, baselineName, localName = "here") {
  const label = typeLabel(row.key);
  if (row.ratio >= 1) return `${label}: ${ratioText(row.ratio)} more common ${localName} than ${baselineName}`;
  const pct = Math.round((1 - row.ratio) * 100);
  return `${label}: ${pct}% less common ${localName} than ${baselineName}`;
}
