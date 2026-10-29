/*
 * Water quality math on the aggregated rows from soql.js: month completeness,
 * gaps, the report card tiles, the history takeaway and nearest stations.
 * Plain functions with no I/O, used by the server and the browser alike.
 */
import { REFERENCES as R, TILE_THRESHOLDS, COMPLETE_MONTH_SHARE, COMPLETE_MONTH_DAYS_FROM_END } from "./config.js";
import { parseMeasurement, isDetected } from "./parse.js";
import { count } from "../format.js";

const n = (v) => (v == null || v === "" ? null : Number(v));
const pair = (row, prefix, { median = true } = {}) => ({
  n: n(row[`${prefix}_n`]) ?? 0,
  ...(median ? { med: n(row[`${prefix}_med`]) } : {}),
  ok: n(row[`${prefix}_ok`]) ?? 0
});

// A row from monthlyParams()/siteMonthlyParams() → numbers, month as "YYYY-MM".
export function normalizeMonth(row) {
  return {
    month: String(row.month).slice(0, 7),
    n: n(row.n) ?? 0,
    sites: n(row.sites),
    coli: { n: n(row.coli_n) ?? 0, pos: n(row.coli_pos) ?? 0 },
    ecoli: { n: n(row.ecoli_n) ?? 0, pos: n(row.ecoli_pos) ?? 0 },
    cl: pair(row, "cl"),
    turb: pair(row, "turb"),
    fl: row.fl_n != null ? pair(row, "fl") : null
  };
}

// ---------- Months ----------

// "2026-09" → "2026-10"
export function nextMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function addMonths(key, k) {
  const [y, m] = key.split("-").map(Number);
  const i = y * 12 + (m - 1) + k;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

// Whole months from a to b: monthsBetween("2026-09", "2026-12") → 3.
export function monthsBetween(a, b) {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

// DEP posts a month's samples a few weeks after it ends, so the report card is
// usually last month's. Older than this many months, the page says so.
export const STALE_AFTER_MONTHS = 2;
export const isStale = (month, today) => monthsBetween(month, today.slice(0, 7)) > STALE_AFTER_MONTHS;

const daysInMonth = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// "2026-09" → "September 2026" (long) or "Sep 2026"
export function monthLabel(key, style = "long") {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: style, year: "numeric", timeZone: "UTC" });
}

