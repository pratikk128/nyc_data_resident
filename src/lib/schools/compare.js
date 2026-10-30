/*
 * Compare schools: up to 3 schools side by side, one row per curated measure
 * from each school's latest report of one shared type. Shared by the compare
 * page (src/pages/school-quality/compare.astro), the browse page's compare
 * tray and the tests.
 *
 * URL: /school-quality/compare/?schools=02M475,13K430[&report=HS]
 *   schools  DBNs, comma-separated, in column order (duplicates and extras dropped)
 *   report   which report to compare when the schools share more than one (6–12 schools)
 *   add      a name or DBN typed into "Add a school" without script
 */
import { BASE_PATH, REPORTS, REPORT_ORDER, TYPE_BY_SLUG, normalizeDbn } from "./config.js";
import { metricsFor } from "./metrics.js";
import { compare, verdict } from "./values.js";
import { escape, typeBadges } from "./render.js";

export const MAX_COMPARE = 3;
export const COMPARE_PATH = `${BASE_PATH}compare/`;

// "02m475, 13K430,02M475" → ["02M475", "13K430"]; anything that isn't a DBN is dropped.
export function parseSchools(value) {
  const out = [];
  for (const part of String(value ?? "").split(",")) {
    const dbn = normalizeDbn(part);
    if (dbn && !out.includes(dbn)) out.push(dbn);
  }
  return out.slice(0, MAX_COMPARE);
}

// DBNs are letters and digits, so the commas can stay readable in the link.
export function compareHref(dbns, { report } = {}) {
  const list = parseSchools(dbns.join(","));
  const params = [list.length ? `schools=${list.join(",")}` : "", report ? `report=${encodeURIComponent(report)}` : ""].filter(Boolean);
  return params.length ? `${COMPARE_PATH}?${params.join("&")}` : COMPARE_PATH;
}

const reportsWithData = (school) => school.reports.filter((r) => r.years.length);

/*
 * Which report to line up: the one most of the schools have (ties go to the
 * first school's main report), or `requested` when at least 2 schools have it.
 * → { report, options: report codes 2+ schools share, in REPORT_ORDER } or null.
 */
export function chooseReport(schools, requested) {
  const counts = new Map();
  for (const s of schools) for (const r of reportsWithData(s)) counts.set(r.report, (counts.get(r.report) ?? 0) + 1);
  const options = REPORT_ORDER.filter((code) => (counts.get(code) ?? 0) >= 2);
  if (!options.length) return null;
  if (options.includes(requested)) return { report: requested, options };
  const firstOrder = reportsWithData(schools[0] ?? { reports: [] }).map((r) => r.report);
  const rank = (code) => (firstOrder.includes(code) ? firstOrder.indexOf(code) : 10 + REPORT_ORDER.indexOf(code));
  const report = [...options].sort((a, b) => counts.get(b) - counts.get(a) || rank(a) - rank(b))[0];
  return { report, options };
}

/*
 * Which of the values is best, as shown (54% and 54.2% tie). Empty when fewer
 * than 2 values, all of them tie, or the measure has no better direction.
 */
export function bestOf(metric, values) {
  if (metric.higherIsBetter == null || metric.context) return [];
  const present = values.map((v, i) => [v, i]).filter(([v]) => v != null);
  if (present.length < 2) return [];
  const top = present.reduce((a, b) => ((metric.higherIsBetter ? b[0] > a[0] : b[0] < a[0]) ? b : a))[0];
  const best = present.filter(([v]) => compare(metric, v, top)?.dir === "same").map(([, i]) => i);
  return best.length === present.length ? [] : best;
}

/*
 * The table: schools (from schoolDetail) with the report to compare →
 * { report, columns, left, rows, context, cityLine } where
 *   columns  [{ dbn, name, types, boro, year, type, n }]  the schools that have this report, n = 1-based slot
 *   left     the schools that don't (named in a note, not given empty columns)
 *   rows     [{ metric, cells: [{ v, verdict, trend, best }], city, compared }]  quality measures any of them reported
 *   context  the same for context measures (students), no calls
 *   cityLine true when every column is the same school type and year, so one NYC average fits the row
 */
export function compareTable(schools, report) {
  const columns = [];
  const left = [];
  schools.forEach((s, i) => {
    const r = reportsWithData(s).find((x) => x.report === report);
    if (r) columns.push({ dbn: s.dbn, name: s.name, types: s.types, boro: s.boro, year: r.year, type: r.type, n: i + 1, r });
    else left.push({ dbn: s.dbn, name: s.name, n: i + 1 });
  });
  const cityLine = columns.length > 0 && columns.every((c) => c.type === columns[0].type && c.year === columns[0].year);
  const rows = [];
  const context = [];
  for (const metric of metricsFor(report)) {
    const cells = columns.map((c) => {
      const entry = c.r.metrics.find((e) => e.id === metric.id);
      const v = entry?.points?.[c.year]?.v ?? null;
      const city = entry?.city?.[c.year] ?? null;
      return { v, city, verdict: metric.context ? null : verdict(metric, v, city), trend: v == null ? null : entry?.trend ?? null };
    });
    if (!cells.some((c) => c.v != null)) continue;
    const best = new Set(bestOf(metric, cells.map((c) => c.v)));
    const row = {
      metric,
      cells: cells.map((c, i) => ({ ...c, best: best.has(i) })),
      city: cityLine ? cells.find((c) => c.city != null)?.city ?? null : null,
      // 2+ values on a measure with a better direction: counted in "best on N of M", ties included
      compared: cells.filter((c) => c.v != null).length >= 2 && metric.higherIsBetter != null && !metric.context
    };
    (metric.context ? context : rows).push(row);
  }
  return { report, columns: columns.map(({ r, ...c }) => c), left, rows, context, cityLine };
}

/*
 * The takeaway, per column: the measures that school comes out ahead on, in
 * row order: [{ metric, v, text: "Lowest chronic absenteeism" | "Tied for
 * highest ELA proficiency" }], or null when no measure could be compared at all.
 */
export function aheadOn(table) {
  if (!table.rows.some((r) => r.compared)) return null;
  return table.columns.map((_, i) => table.rows
    .filter((r) => r.cells[i].best)
    .map((r) => {
      const lead = r.metric.lead ?? `${r.metric.higherIsBetter ? "Highest" : "Lowest"} ${midSentence(r.metric.label)}`;
      const tied = r.cells.filter((c) => c.best).length > 1;
      return { metric: r.metric, v: r.cells[i].v, text: tied ? `Tied for ${midSentence(lead)}` : lead };
    }));
}

// Mid-sentence: "math proficiency", but "ELA proficiency".
export const midSentence = (label) => /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;

// The NYC-average line under a measure: "NYC avg for middle schools: 54%".
export function cityPeers(table) {
  const type = table.columns[0]?.type;
  return TYPE_BY_SLUG[type]?.plural ?? REPORTS[table.report]?.plural ?? "schools";
}

// "Add a school" matches as links that add the school (search results from filter.js).
export function pickListHtml(results, dbns, { report } = {}) {
  return results
    .filter((r) => !dbns.includes(r.dbn))
    .map((r) => `
      <li>
        <a class="sq-pick" href="${escape(compareHref([...dbns, r.dbn], { report }))}" data-pick="${escape(r.dbn)}" data-name="${escape(r.name)}">
          <span class="sq-pick-name">${escape(r.name)}</span>
          <span class="sq-pick-meta">${typeBadges(r.types)}<span>${escape(r.dbn)}${r.boro ? ` · ${escape(r.boro)}` : ""}</span></span>
        </a>
      </li>`).join("");
}
