/*
 * HTML for the NYC School Quality Explorer: filter options, result cards,
 * pager, and the badges and chips the school page shares with them. Used by
 * the server (first view) and the browser script (every later view).
 * Data shapes come from filter.js (searchSchools / resultRecord).
 */
import { TYPES, TYPE_BY_SLUG, BOROUGHS, schoolPath, yearLabel } from "./config.js";
import { METRICS, METRIC_SORTS, cardMetrics } from "./metrics.js";
import { SORTS, sortApplies } from "./filter.js";
import { formatValue, targetBand, compare, verdict, TREND_TEXT, NOT_REPORTED } from "./values.js";
import { count } from "../format.js";

export const escape = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const UPSTREAM_TEXT = "We couldn’t reach NYC Open Data just now. Please try again in a minute.";
export const LOADING_TEXT = "Finding schools…";
export const NO_ADDRESS = "Address not available";

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

// ---------- Badges ----------

export function typeBadges(types) {
  return (types ?? []).map((slug) => TYPE_BY_SLUG[slug])
    .filter(Boolean)
    .map((t) => `<span class="sq-badge" data-tone="${t.tone}">${escape(t.label)}</span>`)
    .join("");
}

// Generic borough bullet (not an MTA mark) + the borough name.
export function boroughHtml(boro) {
  if (!boro) return "";
  const b = BOROUGHS.find((x) => x.label === boro);
  return `<span class="sq-boro">${b ? `<span class="sq-boro-bullet" aria-hidden="true">${b.bullet}</span>` : ""}${escape(boro)}</span>`;
}

export function addressText(loc) {
  if (!loc?.address) return NO_ADDRESS;
  return [loc.address, loc.zip].filter(Boolean).join(", ");
}

// DOE's target band as a badge, or "" without a score. Text carries the meaning, color only helps.
export function bandBadge(score, { short = false } = {}) {
  const band = targetBand(score);
  if (!band) return "";
  return `<span class="sq-band" data-band="${band.tone}" title="DOE metric score ${score.toFixed(2)} of 4.99">${escape(short ? band.short : band.label)}</span>`;
}

export function trendChip(metric, t) {
  if (!t?.dir) return `<span class="sq-trend" data-dir="none">Not enough years for a trend</span>`;
  return `<span class="sq-trend" data-dir="${t.dir}">${TREND_TEXT[t.dir]}</span>`;
}

// "6 pts above NYC avg (54%)" or "" when there's nothing to compare.
export function vsCityText(metric, v, city) {
  if (city == null) return "";
  const c = compare(metric, v, city);
  const avg = formatValue(metric, city);
  if (!c) return `NYC avg ${avg}`;
  return c.dir === "same" ? `Same as NYC avg (${avg})` : `${c.text} NYC avg (${avg})`;
}

// The headline call next to the NYC average (values.js verdict()). Words carry the meaning, color only helps.
export const VERDICTS = {
  better: { label: "Better than NYC average", group: "Better than the NYC average" },
  similar: { label: "About the NYC average", group: "About the same as the NYC average" },
  worse: { label: "Worse than NYC average", group: "Worse than the NYC average" }
};

export function verdictPill(v) {
  const x = VERDICTS[v];
  if (!x) return "";
  return `<span class="sq-verdict" data-verdict="${v}">${escape(x.label)}</span>`;
}

// ---------- Filters ----------

const option = (value, label, selected) =>
  `<option value="${escape(value)}"${selected ? " selected" : ""}>${escape(label)}</option>`;

export function typeOptionsHtml(counts, selected) {
  return option("", "All school types", !selected) + TYPES
    .filter((t) => !counts || counts[t.slug] > 0 || t.slug === selected)
    .map((t) => option(t.slug, counts ? `${t.label} (${count(counts[t.slug] ?? 0)})` : t.label, t.slug === selected)).join("");
}

export function boroughOptionsHtml(counts, selected) {
  return option("", "All boroughs", !selected) + BOROUGHS
    .map((b) => option(b.slug, counts ? `${b.label} (${count(counts[b.slug] ?? 0)})` : b.label, b.slug === selected)).join("");
}

// ---------- What matters most (sort) ----------

// The sort choices as radio chips in groups. Metric sorts no school of the
// chosen type has are left out (unless chosen). The first choice reads
// "Best match" while there's a name search, since that's what it does then.
export function sortChipsHtml(query) {
  const groups = new Map();
  for (const s of SORTS) {
    if (s.value !== query.sort && !sortApplies(s.value, query.type)) continue;
    const label = s.value === "" && query.q ? "Best match" : s.label;
    const chip = `<label class="sq-chip"><input type="radio" name="sort" value="${escape(s.value)}" form="sq-filters"${s.value === query.sort ? " checked" : ""} data-sort><span>${escape(label)}</span></label>`;
    groups.set(s.group, [...(groups.get(s.group) ?? []), chip]);
  }
  return [...groups].map(([group, chips]) => `
    <div class="sq-rank-group" role="group" aria-label="${escape(group)}">
      <span class="sq-rank-group-label" aria-hidden="true">${escape(group)}</span>
      <span class="sq-rank-chips">${chips.join("")}</span>
    </div>`).join("");
}

