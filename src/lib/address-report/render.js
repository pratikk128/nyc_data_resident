/*
 * HTML for the address report's cards (plain strings, drawn by the page
 * script). Every value from the data goes through escape(). Each takes what
 * report.js picked, so the wording is tested without a browser.
 */
import { milesText } from "./report.js";
import { count, percent } from "../format.js";
import { blockTitle, timingText, milesText as metersText } from "../street-closures/render.js";
import { stationVerdict } from "../water/near-me.js";
import { monthLabel, STATUS_ICON } from "../water/stats.js";
import { boroughLabel as waterBorough } from "../water/config.js";
import { fullAddress, directionsUrl } from "../help-near-me/render.js";
import { TYPE_BY_SLUG, LINKS } from "../schools/config.js";
import { gradeInfo } from "../restaurants/inspections.js";
import { detailHref } from "../restaurants/render.js";

export const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const lead = (html) => `<p class="ar-lead">${html}</p>`;
const note = (html) => `<p class="ar-note">${html}</p>`;
const list = (items) => `<ul class="ar-list">${items.join("")}</ul>`;
const row = (main, side = "", sub = "") =>
  `<li><span class="ar-row-main">${main}</span>${side ? `<span class="ar-row-side">${side}</span>` : ""}` +
  `${sub ? `<span class="ar-row-sub">${sub}</span>` : ""}</li>`;

// ---------- Drinking water ----------

// station: nearestStation() (with .miles); data: /api/water/stations for it.
export function waterHtml(station, data) {
  if (!station) return lead("No active sampling station near here.");
  const details = data?.stations?.[station.site];
  const v = stationVerdict(details);
  const months = data?.months ?? [];
  const range = months.length ? `${monthLabel(months[0], "short")}–${monthLabel(months[months.length - 1], "short")}` : "";
  const where = `Station ${escape(station.site)}, ${milesText(station.miles)} away${station.borough ? ` in ${escape(waterBorough(station.borough))}` : ""}`;
  if (!v) return lead(`${where}: no routine samples in the last 12 months.`);
  return `<p class="water-card-verdict" data-status="${v.status}"><span class="water-status-icon" aria-hidden="true">${STATUS_ICON[v.status]}</span>` +
    `<span>${escape(v.text)}</span></p>` +
    note(`${where}${station.place ? ` (${escape(station.place)})` : ""}. Routine samples${range ? `, ${escape(range)}` : ""}.`);
}

// ---------- 311 ----------

// c: complaintsCard()
export function complaintsHtml(c) {
  if (!c.total) return lead("No 311 requests within ¼ mile in the last 12 months. Even the pigeons are quiet.");
  return lead(`<strong>${plural(c.total, "request")}</strong> to 311 within ¼ mile in the last 12 months. The most common:`) +
    `<ol class="ar-list ar-ranked">${c.top.map((t) => row(escape(t.label), count(t.count))).join("")}</ol>` +
    note(`${percent(c.openShare, 0)} are still open.`);
}

// ---------- Street closures ----------

// c: closuresCard()
export function closuresHtml(c) {
  if (!c.week) return lead("No street closures posted within ¼ mile this week.");
  const now = c.today ? `<strong>${plural(c.today, "block")}</strong> closed today within ¼ mile` : "Nothing closed today within ¼ mile";
  const later = c.week - c.today;
  return lead(`${now}${later ? `, and ${plural(later, "block")} later this week` : ""}.`) +
    list(c.nearest.map((b) => row(escape(blockTitle(b)), escape(metersText(b.meters)), escape(timingText(b.status, c.date)))));
}

// ---------- Help near me ----------

// sites: helpCard()
export function helpHtml(sites) {
  if (!sites.length) return lead("No city help sites within 2 miles.");
  return list(sites.map((s) => row(
    `<span class="ar-kind">${escape(s.kind)}</span> ${escape(s.name)}`,
    escape(milesText(s.miles)),
    `${escape(fullAddress(s))} · <a href="${escape(directionsUrl(s))}" target="_blank" rel="noopener">Directions</a>`
  )));
}

// ---------- Schools ----------

// schools: nearestSchools()
export function schoolsHtml(schools) {
  const zone = `Your zoned school may not be the nearest one. ` +
    `<a href="${LINKS.schoolsSearch}" target="_blank" rel="noopener">Check your zone on the DOE’s school search</a>.`;
  if (!schools.length) return lead("No public schools found near here.") + note(zone);
  return list(schools.map((s) => row(
    `<a href="${escape(s.href)}">${escape(s.name)}</a>`,
    escape(milesText(s.miles)),
    escape(TYPE_BY_SLUG[s.type]?.label ?? "")
  ))) + note(zone);
}

// ---------- Restaurants ----------

const GRADE_WORDS = [["A", "A"], ["B", "B"], ["C", "C"], ["other", "not graded yet or pending"]];

// c: restaurantsCard()
export function restaurantsHtml(c) {
  if (!c.total) return lead("No restaurants within about half a mile.");
  const mix = GRADE_WORDS.filter(([k]) => c.grades[k]).map(([k, w]) => `${count(c.grades[k])} ${w}`).join(", ");
  const head = c.more ? `The ${count(c.total)} nearest restaurants` : `${plural(c.total, "restaurant")} within about half a mile`;
  return lead(`${head}: ${mix}.`) +
    list(c.nearest.map((r) => {
      const g = gradeInfo(r.grade?.grade);
      return row(
        `<span class="ar-grade" data-tone="${g.tone}" title="${escape(g.label)}">${escape(g.short ?? "–")}</span>` +
          `<a href="${detailHref(r.camis)}">${escape(r.name)}</a>`,
        r.miles != null ? escape(milesText(r.miles)) : "",
        escape(r.cuisine)
      );
    }));
}
