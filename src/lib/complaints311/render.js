/*
 * HTML for the 311 dashboard's sections: overview cards, the above/below-average
 * list and the location-type bars. Plain strings (no framework), drawn by the
 * section scripts from store.js state.
 * Every chart has a text version: an aria-label summary and a table.
 * Series colors live in dashboard.css (.c311-s-here / -borough / -city).
 */
import { count, percent } from "../format.js";
import { ratioSentence, topTypes, openShare } from "./stats.js";
import { MIN_LOCAL_COUNT, ABOVE_RATIO, BELOW_RATIO, MAX_ABOVE_SHOWN } from "./config.js";

export const escape = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pct = (share) => (share > 0 && share < 0.001 ? "<0.1%" : percent(share, share >= 0.1 ? 0 : 1));

export const HOW_WE_CALCULATE =
  "We compare shares, not raw counts: each complaint type's share of all requests here, divided by its share in the comparison area. " +
  "1× means it makes up the same share as there.";

// ---------- Loading, empty and error states ----------

export const LOADING_TEXT = {
  area: "Counting requests near you…",
  baseline: "Working out the borough and city averages…",
  baselineSlow: "Working out the borough and city averages. The first time each day this takes about a minute."
};

export function skeletonHtml(lines = 3, { blocks = 1, text = "" } = {}) {
  return (text ? `<p class="c311-loading">${escape(text)}</p>` : "") +
    `<div aria-hidden="true">` +
      Array.from({ length: lines }, (_, i) => `<span class="sk-line${i % 2 ? " sk-short" : ""}"></span>`).join("") +
      Array.from({ length: blocks }, () => `<div class="sk-block"></div>`).join("") +
    `</div>`;
}

export const ERROR_TEXT = "Couldn’t reach NYC Open Data. Their servers might be stuck behind a double-parked truck. Try again in a minute.";

export function errorHtml(err) {
  return `<p class="c311-error" role="alert">${escape(err?.shown ?? ERROR_TEXT)}</p>`;
}

// ---------- Overview card ----------

/*
 * summary: an area summary (stats.js). opts:
 *   title, sub    card heading and the line under it
 *   sentence      the generated summary sentence
 *   phrase        "in the last 12 months"
 *   note          optional gentle note (low data)
 *   id            unique prefix for ids
 */
export function overviewCardHtml(summary, { title, sub, sentence, phrase, note = "", id }) {
  const top = topTypes(summary.types);
  const topMax = top[0]?.count || 1;
  const open = openShare(summary.status);
  const statusTotal = summary.status.open + summary.status.closed;

  const topList = top.length
    ? `<ol class="c311-top">` + top.map((t) => (
        `<li><span class="c311-top-name">${escape(t.label)}</span>` +
        `<span class="c311-top-n">${count(t.count)}</span>` +
        `<span class="c311-top-bar" aria-hidden="true"><span style="width:${((t.count / topMax) * 100).toFixed(1)}%"></span></span></li>`
      )).join("") + `</ol>`
    : `<p class="c311-empty">Nothing to list. Even the pigeons are quiet.</p>`;

  const status = statusTotal
    ? `<div class="c311-status">` +
        `<div class="c311-status-bar" aria-hidden="true"><span class="is-open" style="width:${(open * 100).toFixed(1)}%"></span></div>` +
        `<p><strong>${pct(open)} still open</strong> (${count(summary.status.open)}) · ${pct(1 - open)} closed (${count(summary.status.closed)})</p>` +
      `</div>`
    : "";

  return (
    `<article class="c311-card" aria-labelledby="${id}-title">` +
      `<header><h3 class="c311-card-title" id="${id}-title">${escape(title)}</h3>` +
      `<p class="c311-card-sub">${escape(sub)}</p></header>` +
      (note ? `<p class="c311-note" role="note">${escape(note)}</p>` : "") +
      `<p class="stat-value">${count(summary.total)}</p>` +
      `<p class="stat-label">311 requests ${escape(phrase)}</p>` +
      `<p class="c311-sentence">${escape(sentence)}</p>` +
      `<h4 class="c311-h4">Most common requests</h4>${topList}` +
      (status ? `<h4 class="c311-h4">Still open vs. closed</h4>${status}` : "") +
    `</article>`
  );
}

// ---------- Above / below average ----------