// Months between the first and last with no samples at all: ["2021-11", "2022-06"].
export function missingMonths(months) {
  const have = new Set(months.map((m) => m.month));
  const out = [];
  if (!months.length) return out;
  for (let k = months[0].month; k < months[months.length - 1].month; k = nextMonth(k)) {
    if (!have.has(k)) out.push(k);
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/*
 * The newest month we trust as complete. months: normalized, oldest first.
 * latestDate: newest sample date (YYYY-MM-DD). A month is complete when the
 * data runs to within COMPLETE_MONTH_DAYS_FROM_END days of its end (or a later
 * month has samples) and it has at least COMPLETE_MONTH_SHARE of the median
 * sample count of the 12 months before it. → "YYYY-MM" or null.
 */
export function latestCompleteMonth(months, latestDate) {
  for (let i = months.length - 1; i >= 0; i--) {
    const m = months[i];
    // Data through Sep 27 of a 30-day month: September may still be loading.
    const endsEarly = latestDate?.slice(0, 7) === m.month &&
      Number(latestDate.slice(8, 10)) <= daysInMonth(m.month) - COMPLETE_MONTH_DAYS_FROM_END;
    if (endsEarly) continue;
    const before = months.slice(Math.max(0, i - 12), i).map((x) => x.n);
    if (before.length && m.n < COMPLETE_MONTH_SHARE * median(before)) continue;
    return m.month;
  }
  return null;
}

// ---------- Shares ----------

// "99.8%", never "100%" unless every sample, never "0%" unless none.
export function sharePct(part, whole) {
  if (!whole) return "–";
  const s = part / whole;
  if (s === 1) return "100%";
  if (s === 0) return "0%";
  const p = (s * 100).toFixed(1);
  if (p === "100.0") return ">99.9%";
  if (p === "0.0") return "<0.1%";
  return `${p.replace(/\.0$/, "")}%`;
}

export function tileStatus(share) {
  if (share == null) return "none";
  if (share >= TILE_THRESHOLDS.green) return "green";
  if (share >= TILE_THRESHOLDS.amber) return "amber";
  return "red";
}

export const STATUS_ICON = { green: "✓", amber: "!", red: "✕", none: "–" };

export const STATUS_TEXT = {
  green: "Looks good",
  amber: "Worth a look",
  red: "Outside the usual range",
  none: "No data"
};

const fmt = (v, digits = 2) => (v == null ? "–" : String(Number(v.toFixed(digits))));
const samples = (k) => `${count(k)} ${k === 1 ? "sample" : "samples"}`;

const resamples = (k) => `${count(k)} ${k === 1 ? "resample" : "resamples"}`;

/*
 * The four or five report card tiles for one month (normalized).
 * resampleEcoli: E. coli detections in that month's resamples, which the
 * month's routine counts leave out. ecoliAgain: a later sample at the station
 * of one of the month's detections also had E. coli (ecoliAgain()), which
 * turns the tile red. Each: { key, label, status, value, valueLabel, sentence }
 */
export function reportCard(m, { resampleEcoli = 0, ecoliAgain = false } = {}) {
  const tiles = [];

  const ecoliClean = m.ecoli.n - m.ecoli.pos;
  // With resample detections too, say which samples each count is out of.
  const tested = resampleEcoli ? `${count(m.ecoli.n)} routine ${m.ecoli.n === 1 ? "sample" : "samples"}` : samples(m.ecoli.n);
  const inResamples = resampleEcoli ? `${m.ecoli.pos ? " and" : ", but"} in ${resamples(resampleEcoli)}` : "";
  const again = ecoliAgain ? ". A later sample at the same station had it too" : "";
  tiles.push({
    key: "ecoli",
    label: "E. coli",
    status: ecoliAgain ? "red" : m.ecoli.pos || resampleEcoli ? "amber" : m.ecoli.n ? "green" : "none",
    value: sharePct(ecoliClean, m.ecoli.n),
    valueLabel: resampleEcoli ? "of routine samples clear" : "of samples clear",
    sentence: !m.ecoli.n
      ? `No routine E. coli results this month${resampleEcoli ? `, but it was found in ${resamples(resampleEcoli)}${again}; details below` : ""}.`
      : `A sign of sewage. ${m.ecoli.pos || resampleEcoli
        ? `Found in ${m.ecoli.pos ? count(m.ecoli.pos) : "none"} of ${tested}${inResamples}${again}; details below.`
        : `Found in none of ${tested}.`}`
  });

  const coliClean = m.coli.n - m.coli.pos;
  const coliShare = m.coli.n ? coliClean / m.coli.n : null;
  tiles.push({
    key: "coliform",
    label: "Coliform bacteria",
    status: tileStatus(coliShare),
    value: sharePct(coliClean, m.coli.n),
    valueLabel: "of samples clear",
    sentence: !m.coli.n ? "No coliform results this month."
      : `Usually harmless. ${m.coli.pos ? `${m.coli.pos} of ${samples(m.coli.n)} had some; a review starts above 5%.`
        : `None in ${samples(m.coli.n)}.`}`
  });

  tiles.push({
    key: "chlorine",
    label: "Chlorine",
    status: tileStatus(m.cl.n ? m.cl.ok / m.cl.n : null),
    value: m.cl.med == null ? "–" : `${fmt(m.cl.med)} mg/L`,
    valueLabel: "median",
    sentence: !m.cl.n ? "No chlorine results this month."
      : `Keeps germs out of the pipes. In the normal range in ${sharePct(m.cl.ok, m.cl.n)} of samples.`
  });

  tiles.push({
    key: "turbidity",
    label: "Cloudiness",
    status: tileStatus(m.turb.n ? m.turb.ok / m.turb.n : null),
    value: m.turb.med == null ? "–" : `${fmt(m.turb.med)} NTU`,
    valueLabel: "median",
    sentence: !m.turb.n ? "No cloudiness results this month."
      : `${sharePct(m.turb.ok, m.turb.n)} of samples under the state’s 5 NTU standard.`
  });

  if (m.fl?.n) {
    tiles.push({
      key: "fluoride",
      label: "Fluoride",
      status: tileStatus(m.fl.ok / m.fl.n),
      value: m.fl.med == null ? "–" : `${fmt(m.fl.med)} mg/L`,
      valueLabel: "median",
      sentence: `Added to prevent cavities. The city aims for about ${R.fluoride.target} mg/L; ` +
        `${sharePct(m.fl.ok, m.fl.n)} of samples were between ${R.fluoride.range.min.toFixed(1)} and ${R.fluoride.range.max.toFixed(1)} mg/L.`
    });
  }
  return tiles;
}

/*
 * The headline for a month's report card, from its tiles:
 * { status, title, sentence }. Worst tile wins; "none" tiles are skipped.
 */
export function verdict(tiles) {
  const scored = tiles.filter((t) => t.status !== "none");
  const off = scored.filter((t) => t.status !== "green");
  const status = off.some((t) => t.status === "red") ? "red" : off.length ? "amber" : "green";
  const names = new Intl.ListFormat("en", { type: "conjunction" }).format(off.map((t) => t.label.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())));  // "E. coli" stays
  if (status === "green") {
    return {
      status, title: "All clear",
      sentence: `Every measure looked normal, with at least ${Math.round(TILE_THRESHOLDS.green * 100)}% of samples in range for each.`
    };
  }
  return {
    status,
    title: status === "red" ? "Some results need a look" : "Mostly clear",
    sentence: `${scored.length - off.length} of ${scored.length} measures looked normal. Check ${names} below.`
  };
}

/*
 * One sentence for the history subsection, over complete months only:
 * "Since January 2015, 99.6% of 160,312 routine samples had no coliform bacteria, and E. coli turned up in 6."
 * resampleEcoli: E. coli detections in resamples over the same months.
 */
export function historyTakeaway(months, resampleEcoli = 0) {
  if (!months.length) return "";
  let tested = 0, pos = 0, ecoli = 0;
  for (const m of months) { tested += m.coli.n; pos += m.coli.pos; ecoli += m.ecoli.pos; }
  if (!tested) return "";
  const first = monthLabel(months[0].month);
  const years = Math.round((months.length + missingMonths(months).length) / 12);
  const span = years >= 2 ? `Over ${years} years (since ${first})` : `Since ${first}`;
  const e = ecoli === 0
    ? `and none had E. coli${resampleEcoli ? ` (it turned up in ${resamples(resampleEcoli)})` : ""}`
    : `and E. coli turned up in ${count(ecoli)} (${sharePct(ecoli, tested)})${resampleEcoli ? `, plus ${resamples(resampleEcoli)}` : ""}`;
  return `${span}, ${sharePct(tested - pos, tested)} of ${count(tested)} routine samples were free of coliform bacteria, ${e}.`;
}

// The months the history covers: through the latest complete one, so a month
// still loading can't spike the line or flip a title. monthly: the monthly job.
export function completeMonths(monthly) {
  const last = monthly?.completeMonth;
  return last ? monthly.months.filter((m) => m.month <= last) : [];
}

/*
 * Share of all routine coliform detections that fell in June–September:
 * { share, positives }, or null when there were none.
 */
export function summerShare(months) {
  let pos = 0, summer = 0;
  for (const m of months) {
    pos += m.coli.pos;
    if (["06", "07", "08", "09"].includes(m.month.slice(5))) summer += m.coli.pos;
  }
  return pos ? { share: summer / pos, positives: pos } : null;
}

// ---------- Detections ----------

// A row from detectionParams() → { sample, date, site, sampleClass, coliform, ecoli }.
export function normalizeDetection(row) {
  return {
    sample: row.sample_number ?? null,
    date: String(row.sample_date ?? "").slice(0, 10),
    time: row.sample_time ?? null,
    site: row.sample_site ?? null,
    sampleClass: row.sample_class ?? null,
    coliform: parseMeasurement(row.coliform_quanti_tray_mpn_100ml, "bacteria"),
    ecoli: parseMeasurement(row.e_coli_quanti_tray_mpn_100ml, "bacteria")
  };
}

export const hasEcoli = (d) => isDetected(d.ecoli);

export const isResample = (sampleClass) => /resample/i.test(sampleClass ?? "");

// E. coli detections in resamples: listed with the rest, but not in the routine counts.
export const resampleEcoli = (detections) => detections.filter((d) => hasEcoli(d) && isResample(d.sampleClass));

// E. coli again in a later sample at the station (d.followUps, from
// laterSamples()): the serious case, red on the report card and station cards.
export const ecoliAgain = (d) => (d.followUps ?? []).some((x) => isDetected(x.ecoli));

// ---------- Places ----------

// Great-circle distance in miles.
export function distanceMiles(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

// The k sites nearest a point (sites without coordinates are skipped), each with .miles.
export function nearestSites(sites, point, k = 3) {
  return sites
    .filter((s) => s.lat != null && s.lon != null)
    .map((s) => ({ ...s, miles: distanceMiles(point, s) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, k);
}

/*
 * "SS - IFO 127-11 E/S Farmers Blvd (Keyspan), 2nd SS N/O Merrick Blvd" →
 * "In front of 127-11 Farmers Blvd (east side), 2nd station north of Merrick Blvd".
 * DEP's descriptions use surveyor shorthand; this expands the common bits.
 */
const SHORTHAND = [
  [/^SS\s*-\s*/i, ""],
  [/\bIFO\b/g, "in front of"],
  [/\bOPP\b/g, "opposite"],
  [/\b(N|S|E|W|NE|NW|SE|SW)\/S\b/g, (_, d) => `on the ${DIRS[d]} side of`],
  [/\b(N|S|E|W|NE|NW|SE|SW)\/O\b/g, (_, d) => `${DIRS[d]} of`],
  [/\bSS\b/g, "station"]
];
const DIRS = { N: "north", S: "south", E: "east", W: "west", NE: "northeast", NW: "northwest", SE: "southeast", SW: "southwest" };

export function plainDescription(text) {
  let out = String(text ?? "").trim();
  for (const [re, to] of SHORTHAND) out = out.replace(re, to);
  out = out.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  return out ? out[0].toUpperCase() + out.slice(1) : "";
}

// "8:41" → minutes after midnight, or null.
const minutesOf = (time) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/*
 * The samples at d's station taken after it, through `days` days later, from
 * `samples` (any class, any station). A same-day sample counts when it was
 * taken later that day, or when either sample has no time.
 */
export function laterSamples(d, samples, days = 14) {
  const end = new Date(Date.parse(`${d.date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
  const t = minutesOf(d.time);
  return samples.filter((f) => {
    if (f.site !== d.site || f.date < d.date || f.date > end) return false;
    if (f.date > d.date) return true;
    if (f.sample != null && f.sample === d.sample) return false;
    const ft = minutesOf(f.time);
    return t == null || ft == null || ft > t;
  });
}

/*
 * One line on the samples at the station after an E. coli detection
 * (d.followUps, from laterSamples()): "3 resamples on Aug 13: all clear ...".
 * Only samples DEP labeled as resamples are called that; DEP doesn't label
 * every repeat sample, and busy stations are sampled most days anyway, so
 * the rest are "later routine samples".
 */
export function followUpText(d, days = 14) {
  const f = d.followUps ?? [];
  if (!f.length) return `No later samples at this station in the data within ${days} days.`;
  const resamples = f.filter((x) => isResample(x.sampleClass));
  const routine = f.filter((x) => !isResample(x.sampleClass));
  const parts = [];
  if (resamples.length) parts.push(`${countText(resamples.length, "resample")} ${whenText(resamples)}: ${resultText(resamples)}`);
  if (routine.length) {
    const label = countText(routine.length, "later routine sample");
    parts.push(`${resamples.length ? "Also " : ""}${label} ${whenText(routine)}: ${resultText(routine)}`);
  }
  return parts.join(" ");
}

const countText = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function whenText(samples) {
  const dates = [...new Set(samples.map((x) => x.date))].sort();
  return dates.length === 1 ? `on ${shortDate(dates[0])}` : `${shortDate(dates[0])}–${shortDate(dates[dates.length - 1])}`;
}

function resultText(samples) {
  const ecoli = samples.filter((x) => isDetected(x.ecoli)).length;
  const coli = samples.filter((x) => isDetected(x.coliform)).length;
  const one = samples.length === 1;
  if (ecoli) return one ? "it also had E. coli." : `${ecoli} also had E. coli.`;
  if (coli) return one ? "no E. coli, but it had coliform bacteria." : `no E. coli; ${coli} had coliform bacteria.`;
  return one ? "clear (no coliform or E. coli)." : "all clear (no coliform or E. coli).";
}

// "2026-08-05" → "Aug 5"
function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