// What the chosen sort does, and who it leaves at the end. "" for name order.
export function sortNoteText(sortKey) {
  if (sortKey === "district") return "Sorted by district, then name.";
  const sort = METRIC_SORTS.find((s) => s.value === sortKey);
  if (!sort) return "";
  const dir = sort.metrics[0]?.higherIsBetter === false ? "lowest first" : "highest first";
  // Mid-sentence: "Average attendance" → "average attendance", but ELA stays ELA.
  const label = sort.label.replace(/ \(.*\)$/, "").replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());
  return `Ranked by ${label}, ${dir}. Reported for ${sort.note}; schools without it are listed after the ranked ones.`;
}

// ---------- Results ----------

// "1,874 schools · page 2 of 79" (no pages on the map, which shows every match)
export function statusText(data, view = "list") {
  if (!data.total) return "No schools match.";
  if (view === "map") return plural(data.total, "school");
  const pages = data.pages > 1 ? ` · page ${count(data.page)} of ${count(data.pages)}` : "";
  const order = data.q && !data.sort ? " · best matches first" : "";
  return `${plural(data.total, "school")}${pages}${order}`;
}

// The "vs NYC avg" line, tinted only when clearly better or worse ("similar" stays quiet).
// "Below" can be good (absenteeism), so hidden text says which for screen readers.
function cardVsHtml(vs, v) {
  if (v !== "better" && v !== "worse") return `<span class="sq-card-vs">${escape(vs)}</span>`;
  return `<span class="sq-card-vs" data-verdict="${v}">${escape(vs)}<span class="sr-only"> (${v})</span></span>`;
}

// The card measures, with the one the list is ranked by first and marked
// (added when it isn't a card measure).
function cardMetricsHtml(r) {
  const sorted = r.sorted && METRICS.find((m) => m.id === r.sorted.id);
  const metrics = sorted ? [sorted, ...cardMetrics(r.report).filter((m) => m !== sorted)] : cardMetrics(r.report);
  if (!metrics.length) return "";
  const items = metrics.map((m) => {
    const value = r.values?.[m.id];
    const v = value?.v ?? null;
    const city = m === sorted ? r.sorted.city : r.city?.[m.id];
    const vs = v == null ? "" : vsCityText(m, v, city);
    return `<div class="sq-card-metric"${m === sorted ? " data-sorted" : ""}>
        <dt>${escape(m.label)}</dt>
        <dd><span class="sq-card-value${v == null ? " is-missing" : ""}">${escape(formatValue(m, v))}</span>${vs ? cardVsHtml(vs, verdict(m, v, city)) : ""}</dd>
      </div>`;
  }).join("");
  return `<dl class="sq-card-metrics">${items}</dl>`;
}

// Only the name is a link (screen readers hear the school, not every number);
// its ::after stretches over the card so the whole card is clickable, and
// "See full report" shows that (it's part of the link's target, not a second
// link). The Compare button sits above that and is shown by the browse page's script.
// Under a metric sort, r.rank is the school's place in the ranking.
export function cardsHtml(results, latestYear) {
  return results.map((r) => `
    <li>
      <article class="sq-card">
        <span class="sq-card-top">
          <span class="sq-card-badges">${typeBadges(r.types)}</span>
          ${r.rank ? `<span class="sq-card-rank"><span class="sr-only">Ranked </span>#${count(r.rank)}</span>` : ""}
        </span>
        <h3 class="sq-card-name"><a class="sq-card-link" href="${escape(schoolPath(r.dbn))}">${escape(r.name)}</a></h3>
        <span class="sq-card-meta">${escape(r.dbn)}${r.district ? ` · ${escape(r.district)}` : ""}</span>
        <span class="sq-card-place">${boroughHtml(r.boro)}<span class="sq-card-address${r.loc?.address ? "" : " is-missing"}">${escape(addressText(r.loc))}</span></span>
        ${cardMetricsHtml(r)}
        <span class="sq-card-year">${r.current ? `${yearLabel(r.year)} report` : `Latest report: ${yearLabel(r.year)} · none for ${yearLabel(latestYear)}`}</span>
        <span class="sq-card-foot">
          <span class="sq-card-open" aria-hidden="true">See full report<span class="sq-card-arrow">→</span></span>
          <button type="button" class="sq-compare-btn" data-compare="${escape(r.dbn)}" data-name="${escape(r.name)}" aria-pressed="false" hidden>Compare<span class="sr-only"> ${escape(r.name)}</span></button>
        </span>
      </article>
    </li>`).join("");
}

export function skeletonCards(n = 6) {
  return Array.from({ length: n }, () =>
    `<li aria-hidden="true"><span class="sq-card is-skeleton"><span class="sk-line sk-short"></span><span class="sk-line"></span><span class="sk-line"></span></span></li>`
  ).join("");
}

// Links, so paging works without script and in a new tab. hrefFor(page) → URL.
export function pagerHtml(data, hrefFor) {
  if (data.pages <= 1) return "";
  const link = (page, label, rel) => page < 1 || page > data.pages
    ? `<span class="pager-btn" aria-disabled="true">${label}</span>`
    : `<a class="pager-btn" href="${escape(hrefFor(page))}" data-page="${page}" rel="${rel}">${label}</a>`;
  return `${link(data.page - 1, "Previous", "prev")}<span class="sq-pager-text">Page ${count(data.page)} of ${count(data.pages)}</span>${link(data.page + 1, "Next", "next")}`;
}

// "Include 132 schools with no 2024–25 report"
export function olderLabel(n, latestYear) {
  return `Include ${n ? `${plural(n, "school")} ` : "schools "}with no ${yearLabel(latestYear)} report`;
}

export { NOT_REPORTED };
