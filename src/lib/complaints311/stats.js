/*
 * The math behind the 311 dashboard: shares, ratios, the low-data fallback and
 * the city ranking. Pure functions on the shapes the server returns, used
 * by the server (to build summaries) and the page (to compare), and covered by
 * tests/complaints311.test.js.
 *
 * An area summary is
 *   { total, types: { KEY: n }, locations: { group: n }, status: { open, closed } }
 * with complaint types keyed by typeKey() and location types by locationGroup().
 */
import { typeKey, typeLabel, locationGroup, OTHER_LOCATION } from "./labels.js";
import {
  STATUS_CLOSED, MIN_IMMEDIATE_REQUESTS, MIN_LOCAL_COUNT, ABOVE_RATIO, BELOW_RATIO,
  TOP_LOCATION_TYPES, TOP_COMPLAINT_TYPES, GRID_CELLS_PER_DEGREE, DISTRIBUTION_QUANTILES
} from "./config.js";
import { inNyc } from "./location-input.js";

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
 * otherwise everything compares the ½ mile. `requested` is what the reader
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

// ---------- Location types ----------

/*
 * Rows for the share bars: the top `n` location groups by share here,
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

// ---------- Against the rest of the city ----------

const METERS_PER_DEGREE = 111320;

/*
 * cells: [{ y, x, n }], requests per grid cell (soql.js gridCountParams). For every
 * cell with a request, counts the requests in cells whose centres are within each
 * radius of its centre, and returns each sorted distribution cut to `quantiles`
 * evenly spaced values: { samples, [radiusKey]: [lowest, ..., highest] }.
 * Cells outside NYC (junk coordinates) are dropped.
 */
export function circleDistributions(cells, radii, {
  cellsPerDegree = GRID_CELLS_PER_DEGREE, quantiles = DISTRIBUTION_QUANTILES
} = {}) {
  const inCity = cells.filter((c) => inNyc((c.y + 0.5) / cellsPerDegree, (c.x + 0.5) / cellsPerDegree) && c.n > 0);
  if (!inCity.length) return { samples: 0, ...Object.fromEntries(Object.keys(radii).map((k) => [k, []])) };

  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const c of inCity) {
    y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
    x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x);
  }
  const H = y1 - y0 + 1, W = x1 - x0 + 1;
  // Row prefix sums: row[r * (W + 1) + i] is the sum of the row's first i cells.
  const rows = new Float64Array(H * (W + 1));
  for (const c of inCity) rows[(c.y - y0) * (W + 1) + (c.x - x0) + 1] += c.n;
  for (let r = 0; r < H; r++) {
    for (let i = 1; i <= W; i++) rows[r * (W + 1) + i] += rows[r * (W + 1) + i - 1];
  }

  const midLat = ((y0 + y1) / 2 + 0.5) / cellsPerDegree;
  const cellH = METERS_PER_DEGREE / cellsPerDegree;
  const cellW = cellH * Math.cos((midLat * Math.PI) / 180);

  const out = { samples: inCity.length };
  for (const [key, meters] of Object.entries(radii)) {
    // For each row offset, how many cells either side fall inside the circle.
    const reach = Math.floor(meters / cellH);
    const half = [];
    for (let dy = -reach; dy <= reach; dy++) half.push([dy, Math.floor(Math.sqrt(meters ** 2 - (dy * cellH) ** 2) / cellW)]);

    const counts = new Float64Array(inCity.length);
    inCity.forEach((c, i) => {
      const cy = c.y - y0, cx = c.x - x0;
      let total = 0;
      for (const [dy, dx] of half) {
        const r = cy + dy;
        if (r < 0 || r >= H) continue;
        const lo = Math.max(0, cx - dx), hi = Math.min(W, cx + dx + 1);
        total += rows[r * (W + 1) + hi] - rows[r * (W + 1) + lo];
      }
      counts[i] = total;
    });
    counts.sort();
    out[key] = Array.from({ length: quantiles }, (_, k) =>
      counts[Math.round((k * (counts.length - 1)) / Math.max(1, quantiles - 1))]);
  }
  return out;
}

/*
 * Where `n` falls in a distribution from circleDistributions(): the share of
 * locations with fewer requests and the share with more.
 */
export function cityRank(quantiles, n) {
  if (!quantiles?.length) return null;
  let below = 0, above = 0;
  for (const v of quantiles) {
    if (v < n) below++;
    else if (v > n) above++;
  }
  below /= quantiles.length;
  above /= quantiles.length;
  return { below, above };
}

// "More requests than 72%" / "Fewer requests than 40%", never 100% (the sample is a sample).
export function cityRankText(rank) {
  const whole = (share) => Math.min(99, Math.floor(share * 100));
  return rank.below >= 0.5
    ? { more: true, pct: whole(rank.below) }
    : { more: false, pct: whole(rank.above) };
}

// "2.3×" — one decimal under 10, whole numbers above, "<0.1×" for next to none.
export function ratioText(r) {
  if (r < 0.05) return "<0.1×";
  if (r >= 10) return `${Math.round(r)}×`;
  return `${(Math.round(r * 10) / 10).toFixed(1)}×`;
}
