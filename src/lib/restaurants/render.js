/*
 * HTML for the restaurant lookup: result cards, the detail view and the
 * violation-category list. Shared by the page script (search results and
 * restaurants picked from them) and the server (a ?camis= deep link renders
 * the detail on the server). Data shapes come from src/lib/server/restaurants.js.
 */
import { date, count } from "../format.js";
import { gradeInfo, SCORE_BANDS, MIN_REPEAT_INSPECTIONS } from "./inspections.js";
import { categoryLabel } from "./violation-categories.js";

export const escape = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const UPSTREAM_TEXT = "Couldn’t reach NYC Open Data. Their servers might be stuck behind a double-parked truck. Try again in a minute.";

export const SCORE_HINT = "Lower is better. A = 0–13 points, B = 14–27, C = 28 or more.";

// Big badge: a letter for A/B/C, words for not-yet-graded and pending.
export function gradeBadge(grade, { size = "lg" } = {}) {
  const info = gradeInfo(grade);
  const inner = info.short
    ? `<span class="grade-letter" aria-hidden="true">${info.short}</span><span class="sr-only">${info.label}</span>`
    : `<span class="grade-words">${escape(info.label)}</span>`;
  return `<span class="grade-badge grade-${size}" data-tone="${info.tone}">${inner}</span>`;
}

