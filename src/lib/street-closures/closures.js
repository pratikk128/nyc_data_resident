/*
 * Street closure rules: cleaning rows into blocks, time windows, status and
 * the summary numbers. Pure and browser-safe; the Worker builds the index
 * with buildIndex(), the page does everything after selectBlocks().
 *
 * Dates are New York calendar dates ("2026-10-27"). The dataset stores them
 * as midnight timestamps, and a permit runs from its start date through its
 * end date, both included: a closure is active on day D when
 * start <= D <= end.
 *
 * A block is one street between two cross streets, in one borough. DOT's
 * street map often splits a block into several segments (segmentid), each
 * with its own copy of the same permit, so segments with the same street,
 * cross streets and borough that touch are one block, and the same work
 * (dates and purpose) on it is one permit. They must touch because the names
 * alone can repeat far apart: DOT writes "BEND" or "PEDESTRIAN OVERPASS" for
 * a cross street that isn't a street, and some segments carry the wrong
 * borough. Several permits can close the same block, so
 * the page shows one card per block with its permits listed. Rows also repeat
 * word for word under the same uniqueid (about 4% of them); those are dropped.
 */
import { WINDOWS, SOON_DAYS, LONG_DAYS, STRIP_DAYS, TOP_STREETS, MERGE_METERS } from "./config.js";
import { describePurpose, GROUPS } from "./purposes.js";
import { streetKey, streetLabel, isStreetName } from "./streets.js";
import { distanceToLine } from "./geo.js";

// ---------- Dates ----------

const DAY_MS = 864e5;

// "2026-10-27T00:00:00.000" → "2026-10-27"; anything else → null
export function calendarDate(value) {
  const m = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export const dayNumber = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
export const isoDay = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (iso, days) => isoDay(dayNumber(iso) + days);
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

/*
 * The first and last day of a window, both included. "This week" runs
 * through Sunday (today, if today is Sunday), "This month" through the
 * month's last day, "Next 90 days" is today plus 89 more. "All upcoming" has
 * no end (null).
 */
export function windowRange(key, today) {
  if (key === "today") return { from: today, to: today };
  if (key === "week") {
    const weekday = new Date(dayNumber(today) * DAY_MS).getUTCDay(); // 0 = Sunday
    return { from: today, to: addDays(today, (7 - weekday) % 7) };
  }
  if (key === "month") {
    const [y, m] = today.split("-").map(Number);
    return { from: today, to: isoDay(Date.UTC(y, m, 0) / DAY_MS) }; // day 0 of next month
  }
  if (key === "90d") return { from: today, to: addDays(today, 89) };
  return { from: today, to: null };
}

// A permit is active some day between from and to (to null: any day from `from` on).
export const overlaps = (p, { from, to }) => p.end >= from && (to == null || p.start <= to);

// ---------- Building the index (Worker) ----------

const round5 = (n) => Math.round(n * 1e5) / 1e5;

// The_geom → [[lat, lon], ...] per line, rounded to about a meter.
function lines(geom) {
  const parts = geom?.type === "MultiLineString" ? geom.coordinates : geom?.type === "LineString" ? [geom.coordinates] : [];
  return parts
    .map((line) => line.filter((c) => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1])).map(([lon, lat]) => [round5(lat), round5(lon)]))
    .filter((line) => line.length >= 2);
}

// Two sets of lines touch: an end of one is within MERGE_METERS of the other.
const ends = (ls) => ls.flatMap((l) => [l[0], l[l.length - 1]]).map(([lat, lon]) => ({ lat, lon }));
const touches = (a, b) =>
  ends(a).some((p) => b.some((l) => distanceToLine(p, l) <= MERGE_METERS)) ||
  ends(b).some((p) => a.some((l) => distanceToLine(p, l) <= MERGE_METERS));

const samePermit = (p, q) => p.start === q.start && p.end === q.end && p.purpose === q.purpose;
function addPermit(block, permit) {
  if (!block.permits.some((p) => samePermit(p, permit))) block.permits.push(permit);
}

/*
 * Raw rows → { blocks, streets, postedThrough }
 *   blocks         [{ seg, segs, on, from, to, boro, onKey, fromKey, toKey, lines, permits: [{ id, start, end, purpose }] }]
 *                  seg is the block's id (its lowest segmentid); permits sorted by
 *                  start; rows without dates or a line are dropped
 *   streets        [{ key, label, blocks }] every street a search can find (closed,
 *                  or a cross street of a closed block), for the autocomplete
 *   postedThrough  the latest start date of any permit: DOT posts permits only
 *                  shortly before work starts, so later days look emptier than they'll be
 * Permits that ended before `today` are dropped (they're in the data for a
 * few days after they end).
 */
