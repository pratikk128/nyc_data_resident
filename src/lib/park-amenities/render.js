/*
 * HTML for the amenity finder's cards: the "nearest of each" strip, the
 * result list and the map popup. Browser-safe; every value from the data
 * goes through escape(). Classes are Help Near Me's (hn-*) where the pieces
 * are the same, pa-* where they aren't (dashboard.css).
 */
import { categoryOf, PARKS_URL, SEASON_CHECK } from "./config.js";
import { milesText, milesPast, seasonOf } from "./nearby.js";
import { nearestText } from "./page-state.js";
import { escape, iconSvg } from "../help-near-me/render.js";

export { escape, iconSvg };

// Google Maps directions to the amenity's point (parks have no street address to give).
export const directionsUrl = (a) => `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}`;

export function badgeHtml(category) {
  const c = categoryOf(category);
  return `<span class="hn-badge" data-tone="${c.tone}">${iconSvg(c.icon)}${escape(c.one)}</span>`;
}

// "Joyce Kilmer Park, Bronx" (the park left out when the amenity's name already says it),
// after where in the park it is when the category says ("W. 43 St between 8 Ave and 9 Ave, Manhattan").
export function placeText(a) {
  const park = a.parkName && !a.name.includes(a.parkName) ? a.parkName : null;
  return [categoryOf(a.category)?.address?.(a.details ?? {}), park, a.borough].filter(Boolean).join(", ");
}

// Its usual season on `date` (seasonOf()), then where to check today's status.
const seasonalHtml = (a, date) => {
  const s = seasonOf(a, date);
  return s
    ? `<p class="pa-seasonal" data-season="${s.state}">${escape(s.text)} ${SEASON_CHECK.before}<a href="${PARKS_URL}" target="_blank" rel="noopener">${SEASON_CHECK.link}</a>${SEASON_CHECK.after}</p>`
    : "";
};

const detailsHtml = (a) => {
  const lines = categoryOf(a.category).lines(a.details);
  return lines.length ? `<ul class="hn-tags" aria-label="Details">${lines.map((t) => `<li>${escape(t)}</li>`).join("")}</ul>` : "";
};

const directionsHtml = (a) =>
  `<a class="hn-action hn-directions" href="${escape(directionsUrl(a))}" target="_blank" rel="noopener" aria-label="Directions to ${escape(a.name)} (opens Google Maps)">Directions</a>`;

// One result in the list. a: an amenity with .miles; date: today (the season note).
// The name's label adds the distance and first detail, so a row of fountains in one park sounds different.
export function cardHtml(a, date = new Date()) {
  const place = placeText(a);
  const c = categoryOf(a.category);
  const label = [a.name, milesText(a.miles), c.address?.(a.details) ?? c.lines(a.details)[0]].filter(Boolean).join(", ");
  return (
    `<li class="hn-card" data-id="${escape(a.id)}" data-category="${escape(a.category)}">` +
      `<div class="hn-card-top">${badgeHtml(a.category)}<span class="hn-dist">${milesText(a.miles)}</span></div>` +
      `<h3 class="hn-card-title"><button type="button" class="hn-locate" data-locate="${escape(a.id)}" aria-label="${escape(label)}: show on map">${escape(a.name)}</button></h3>` +
      (place ? `<p class="hn-addr">${escape(place)}</p>` : "") +
      detailsHtml(a) +
      seasonalHtml(a, date) +
      `<div class="hn-actions">${directionsHtml(a)}</div>` +
    `</li>`
  );
}

// The map popup: the same facts, shorter.
export function popupHtml(a, date = new Date()) {
  const place = placeText(a);
  const lines = categoryOf(a.category).lines(a.details);
  return (
    `<div class="pa-popup">` +
      `<p class="pa-popup-title"><strong>${escape(a.name)}</strong></p>` +
      (place ? `<p>${escape(place)}</p>` : "") +
      (lines.length ? `<p>${lines.map(escape).join(" · ")}</p>` : "") +
      `<p><strong>${milesText(a.miles)}</strong> away (straight line)</p>` +
      seasonalHtml(a, date) +
      `<p><a href="${escape(directionsUrl(a))}" target="_blank" rel="noopener">Directions</a></p>` +
    `</div>`
  );
}

/*
 * One "nearest of each" card. n: a selectView() nearest entry. A button that
 * picks the amenity on the map (outside the radius it has a pin too, and its
 * popup has the directions); none in the data, a plain card. Out of season
 * it says so ("Closed for the season"), since it's still the nearest.
 */
export function nearestHtml(n, radius, date = new Date()) {
  const c = categoryOf(n.key);
  const t = nearestText(n, radius);
  const off = n.amenity ? seasonOf(n.amenity, date)?.short : null;
  const said = (dist) => `Nearest ${escape(c.one.toLowerCase())}: ${escape(n.amenity.name)}, ${dist}${off ? `, ${escape(off.toLowerCase())}` : ""}`;
  const inner =
    `${iconSvg(c.icon, "hn-icon pa-near-icon")}` +
    `<span class="pa-near-words"><span class="pa-near-head">${escape(t.head)} · <strong>${escape(t.dist)}</strong></span>` +
    (n.amenity ? `<span class="pa-near-name">${escape(n.amenity.name)}</span>` : "") +
    (t.note ? `<span class="pa-near-note">${escape(t.note)}</span>` : "") +
    (off ? `<span class="pa-near-note" data-season="off">${escape(off)}</span>` : "") +
    `</span>`;
  const attrs = `class="pa-near" data-tone="${c.tone}" style="--hn-pin:${c.color}"`;
  if (n.amenity) {
    const label = n.inRadius ? said(milesText(n.amenity.miles)) : `${said(milesPast(n.amenity.miles, radius))}, outside your radius`;
    return `<li><button type="button" ${attrs} data-locate="${escape(n.amenity.id)}" aria-label="${label}. Show on map">${inner}</button></li>`;
  }
  return `<li><span ${attrs}>${inner}</span></li>`;
}

export const skeletonHtml = (n = 3) =>
  Array.from({ length: n }, () => '<li class="hn-card is-skeleton" aria-hidden="true"><span class="sk-line"></span><span class="sk-line sk-short"></span></li>').join("");
