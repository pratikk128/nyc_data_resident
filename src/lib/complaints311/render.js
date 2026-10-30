/*
 * HTML for the 311 dashboard's sections: overview cards, the above/below-average
 * list, the location-type share bar and "How the city fixes it". Plain strings (no framework), drawn by the
 * section scripts from store.js state.
 * Every chart has a text version: an aria-label summary and a table.
 */
import { count, percent } from "../format.js";
import { ratioText, topTypes, openShare, cityRank, cityRankText } from "./stats.js";
import { typeLabel, LOCATION_GROUPS, OUTCOMES } from "./labels.js";
import { MIN_LOCAL_COUNT, ABOVE_RATIO, BELOW_RATIO, MAX_COMPARE_SHOWN } from "./config.js";

export const escape = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pct = (share) => (share > 0 && share < 0.001 ? "<0.1%" : percent(share, share >= 0.1 ? 0 : 1));

export const HOW_WE_CALCULATE =
  "We compare shares, not raw counts: each complaint type's share of all requests here, divided by its share in the comparison area. " +
  "1× means it makes up the same share as there.";

// ---------- Loading, empty and error states ----------

export const LOADING_TEXT = {
  rank: "Comparing with the rest of NYC…",
  area: "Counting requests near you…",
  baseline: "Working out the borough and city averages…",
  baselineSlow: "Working out the borough and city averages. The first time each day this takes about a minute.",
  outcomes: "Reading how the city closed requests near you…"
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
 * "More requests than 72% of NYC blocks with any 311 requests". quantiles: the window's distribution
 * for this radius (circleDistributions()); "loading" draws a placeholder line,
 * null nothing.
 */
export function cityRankHtml(quantiles, total, { radiusName }) {
  if (quantiles === "loading") return `<p class="c311-rank c311-loading">${escape(LOADING_TEXT.rank)}</p>`;
  const rank = cityRank(quantiles, total);
  if (!rank) return "";
  const { more, pct: p } = cityRankText(rank);
  return (
    `<div class="c311-rank">` +
      `<p>${more ? "More" : "Fewer"} requests than <strong>${p}%</strong> of NYC blocks with any 311 requests` +
        `<span class="c311-rank-how">, counting ${escape(radiusName)} around each</span></p>` +
    `</div>`
  );
}

/*
 * summary: an area summary (stats.js). opts:
 *   title, sub    card heading and the line under it
 *   phrase        "in the last 12 months"
 *   note          optional gentle note (low data)
 *   rank          optional cityRankHtml() under the total
 *   id            unique prefix for ids
 */
export function overviewCardHtml(summary, { title, sub, phrase, note = "", rank = "", id }) {
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
      rank +
      `<h4 class="c311-h4">Most common requests</h4>${topList}` +
      (status ? `<h4 class="c311-h4">Still open vs. closed</h4>${status}` : "") +
    `</article>`
  );
}

// ---------- Above / below average ----------

// One complaint type: name and ratio, with the shares behind it on expand.
function compareItemHtml(row, baselineName, localName, extra) {
  return (
    `<li${extra ? " data-extra hidden" : ""}><details class="c311-cmp-item">` +
      `<summary><span class="c311-cmp-name">${escape(typeLabel(row.key))}</span>` +
      `<span class="c311-cmp-ratio">${ratioText(row.ratio)}</span></summary>` +
      `<p class="c311-cmp-detail">${pct(row.localShare)} of requests ${escape(localName)} (${count(row.count)}) vs. ` +
        `${pct(row.baseShare)} for ${escape(baselineName.replace(/^the /, ""))}</p>` +
    `</details></li>`
  );
}

function compareColumnHtml(rows, { title, empty, kind, baselineName, localName }) {
  const more = rows.length - MAX_COMPARE_SHOWN;
  return (
    `<div class="c311-cmp-col is-${kind}">` +
      `<h3 class="c311-cmp-title">${escape(title)}</h3>` +
      (rows.length
        ? `<ol class="c311-cmp-list">${rows.map((r, i) => compareItemHtml(r, baselineName, localName, i >= MAX_COMPARE_SHOWN)).join("")}</ol>` +
          (more > 0
            ? `<button type="button" class="c311-cmp-more" data-show-more aria-expanded="false" data-more="Show ${more} more">Show ${more} more</button>`
            : "")
        : `<p class="c311-empty">${escape(empty)}</p>`) +
    `</div>`
  );
}

/*
 * result: compareShares() output, drawn as two columns: more common and less
 * common. baselineName: "the Brooklyn average". localName: "here" / "in Queens".
 */