export function buildIndex(rows, today) {
  const seenIds = new Set();
  const groups = new Map(); // block names → the blocks with those names (apart from each other)
  const bySeg = new Map(); // block names#segmentid → its block
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  let postedThrough = null;
  for (const row of rows) {
    const id = row.uniqueid;
    const start = calendarDate(row.work_start_date);
    const end = calendarDate(row.work_end_date);
    if (!id || seenIds.has(id) || !start || !end || end < start || end < today) continue;
    const geometry = lines(row.the_geom);
    if (!geometry.length) continue;
    seenIds.add(id);
    if (!postedThrough || start > postedThrough) postedThrough = start;
    const seg = String(row.segmentid ?? id);
    const on = clean(row.onstreetname), from = clean(row.fromstreetname), to = clean(row.tostreetname);
    const onKey = streetKey(on), fromKey = streetKey(from), toKey = streetKey(to);
    const boro = row.borough_code ?? null;
    // Cross streets in either order; a block with no street name stays its own segment.
    const key = onKey ? [boro, onKey, ...[fromKey, toKey].sort()].join("|") : `seg|${seg}`;
    let block = bySeg.get(`${key}#${seg}`);
    if (!block) {
      // A new segment joins every block with these names that it touches (merging them, if it bridges two).
      const group = groups.get(key) ?? [];
      groups.set(key, group);
      const hits = group.filter((b) => touches(b.lines, geometry));
      block = hits[0] ?? { seg, segs: [], on, from, to, boro, onKey, fromKey, toKey, lines: [], permits: [] };
      if (!hits.length) group.push(block);
      for (const other of hits.slice(1)) {
        block.segs.push(...other.segs);
        block.lines.push(...other.lines);
        for (const p of other.permits) addPermit(block, p);
        if (Number(other.seg) < Number(block.seg)) block.seg = other.seg;
        for (const s of other.segs) bySeg.set(`${key}#${s}`, block);
        group.splice(group.indexOf(other), 1);
      }
      block.segs.push(seg);
      block.lines.push(...geometry);
      if (Number(seg) < Number(block.seg)) block.seg = seg;
      bySeg.set(`${key}#${seg}`, block);
    }
    addPermit(block, { id, start, end, purpose: clean(row.purpose) });
  }
  const blocks = [...groups.values()].flat();
  for (const b of blocks) b.permits.sort((x, y) => x.start.localeCompare(y.start) || x.end.localeCompare(y.end));

  // A street search finds a block on the street or crossing it, so both count.
  const streets = new Map();
  for (const b of blocks) {
    const names = new Map([[b.toKey, b.to], [b.fromKey, b.from], [b.onKey, b.on]]); // the closed street's spelling wins
    for (const [key, name] of names) {
      if (!key || !isStreetName(key)) continue;
      const s = streets.get(key) ?? { key, label: streetLabel(name), blocks: 0 };
      s.blocks++;
      streets.set(key, s);
    }
  }
  return { blocks, streets: [...streets.values()].sort((a, b) => a.label.localeCompare(b.label)), postedThrough };
}

/*
 * The blocks for one search (filter.js normalizes it), with only the permits
 * that haven't ended by `today`, nearest first for "near me" (`meters` set).
 *   street  a streetKey: the block is on it, or it's one of the cross streets
 *   boro    a borough code
 *   near    { lat, lon, meters }
 */
export function selectBlocks(blocks, { street, boro, near } = {}, today) {
  const out = [];
  for (const b of blocks) {
    if (boro && b.boro !== boro) continue;
    if (street && b.onKey !== street && b.fromKey !== street && b.toKey !== street) continue;
    const permits = b.permits.filter((p) => p.end >= today);
    if (!permits.length) continue;
    let meters;
    if (near) {
      meters = Math.min(...b.lines.map((line) => distanceToLine(near, line)));
      if (meters > near.meters) continue;
    }
    out.push({ ...b, permits, ...(near && { meters: Math.round(meters) }) });
  }
  if (near) out.sort((a, b) => a.meters - b.meters);
  return out;
}

// ---------- Status ----------

// Permits' date ranges merged where they overlap or touch: Oct 22–27 and Oct 28–29 → Oct 22–29.
export function mergeSpans(permits) {
  const sorted = [...permits].sort((a, b) => a.start.localeCompare(b.start));
  const spans = [];
  for (const p of sorted) {
    const last = spans[spans.length - 1];
    if (last && dayNumber(p.start) <= dayNumber(last.end) + 1) {
      if (p.end > last.end) last.end = p.end;
    } else spans.push({ start: p.start, end: p.end });
  }
  return spans;
}

