/*
 * HTML for the restaurant lookup: result cards, the detail view and the
 * violation-category list. Shared by the page script (search results and
 * restaurants picked from them) and the server (a ?camis= deep link renders
 * the detail on the server). Data shapes come from src/lib/server/restaurants.js.
 */
import { date, count } from "../format.js";
import { gradeInfo, SCORE_BANDS, MIN_REPEAT_INSPECTIONS } from "./inspections.js";

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
          `<span class="rest-card-place">${escape(placeLine(r))}</span>` +
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
    return named
      ? `More restaurants match than we can show, so here are the first ${n}. Add a borough or ZIP code to narrow it down.`
      : `More restaurants ${near ? "are nearby" : "match"} than we can show, so here are the first ${n}. Type a name to narrow it down.`;
  }
  return `${n} ${n === 1 ? "restaurant matches" : "restaurants match"}${near ? " within about half a mile" : ""}.`;
}

// "Cycle Inspection / Initial Inspection" → "Cycle Inspection · Initial Inspection"
function typeLabel(type) {
  return escape(type).replace(/ \/ /g, " · ");
}

function violationItemHtml(v) {
  const critical = v.critical === "Critical";
  return `<li class="violation${critical ? " is-critical" : ""}">` +
    (critical ? "" : `<p class="violation-flag">Not critical</p>`) +
    `<p class="violation-text">${escape(v.description)}</p></li>`;
}

function criticalViolationsHtml(latest) {
  const critical = latest.violations.filter((v) => v.critical === "Critical");
  const list = critical.length
    ? `<ul class="violations">${critical.map(violationItemHtml).join("")}</ul>`
    : `<p class="insp-summary">No critical violations were cited at the latest inspection.</p>`;
  // Everything else cited that day, behind a toggle (violations are sorted critical first).
  const all = latest.violations.length > critical.length
    ? `<details class="cat-more all-violations"><summary>Show all ${count(latest.violations.length)} ` +
      `${latest.violations.length === 1 ? "violation" : "violations"}</summary>` +
      `<ul class="violations">${latest.violations.map(violationItemHtml).join("")}</ul></details>`
    : "";
  return list + all;
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

  return `<ol class="cat-list">` + rows.map((r) => (
    `<li class="cat-row is-above">` +
      `<div class="cat-head">` +
        `<span class="cat-name">${escape(r.label)}</span>` +
      `</div>` +
      `<p class="cat-blurb">${escape(r.blurb)}</p>` +
    `</li>`
  )).join("") + `</ol>`;
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
      criticalViolationsHtml(latest) +
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
        `<p class="chart-subtitle">Kinds of violations inspectors keep finding here: cited at ${MIN_REPEAT_INSPECTIONS} or more ` +
        `inspections, and at least twice as often as at other restaurants.</p></div>` +
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

  return head + closed + stats + caveat + latestBlock + categories;
}
