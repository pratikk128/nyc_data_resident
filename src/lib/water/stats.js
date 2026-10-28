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

export const STATUS_TEXT = {
  green: "Looks good",
  amber: "Worth a look",
  red: "Outside the usual range",
  none: "No data"
};

const fmt = (v, digits = 2) => (v == null ? "–" : String(Number(v.toFixed(digits))));
const samples = (k) => `${count(k)} ${k === 1 ? "sample" : "samples"}`;

/*
 * The four or five report card tiles for one month (normalized).
 * Each: { key, label, status, value, valueLabel, sentence, reference }
 */
export function reportCard(m) {
  const tiles = [];

  const ecoliClean = m.ecoli.n - m.ecoli.pos;
  tiles.push({
    key: "ecoli",
    label: "E. coli",
    status: m.ecoli.n ? (m.ecoli.pos ? "amber" : "green") : "none",
    value: sharePct(ecoliClean, m.ecoli.n),
    valueLabel: "with no E. coli",
    sentence: !m.ecoli.n ? "No E. coli results this month."
      : m.ecoli.pos
        ? `E. coli is a sign of sewage or animal waste. It turned up in ${m.ecoli.pos} of ${samples(m.ecoli.n)}; details are below.`
        : `E. coli is a sign of sewage or animal waste. None was found in any of the ${samples(m.ecoli.n)}.`,
    reference: R.ecoli
  });

  const coliClean = m.coli.n - m.coli.pos;
  const coliShare = m.coli.n ? coliClean / m.coli.n : null;
  tiles.push({
    key: "coliform",
    label: "Coliform bacteria",
    status: tileStatus(coliShare),
    value: sharePct(coliClean, m.coli.n),
    valueLabel: "with no coliform",
    sentence: !m.coli.n ? "No coliform results this month."
      : `Coliform bacteria are usually harmless but can signal a way in for germs. ` +
        (m.coli.pos ? `${m.coli.pos} of ${samples(m.coli.n)} had some; the federal review trigger is more than 5%.`
          : `None turned up in any of the ${samples(m.coli.n)}.`),
    reference: R.coliform
  });

  tiles.push({
    key: "chlorine",
    label: "Chlorine",
    status: tileStatus(m.cl.n ? m.cl.ok / m.cl.n : null),
    value: m.cl.med == null ? "–" : `${fmt(m.cl.med)} mg/L`,
    valueLabel: "median",
    sentence: !m.cl.n ? "No chlorine results this month."
      : `Chlorine keeps germs from growing in the pipes. Levels were in the normal range in ${sharePct(m.cl.ok, m.cl.n)} of samples.`,
    reference: R.chlorine
  });

  tiles.push({
    key: "turbidity",
    label: "Cloudiness (turbidity)",
    status: tileStatus(m.turb.n ? m.turb.ok / m.turb.n : null),
    value: m.turb.med == null ? "–" : `${fmt(m.turb.med)} NTU`,
    valueLabel: "median",
    sentence: !m.turb.n ? "No turbidity results this month."
      : `Cloudy water can shield germs from chlorine. ${sharePct(m.turb.ok, m.turb.n)} of samples were at or under the state’s 5 NTU standard.`,
    reference: R.turbidity
  });

  if (m.fl?.n) {
    tiles.push({
      key: "fluoride",
      label: "Fluoride",
      status: tileStatus(m.fl.ok / m.fl.n),
      value: m.fl.med == null ? "–" : `${fmt(m.fl.med)} mg/L`,
      valueLabel: "median",
      sentence: `Fluoride is added to help prevent cavities; the city aims for about 0.7 mg/L. ` +
        `${sharePct(m.fl.ok, m.fl.n)} of the ${samples(m.fl.n)} tested were under the EPA’s 4.0 mg/L maximum.`,
      reference: R.fluoride
    });
  }
  return tiles;
}

/*
 * One sentence for the history page:
 * "Since January 2015, 99.6% of 160,312 routine samples had no coliform bacteria, and E. coli turned up in 6."
 */
export function historyTakeaway(months) {
  if (!months.length) return "";
  let tested = 0, pos = 0, ecoli = 0;
  for (const m of months) { tested += m.coli.n; pos += m.coli.pos; ecoli += m.ecoli.pos; }
  if (!tested) return "";
  const first = monthLabel(months[0].month);
  const years = Math.round((months.length + missingMonths(months).length) / 12);
  const span = years >= 2 ? `Over ${years} years (since ${first})` : `Since ${first}`;
  const e = ecoli === 0 ? "and none had E. coli"
    : `and E. coli turned up in ${count(ecoli)} (${sharePct(ecoli, tested)})`;
  return `${span}, ${sharePct(tested - pos, tested)} of ${count(tested)} routine samples were free of coliform bacteria, ${e}.`;
}

// ---------- Detections ----------

// A row from detectionParams() → { sample, date, site, sampleClass, coliform, ecoli }.
export function normalizeDetection(row) {
  return {
    sample: row.sample_number ?? null,
    date: String(row.sample_date ?? "").slice(0, 10),
    site: row.sample_site ?? null,
    sampleClass: row.sample_class ?? null,
    coliform: parseMeasurement(row.coliform_quanti_tray_mpn_100ml, "bacteria"),
    ecoli: parseMeasurement(row.e_coli_quanti_tray_mpn_100ml, "bacteria")
  };
}

export const hasEcoli = (d) => isDetected(d.ecoli);

export const isResample = (sampleClass) => /resample/i.test(sampleClass ?? "");

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

/*
 * One line on DEP's follow-up samples after an E. coli detection (d.followUps,
 * from the detections job): "3 follow-up samples on Aug 5: all clear."
 */
export function followUpText(d, days = 14) {
  const f = d.followUps ?? [];
  if (!f.length) return `No follow-up samples at this station in the data within ${days} days.`;
  const dates = [...new Set(f.map((x) => x.date))];
  const when = dates.length === 1 ? `on ${shortDate(dates[0])}` : `${shortDate(dates[0])}–${shortDate(dates[dates.length - 1])}`;
  const ecoli = f.filter((x) => isDetected(x.ecoli)).length;
  const coli = f.filter((x) => isDetected(x.coliform)).length;
  const result = ecoli ? `${ecoli} also had E. coli.`
    : coli ? `no E. coli; ${coli} had coliform bacteria.`
    : "all clear (no coliform or E. coli).";
  return `${f.length} follow-up ${f.length === 1 ? "sample" : "samples"} ${when}: ${result}`;
}

// "2026-08-05" → "Aug 5"
function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