/*
 * Where a block stands today, from its upcoming permits.
 * → { state: "active" | "soon" | "later", span, daysLeft?, startsIn?, endingSoon, longRunning }
 *   span         the merged closure that's on now, or the next one
 *   daysLeft     days after today until the span ends (0: ends today)
 *   startsIn     days until it starts (1: tomorrow)
 *   endingSoon   active and ends within SOON_DAYS days
 *   longRunning  the span lasts more than LONG_DAYS days in all
 */
export function blockStatus(permits, today) {
  const spans = mergeSpans(permits).filter((s) => s.end >= today);
  const span = spans.find((s) => s.start <= today) ?? spans[0];
  const length = daysBetween(span.start, span.end) + 1;
  const longRunning = length > LONG_DAYS;
  if (span.start <= today) {
    const daysLeft = daysBetween(today, span.end);
    return { state: "active", span, daysLeft, endingSoon: daysLeft <= SOON_DAYS, longRunning };
  }
  const startsIn = daysBetween(today, span.start);
  return { state: startsIn <= SOON_DAYS ? "soon" : "later", span, startsIn, endingSoon: false, longRunning };
}

// ---------- Views (browser) ----------

const purposeGroup = (p) => (p.group ??= describePurpose(p.purpose).group);

/*
 * The blocks with a permit active in the window (and of the purpose group,
 * when one is picked). With a purpose picked, `permits` keeps only that kind
 * of work, so the card's status, dates and map color follow the filter;
 * `inView` is the permits in the window too.
 */
export function blocksInView(blocks, range, purpose = null) {
  const out = [];
  for (const b of blocks) {
    const permits = purpose ? b.permits.filter((p) => purposeGroup(p) === purpose) : b.permits;
    const inView = permits.filter((p) => overlaps(p, range));
    if (inView.length) out.push({ ...b, permits, inView });
  }
  return out;
}

// Blocks per window, for the counts on the tabs.
export function windowCounts(blocks, today, purpose = null) {
  return Object.fromEntries(WINDOWS.map((w) => [w.key, blocksInView(blocks, windowRange(w.key, today), purpose).length]));
}

// Blocks per purpose group in the window: a block with two kinds of work counts in both.
export function purposeCounts(blocks, range) {
  const counts = new Map();
  for (const b of blocks) {
    const groups = new Set(b.permits.filter((p) => overlaps(p, range)).map(purposeGroup));
    for (const g of groups) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const order = (g) => GROUPS.findIndex((x) => x.key === g);
  return [...counts].map(([group, blocks]) => ({ group, blocks })).sort((a, b) => b.blocks - a.blocks || order(a.group) - order(b.group));
}

// Blocks closed on each of the next `days` days (permits of the purpose group, when one is picked).
export function dailyCounts(blocks, today, purpose = null, days = STRIP_DAYS) {
  const first = dayNumber(today);
  const counts = new Array(days).fill(0);
  for (const b of blocks) {
    const hit = new Array(days).fill(false);
    for (const p of b.permits) {
      if (purpose && purposeGroup(p) !== purpose) continue;
      const s = Math.max(dayNumber(p.start) - first, 0);
      const e = Math.min(dayNumber(p.end) - first, days - 1);
      for (let d = s; d <= e; d++) hit[d] = true;
    }
    hit.forEach((h, d) => { if (h) counts[d]++; });
  }
  return counts.map((n, d) => ({ day: isoDay(first + d), blocks: n }));
}

// The streets with the most closed blocks in the view (as the street closed, not as a cross street).
export function topStreets(viewBlocks, limit = TOP_STREETS) {
  const counts = new Map();
  for (const b of viewBlocks) {
    const s = counts.get(b.onKey) ?? { key: b.onKey, label: streetLabel(b.on), boros: new Set(), blocks: 0 };
    s.blocks++;
    if (b.boro) s.boros.add(b.boro);
    counts.set(b.onKey, s);
  }
  return [...counts.values()]
    .sort((a, b) => b.blocks - a.blocks || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((s) => ({ ...s, boros: [...s.boros] }));
}

// Card order without a spot: closed now, then starting soon, then later; by start date, then street.
const STATE_ORDER = { active: 0, soon: 1, later: 2 };
export function sortBlocks(viewBlocks, today) {
  return viewBlocks
    .map((b) => ({ ...b, status: blockStatus(b.permits, today) }))
    .sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0)
      || STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state]
      || a.status.span.start.localeCompare(b.status.span.start)
      || a.on.localeCompare(b.on));
}