export function compareListHtml(result, { baselineName, localName = "here" }) {
  const opts = { baselineName, localName };
  return (
    `<div class="c311-cmp">` +
      compareColumnHtml(result.above, {
        ...opts, kind: "above", title: `More common ${localName}`,
        empty: `Nothing stands out. No type with at least ${MIN_LOCAL_COUNT} requests is ${ABOVE_RATIO}× as common or more.`
      }) +
      compareColumnHtml(result.below, {
        ...opts, kind: "below", title: `Less common ${localName}`,
        empty: `No type is notably rarer (${BELOW_RATIO}× or under).`
      }) +
    `</div>` +
    `<p class="chart-hint">Select a complaint type to see the numbers behind it.</p>`
  );
}

// ---------- Location types ----------

// Each place keeps its color whatever its rank (slot = its LOCATION_GROUPS order);
// "Other / Not specified" is gray. Colors live in dashboard.css (.c311-place-N).
const placeClass = (key) => {
  const i = LOCATION_GROUPS.findIndex((g) => g.key === key);
  return i < 0 ? "c311-place-other" : `c311-place-${i + 1}`;
};

// One 100% bar: a slice per place, sized by its share.
function shareBarHtml(rows) {
  return `<span class="c311-share-bar">` + rows.filter((r) => r.here > 0).map((r) => (
    `<span class="c311-share-seg ${placeClass(r.key)}" style="flex-grow:${r.here.toFixed(4)}" ` +
      `title="${escape(`${r.key}: ${pct(r.here)}`)}"></span>`
  )).join("") + `</span>`;
}

/*
 * rows: locationComparison() output. names: { here, borough } series names
 * (borough null when there's no borough to compare with). compare: also list the
 * borough's shares in the key and table.
 */
export function locationShareHtml(rows, names, { id, compare = false }) {
  const series = [
    { key: "here", name: names.here },
    compare && names.borough && { key: "borough", name: names.borough }
  ].filter(Boolean);

  // Only the local area gets a bar; the averages are listed in the key.
  const bar = `<div class="c311-share-rows" aria-hidden="true">${shareBarHtml(rows)}</div>`;

  const others = series.slice(1);
  const key = `<ol class="c311-share-key" aria-hidden="true">` + rows.map((r) => (
    `<li><span class="swatch ${placeClass(r.key)}"></span>` +
      `<span class="c311-share-key-name">${escape(r.key)}</span>` +
      `<span class="c311-share-key-val">${pct(r.here)}</span>` +
      (others.length
        ? `<span class="c311-share-key-cmp">${others.map((s) => `${escape(s.name)} average ${pct(r[s.key] ?? 0)}`).join(" · ")}</span>`
        : "") +
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

  return bar + key + srList + table;
}

// ---------- How the city fixes it ----------

// Median whole days (rounded down) → "Usually closed within a day" / "in about 3 days".
export function closeTimeText(days) {
  if (days == null) return "";
  if (days < 1) return "Usually closed within a day";
  return `Usually closed in about ${count(days)} day${days === 1 ? "" : "s"}`;
}

/*
 * types: closedOutcomes() output. One row per complaint type: how long it usually
 * takes to close, a bar split by outcome, and the outcome shares in words.
 */
export function outcomesHtml(types) {
  if (!types.length) return `<p class="c311-empty">Not enough closed requests nearby to say.</p>`;
  const key = `<ul class="c311-fix-key" aria-hidden="true">` + OUTCOMES.map((o) =>
    `<li><span class="swatch c311-fix-${o.key}"></span>${escape(o.label)}</li>`).join("") + `</ul>`;
  const rows = types.map((t) => {
    const total = t.acted + t.none + t.unclear || 1;
    const share = (k) => t[k] / total;
    return (
      `<li>` +
        `<p class="c311-fix-head"><span class="c311-fix-name">${escape(typeLabel(t.key))}</span>` +
          `<span class="c311-fix-days">${escape(closeTimeText(t.days))}</span></p>` +
        `<span class="c311-fix-bar" aria-hidden="true">` + OUTCOMES.filter((o) => t[o.key] > 0).map((o) =>
          `<span class="c311-fix-${o.key}" style="flex-grow:${share(o.key).toFixed(4)}"></span>`).join("") + `</span>` +
        `<p class="c311-fix-text"><strong>${pct(share("acted"))} fixed or ticketed</strong> · ` +
          `${pct(share("none"))} nothing found or no action · ${count(t.closed)} closed</p>` +
      `</li>`
    );
  }).join("");
  return key + `<ol class="c311-fix">${rows}</ol>`;
}
