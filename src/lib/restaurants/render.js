/*
 * HTML for the restaurant lookup: result cards, the detail view and the
 * violation-category bars. Shared by the page script (search results and
 * restaurants picked from them) and the server (a ?camis= deep link renders
 * the detail on the server). Data shapes come from src/lib/server/restaurants.js.
 */
import { date, count } from "../format.js";
import { gradeInfo, ratioLabel, SCORE_BANDS } from "./inspections.js";

export const escape = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
    return (
      `<li><a class="rest-card" href="${detailHref(r.camis)}" data-camis="${escape(r.camis)}">` +
        gradeBadge(r.grade?.grade, { size: "md" }) +
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

// "Cycle Inspection / Initial Inspection" → "Cycle Inspection · Initial Inspection"
function typeLabel(type) {
  return escape(type).replace(/ \/ /g, " · ");
}

function criticalViolationsHtml(latest) {
  const critical = latest.violations.filter((v) => v.critical === "Critical");
  if (!critical.length) return `<p class="insp-summary">No critical violations were cited at the latest inspection.</p>`;
  return (
    `<ul class="violations">` +
      critical.map((v) => `<li class="violation is-critical"><p class="violation-text">${escape(v.description)}</p></li>`).join("") +
    `</ul>`
  );
}

// ---------- Category bars ----------

export function categoryBarsHtml(cmp, benchmark) {
  const rows = cmp[benchmark].rows.filter((r) => r.above);
  if (!rows.length) {
    const who = benchmark === "citywide" ? "the city average" : "the average for similar restaurants";
    return `<p class="insp-summary">This restaurant's critical violations per inspection aren't above ${who} in any category.</p>`;
  }

  return `<ol class="cat-bars">` + rows.map((r) => {
    const label = ratioLabel(r, benchmark === "citywide" ? "city" : "similar");
    return (
      `<li class="cat-row is-above">` +
        `<div class="cat-head">` +
          `<span class="cat-name">${escape(r.label)}</span>` +
          `<span class="cat-flag"><span aria-hidden="true">▲ </span>${escape(label)}</span>` +
        `</div>` +
        `<p class="cat-blurb">${escape(r.blurb)}</p>` +
      `</li>`
    );
  }).join("") + `</ol>`;
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

export function detailHtml(d, { benchmark = "citywide" } = {}) {
  const latest = d.latest;
  const cmp = d.categories;
  const similarOk = Boolean(cmp.similar.rows);
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

  if (!latest) {
    return head + stats +
      `<aside class="callout callout-good" role="note"><strong>Not yet inspected.</strong> This is a new establishment. ` +
      `Its first inspection, score and grade will show up here once the Health Department visits.</aside>`;
  }

  const caveat =
    `<aside class="callout callout-heads-up" role="note"><strong>Heads up:</strong> A grade and score reflect one inspection ` +
    `on one day. Restaurants can and do improve (or slip) between visits.</aside>`;

  const latestBlock =
    `<section class="rest-block" aria-labelledby="latest-title">` +
      `<h3 class="chart-title" id="latest-title">Critical violations at the latest inspection</h3>` +
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

  const categories =
    `<section class="rest-block chart-frame" aria-labelledby="cats-title" data-categories>` +
      `<div class="chart-head">` +
        `<div><h3 class="chart-title" id="cats-title">Violation categories worse than the rest</h3>` +
        `<p class="chart-subtitle">Critical violations cited per inspection since ${date(cmp.since)} (last ${cmp.years} years). ` +
        `Only categories where this restaurant averages more critical violations per inspection than the rest are shown.</p></div>` +
        toggle +
      `</div>` +
      similarNote +
      `<p class="cat-note"><strong>Good to know:</strong> These are critical violations inspectors cited, not a safety rating. ` +
      `Dividing by the number of inspections keeps restaurants that are inspected more often from looking worse just for that.</p>` +
      `<p class="cat-scope" data-cat-note aria-live="polite">${benchmarkNote(cmp, shown)}</p>` +
      `<div data-cat-bars>${categoryBarsHtml(cmp, shown)}</div>` +
    `</section>`;

  return head + stats + caveat + latestBlock + categories;
}