function ratioRowHtml(row, baselineName, max, localName) {
  const width = Math.min(100, (row.ratio / max) * 100);
  const avg = (1 / max) * 100;
  return (
    `<li class="c311-ratio-row${row.ratio >= 1 ? " is-above" : " is-below"}">` +
      `<p class="c311-ratio-text">${escape(ratioSentence(row, baselineName, localName)).replace(/^([^:]+):/, "<strong>$1</strong>:")}</p>` +
      `<div class="c311-ratio-track" aria-hidden="true">` +
        `<span class="c311-ratio-fill" style="width:${width.toFixed(1)}%"></span>` +
        `<span class="c311-ratio-avg" style="left:${avg.toFixed(1)}%"></span>` +
      `</div>` +
      `<p class="c311-ratio-detail">${pct(row.localShare)} of requests ${escape(localName)} (${count(row.count)}) vs. ` +
        `${pct(row.baseShare)} for ${escape(baselineName.replace(/^the /, ""))}</p>` +
    `</li>`
  );
}

/*
 * result: compareShares() output. baselineName: "the Brooklyn average".
 * localName: "here" / "in Queens".
 */
export function compareListHtml(result, { baselineName, localName = "here" }) {
  const max = Math.max(2, ...result.above.map((r) => r.ratio)) * 1.05;
  const shown = result.above.slice(0, MAX_ABOVE_SHOWN);
  const more = result.above.slice(MAX_ABOVE_SHOWN);
  const above = result.above.length
    ? `<ol class="c311-ratio-list">${shown.map((r) => ratioRowHtml(r, baselineName, max, localName)).join("")}</ol>` +
      (more.length
        ? `<details class="c311-more"><summary>Show ${more.length} more</summary>` +
            `<ol class="c311-ratio-list" start="${MAX_ABOVE_SHOWN + 1}">${more.map((r) => ratioRowHtml(r, baselineName, max, localName)).join("")}</ol>` +
          `</details>`
        : "") +
      `<p class="chart-hint">The line in each bar marks the average (1×).</p>`
    : `<p class="c311-empty">Nothing stands out. No complaint type with at least ${MIN_LOCAL_COUNT} requests is ` +
      `${ABOVE_RATIO}× as common ${escape(localName)} as ${escape(baselineName)}.</p>`;

  const below = result.below.length
    ? `<details class="c311-below"><summary>Less common than average (${result.below.length})</summary>` +
        `<ol class="c311-ratio-list is-compact">${result.below.map((r) => ratioRowHtml(r, baselineName, 1.05, localName)).join("")}</ol>` +
      `</details>`
    : `<p class="c311-below-none">No complaint type is notably less common (${BELOW_RATIO}× or under) ${escape(localName)}.</p>`;

  return above + below;
}

// ---------- Location types ----------

/*
 * rows: locationComparison() output. names: { here, borough, city } series names
 * (borough null to leave that series out).
 */
export function locationChartHtml(rows, names, { id }) {
  const series = [
    { key: "here", name: names.here },
    names.borough && { key: "borough", name: names.borough },
    { key: "city", name: names.city }
  ].filter(Boolean);
  const max = Math.max(0.01, ...rows.flatMap((r) => series.map((s) => r[s.key] ?? 0)));

  const legend = `<ul class="legend c311-legend" aria-hidden="true">` +
    series.map((s) => `<li><span class="swatch c311-s-${s.key}"></span>${escape(s.name)}</li>`).join("") + `</ul>`;

  const chart = `<ol class="c311-loc-list" aria-hidden="true">` + rows.map((r) => (
    `<li class="c311-loc-row"><p class="c311-loc-name">${escape(r.key)}</p>` +
      series.map((s) => (
        `<div class="c311-loc-bar"><span class="c311-loc-series">${escape(s.name)}</span>` +
        `<span class="c311-loc-track"><span class="c311-loc-fill c311-s-${s.key}" style="width:${(((r[s.key] ?? 0) / max) * 100).toFixed(1)}%"></span></span>` +
        `<span class="c311-loc-val">${pct(r[s.key] ?? 0)}</span></div>`
      )).join("") +
    `</li>`
  )).join("") + `</ol>`;

  const table =
    `<details class="c311-table-toggle"><summary>View as table</summary><div class="table-scroll"><table id="${escape(id)}">` +
      `<caption class="sr-only">Share of 311 requests by type of place</caption>` +
      `<thead><tr><th scope="col">Type of place</th>${series.map((s) => `<th scope="col">${escape(s.name)}</th>`).join("")}</tr></thead>` +
      `<tbody>${rows.map((r) => `<tr><th scope="row">${escape(r.key)}</th>${series.map((s) => `<td>${pct(r[s.key] ?? 0)}</td>`).join("")}</tr>`).join("")}</tbody>` +
    `</table></div></details>`;

  // Screen readers get the table (always in the DOM, inside <details>) and this list.
  const srList = `<ul class="sr-only">` + rows.map((r) =>
    `<li>${escape(r.key)}: ${series.map((s) => `${escape(s.name)} ${pct(r[s.key] ?? 0)}`).join(", ")}</li>`).join("") + `</ul>`;

  return legend + chart + srList + table;
}