export function placeLine(r) {
  return [r.address, [r.boro, r.zipcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// "0.2 mi" from "near me"; anything closer than a tenth rounds up to it.
export function milesText(miles) {
  return `${Math.max(0.1, Math.round(miles * 10) / 10).toFixed(1)} mi`;
}

export const detailHref = (camis) => `/restaurant-inspections/?camis=${encodeURIComponent(camis)}`;

export function resultCardsHtml(results) {
  return results.map((r) => {
    const when = r.lastInspected ? `Last inspected ${date(r.lastInspected)}` : "Not yet inspected";
    // The grade can be years older than the last inspection, so date it.
    const graded = r.grade ? `<span class="rest-card-graded">Graded ${date(r.grade.date)}</span>` : "";
    return (
      `<li><a class="rest-card" href="${detailHref(r.camis)}" data-camis="${escape(r.camis)}">` +
        `<span class="rest-card-grade">${gradeBadge(r.grade?.grade, { size: "md" })}${graded}</span>` +
        `<span class="rest-card-body">` +
          `<span class="rest-card-name">${escape(r.name)}</span>` +
          `<span class="rest-card-place">${r.miles != null ? `${milesText(r.miles)} · ` : ""}${escape(placeLine(r))}</span>` +
          `<span class="rest-card-meta">${r.cuisine ? `${escape(r.cuisine)} · ` : ""}${when}</span>` +
        `</span>` +
        `<span class="rest-card-arrow" aria-hidden="true">→</span>` +
      `</a></li>`
    );
  }).join("");
}

// The line above the results. `named`: the search has a name; `near`: "near me" is on.
export function searchStatusText({ results, more }, { named, near }) {
  const n = results.length;
  if (n === 0) return "No matches. Try a nearby ZIP code or fewer words.";
  if (more) {
    const which = near ? `${n} nearest` : named ? `${n} closest matches` : `first ${n}`;
    return named
      ? `More restaurants match than we can show, so here are the ${which}. Add a borough or ZIP code to narrow it down.`
      : `More restaurants ${near ? "are nearby" : "match"} than we can show, so here are the ${which}. Type a name to narrow it down.`;
  }
  return `${n} ${n === 1 ? "restaurant matches" : "restaurants match"}${near ? " within about half a mile" : ""}.`;
}

// "Cycle Inspection / Initial Inspection" → "Cycle Inspection · Initial Inspection"
function typeLabel(type) {
  return escape(type).replace(/ \/ /g, " · ");
}

// The category label ("Food temperature") ties each violation to the Problem areas below.
function violationItemHtml(v) {
  const critical = v.critical === "Critical";
  return `<li class="violation${critical ? " is-critical" : ""}">` +
    `<p class="violation-cat">${escape(categoryLabel(v.category))}</p>` +
    `<p class="violation-text">${escape(v.description)}</p></li>`;
}

function latestViolationsHtml(latest) {
  const critical = latest.violations.filter((v) => v.critical === "Critical");
  const other = latest.violations.filter((v) => v.critical !== "Critical");
  const list = critical.length
    ? `<ul class="violations">${critical.map(violationItemHtml).join("")}</ul>`
    : `<p class="insp-summary">No critical violations were cited at the latest inspection.</p>`;
  // The rest cited that day, behind a toggle.
  const more = other.length
    ? `<details class="cat-more all-violations"><summary>Show ${count(other.length)} non-critical ` +
      `${other.length === 1 ? "violation" : "violations"}</summary>` +
      `<ul class="violations">${other.map(violationItemHtml).join("")}</ul></details>`
    : "";
  return list + more;
}

// ---------- Category list ----------

export function categoryListHtml(cmp, benchmark) {
  // With nothing to divide by, every rate is 0, which would read as an all-clear.
  if (!cmp.inspections) {
    return `<p class="insp-summary">This restaurant has no inspections in this window (since ${date(cmp.since)}), so there's nothing to compare.</p>`;
  }
  // Fewer inspections than a pattern needs: say so rather than "nothing stands out".
  if (cmp.inspections < MIN_REPEAT_INSPECTIONS) {
    return `<p class="insp-summary">This restaurant has had ${count(cmp.inspections)} ` +
      `${cmp.inspections === 1 ? "inspection" : "inspections"} since ${date(cmp.since)}. A problem area needs at least ` +
      `${MIN_REPEAT_INSPECTIONS}, so it's too soon to spot a pattern.</p>`;
  }
  const rows = cmp[benchmark].rows.filter((r) => r.above);
  if (!rows.length) {
    const who = benchmark === "citywide" ? "the city average" : "the average for similar restaurants";
    return `<p class="insp-summary">Nothing stands out. No kind of violation was cited here at ${MIN_REPEAT_INSPECTIONS} or more ` +
      `inspections and twice as often as ${who}.</p>`;
  }

  const where = benchmark === "citywide" ? "the average NYC restaurant" : "similar restaurants";
  const whereShort = benchmark === "citywide" ? "NYC average" : "Similar places";
  // Bars and chips carry the numbers at a glance; the full sentence is for screen readers.
  return `<ol class="cat-list">` + rows.map((r) => {
    const top = Math.max(r.value, r.mean);
    return `<li class="cat-row is-above">` +
      `<div class="cat-head">` +
        `<span class="cat-name">${escape(r.label)}</span>` +
        (r.mean > 0 ? `<span class="cat-times" aria-hidden="true">${timesShort(r.value / r.mean)}</span>` : "") +
      `</div>` +
      `<p class="sr-only">${rateText(r.value)} per inspection here vs ${rateText(r.mean)} at ${where}` +
        `${r.mean > 0 ? ` (${timesText(r.value / r.mean)})` : ""}. ` +
        `Cited at ${count(r.inspections)} of ${count(cmp.inspections)} inspections.</p>` +
      `<p class="cat-meta" aria-hidden="true">Cited at <strong>${count(r.inspections)} of ${count(cmp.inspections)}</strong> inspections</p>` +
      `<p class="cat-blurb">${escape(r.blurb)}</p>` +
      // The per-inspection numbers are there on request.
      `<details class="cat-compare"><summary>Compare: here vs ${whereShort === "NYC average" ? whereShort : "similar places"}</summary>` +
        `<div class="cat-bars" aria-hidden="true">` +
          catBarHtml("Here", r.value, top, "is-here") +
          catBarHtml(whereShort, r.mean, top, "") +
        `</div>` +
        `<p class="cat-meta" aria-hidden="true">Violations per inspection</p>` +
      `</details>` +
    `</li>`;
  }).join("") + `</ol>`;
}

function catBarHtml(label, value, top, cls) {
  // A sliver even at zero, so an empty bar still reads as a bar.
  const pct = top > 0 ? Math.max(2, (value / top) * 100) : 2;
  return `<span class="cat-bar-label">${label}</span>` +
    `<span class="cat-bar-track"><span class="cat-bar${cls ? ` ${cls}` : ""}" style="width:${pct.toFixed(1)}%"></span></span>` +
    `<span class="cat-bar-value">${rateText(value)}</span>`;
}

// "8×", "2.4×": the chip version of timesText.
function timesShort(ratio) {
  return `${ratio < 3 ? Math.round(ratio * 10) / 10 : Math.round(ratio)}×`;
}

// Violations per inspection: "1.5", "0.4", "0.03". Small means need the extra digit.
export function rateText(n) {
  if (n > 0 && n < 0.01) return "under 0.01";
  return n > 0 && n < 0.1 ? n.toFixed(2) : n.toFixed(1);
}

// "about 7 times as often"; a ratio under 3 keeps one decimal ("2.4 times").
export function timesText(ratio) {
  const n = ratio < 3 ? Math.round(ratio * 10) / 10 : Math.round(ratio);
  return `${n} times as often`;
}

export function benchmarkNote(cmp, benchmark) {
  const g = cmp[benchmark];
  if (benchmark === "citywide") {
    return `Compared with the average inspection across all ${count(g.restaurants)} restaurants inspected citywide since ${date(cmp.since)}.`;
  }
  return `Compared with the average inspection across ${count(g.restaurants)} ${escape(g.cuisine)} restaurants in ${escape(g.boro)} inspected since ${date(cmp.since)}.`;
}

// ---------- Detail view ----------

function gradeContext(d) {
  const g = d.latestGrade;
  if (!g) return d.notYetInspected ? "This restaurant hasn't been inspected yet." : "No grade on record yet.";
  const latest = d.latest;
  let text = `${gradeInfo(g.grade).label}.`;
  if (latest && latest.date !== g.date) {
    text = `${gradeInfo(g.grade).label} since ${date(g.date)}. The latest inspection didn't come with a grade, so this one is from an earlier visit.`;
  }
  return escape(text);
}

function latestScoreContext(latest) {
  if (latest.score == null) return "This type of inspection isn't scored.";
  const band = SCORE_BANDS.find((b) => latest.score <= b.max);
  return `In the ${band.grade} range. ${SCORE_HINT}`;
}

// d.latest is the newest scored inspection; say so when there's a newer visit that isn't.
function newerUnscoredNote(d) {
  const v = d.newerUnscored;
  if (!v) return "";
  const what = v.types.length ? `${v.types.map(typeLabel).join(", ")} visit` : "visit";
  return `<p class="chart-hint">From the ${date(d.latest.date)} inspection. A newer ${what} on ${date(v.date)} ` +
    `wasn't a full inspection: it isn't scored and doesn't cite critical violations.</p>`;
}

// ---------- Inspection history ----------

const HISTORY_SHOWN = 8;

function historyRowHtml(insp) {
  const info = gradeInfo(insp.grade);
  const grade = insp.grade ? escape(info.short ?? info.label) : "—";
  return `<tr><th scope="row">${date(insp.date)}</th>` +
    `<td class="cell-text">${insp.types.map(typeLabel).join(", ") || "Not listed"}</td>` +
    `<td>${count(insp.score)}</td>` +
    `<td class="history-grade" data-tone="${info.tone}">${grade}</td></tr>`;
}

function historyTableHtml(rows) {
  return `<div class="table-scroll"><table>` +
    `<thead><tr><th scope="col">Date</th><th scope="col" class="cell-text">Inspection</th>` +
    `<th scope="col">Score</th><th scope="col">Grade</th></tr></thead>` +
    `<tbody>${rows.map(historyRowHtml).join("")}</tbody></table></div>`;
}

// Is the score going up or down? Latest scored inspection vs the one before it.
function historySummary(history) {
  if (history.length < 2) return "This is the only scored inspection on record.";
  const [now, before] = history;
  const change = now.score === before.score ? `the same score as`
    : now.score < before.score ? `${count(before.score - now.score)} points better than`
    : `${count(now.score - before.score)} points worse than`;
  return `The latest score is ${change} the inspection before it, on ${date(before.date)}.`;
}

export function historyHtml(history = []) {
  if (!history.length) return "";
  const recent = history.slice(0, HISTORY_SHOWN);
  const rest = history.slice(HISTORY_SHOWN);
  const older = rest.length
    ? `<details class="cat-more all-history"><summary>Show ${count(rest.length)} older ` +
      `${rest.length === 1 ? "inspection" : "inspections"}</summary>${historyTableHtml(rest)}</details>`
    : "";
  return `<section class="rest-block" aria-labelledby="history-title">` +
    `<h3 class="chart-title" id="history-title">Past inspections</h3>` +
    `<p class="insp-summary">${historySummary(history)}</p>` +
    `<p class="chart-hint">${SCORE_HINT} A score of 14 or more at an initial inspection isn't graded; ` +
    `the grade comes from the re-inspection about a month later.</p>` +
    historyTableHtml(recent) + older +
  `</section>`;
}

// The "similar restaurants" comparison needs an inspection and enough similar restaurants.
export const similarAvailable = (d) => Boolean(d.latest && d.categories.similar.rows);

export function detailHtml(d, { benchmark = "citywide" } = {}) {
  const latest = d.latest;
  const cmp = d.categories;
  const similarOk = similarAvailable(d);
  const shown = similarOk ? benchmark : "citywide";

  const head =
    `<header class="rest-head">` +
      `<div class="rest-head-text">` +
        `<p class="rest-kicker">${escape(d.cuisine || "Restaurant")}</p>` +
        `<h2 id="restaurant-title" tabindex="-1">${escape(d.name)}</h2>` +
        `<p class="rest-place">${escape(placeLine(d))}</p>` +
      `</div>` +
      `<div class="rest-head-side">` +
        `<p class="rest-inspected">${latest ? `Inspected <strong>${date(latest.date)}</strong>` : "Not yet inspected"}</p>` +
        `<button type="button" class="copy-link" data-copy-link>Copy link to this restaurant</button>` +
        `<p class="sr-only" role="status" data-copy-status></p>` +
        // Clipboard blocked: the link goes here so it can be selected and copied by hand.
        `<label class="copy-fallback" data-copy-fallback hidden><span>Copy this link:</span>` +
          `<input class="search-input" type="text" readonly data-copy-input /></label>` +
      `</div>` +
    `</header>`;

  const stats =
    `<div class="stat-grid rest-stats">` +
      `<div class="stat-card grade-card">` +
        `<p class="stat-label">Latest grade</p>` +
        `<div class="grade-card-row">${gradeBadge(d.latestGrade?.grade)}` +
          `<p class="stat-context">${gradeContext(d)}</p></div>` +
        (latest ? `<p class="stat-context grade-type">Latest inspection type: ${latest.types.map(typeLabel).join(", ") || "Not listed"}</p>` : "") +
      `</div>` +
      `<div class="stat-card">` +
        `<p class="stat-label">Score at the latest inspection</p>` +
        (latest
          ? `<p class="stat-value">${latest.score == null ? "—" : count(latest.score)}<span class="stat-unit">${latest.score == null ? "" : " points"}</span></p>` +
            `<p class="stat-context">${latestScoreContext(latest)}</p>`
          : `<p class="stat-value">—</p><p class="stat-context">Not yet inspected.</p>`) +
      `</div>` +
    `</div>`;

  // Above the grade, which can be from before the closure.
  const closed = d.closedOn
    ? `<aside class="callout callout-closed" role="note"><strong>Closed by the Health Department.</strong> ` +
      `Its inspection on ${date(d.closedOn)} closed it. The Health Department closes a restaurant when it finds a ` +
      `public health hazard that can't be fixed right away, and it stays closed until it passes a reopening inspection. ` +
      `A reopening can take a few days to show up here.</aside>`
    : "";

  if (!latest) {
    return head + closed + stats +
      `<aside class="callout callout-good" role="note"><strong>Not yet inspected.</strong> This is a new establishment. ` +
      `Its first inspection, score and grade will show up here once the Health Department visits.</aside>`;
  }

  const caveat =
    `<aside class="callout callout-heads-up" role="note"><strong>Heads up:</strong> A grade and score reflect one inspection ` +
    `on one day. Restaurants can and do improve (or slip) between visits.</aside>`;

  const latestBlock =
    `<section class="rest-block" aria-labelledby="latest-title">` +
      `<h3 class="chart-title" id="latest-title">Violations at the latest inspection</h3>` +
      newerUnscoredNote(d) +
      latestViolationsHtml(latest) +
    `</section>`;

  const toggle = similarOk
    ? `<div class="toggle" role="group" aria-label="Compare with">` +
        `<button type="button" class="toggle-btn" data-benchmark="citywide" aria-pressed="${shown === "citywide"}">Citywide</button>` +
        `<button type="button" class="toggle-btn" data-benchmark="similar" aria-pressed="${shown === "similar"}">Similar restaurants</button>` +
      `</div>`
    : "";
  const similarNote = similarOk ? "" :
    `<p class="chart-hint">Comparing with similar restaurants needs at least ${cmp.similar.minRestaurants} ` +
    `${escape(cmp.similar.cuisine || "restaurants of this cuisine")} in ${escape(cmp.similar.boro)} inspected in this window; ` +
    `there ${cmp.similar.restaurants === 1 ? "was" : "were"} ${count(cmp.similar.restaurants)}, so this shows the citywide average only.</p>`;

  // What matters up top; how it's worked out sits behind "How we compare".
  const categories =
    `<section class="rest-block chart-frame" aria-labelledby="cats-title" data-categories>` +
      `<div class="chart-head">` +
        `<div><h3 class="chart-title" id="cats-title">Problem areas</h3>` +
        `<p class="chart-subtitle">Violations found here at ${MIN_REPEAT_INSPECTIONS}+ inspections, at least 2× as often as elsewhere.</p></div>` +
        toggle +
      `</div>` +
      `<div data-cat-list>${categoryListHtml(cmp, shown)}</div>` +
      `<details class="cat-more">` +
        `<summary>How we compare</summary>` +
        `<p class="cat-scope" data-cat-note aria-live="polite">${benchmarkNote(cmp, shown)}</p>` +
        `<ul class="cat-facts">` +
          `<li>Counts every violation cited since ${date(cmp.since)} (the last ${cmp.years} years), critical or not. It isn't a safety rating.</li>` +
          `<li>Counts are divided by the number of inspections, so a restaurant that's inspected more often doesn't look worse just for that.</li>` +
          `<li>A kind of violation has to show up at ${MIN_REPEAT_INSPECTIONS} or more separate inspections, so one bad day isn't a pattern.</li>` +
        `</ul>` +
        similarNote +
      `</details>` +
    `</section>`;

  return head + closed + stats + caveat + latestBlock + historyHtml(d.history) + categories;
}
