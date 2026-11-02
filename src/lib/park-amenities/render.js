/*
 * HTML for the amenity finder's cards: the "nearest of each" strip, the
 * result list and the map popup. Browser-safe; every value from the data
 * goes through escape(). Classes are Help Near Me's (hn-*) where the pieces
 * are the same, pa-* where they aren't (dashboard.css).
 */
import { categoryOf, PARKS_URL, SEASONAL } from "./config.js";
import { milesText } from "./nearby.js";
import { nearestText } from "./page-state.js";
import { escape, iconSvg } from "../help-near-me/render.js";

export { escape, iconSvg };

// Google Maps directions to the amenity's point (parks have no street address to give).
export const directionsUrl = (a) => `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}`;

export function badgeHtml(category) {
  const c = categoryOf(category);
  return `<span class="hn-badge" data-tone="${c.tone}">${iconSvg(c.icon)}${escape(c.one)}</span>`;
}

// "Joyce Kilmer Park, Bronx" (the park left out when it's the amenity's own name).
export function placeText(a) {
  const park = a.parkName && a.parkName !== a.name ? a.parkName : null;
  return [park, a.borough].filter(Boolean).join(", ");
}

const seasonalHtml = (a) =>
  categoryOf(a.category).seasonal(a.details)
    ? `<p class="pa-seasonal">${SEASONAL.before}<a href="${PARKS_URL}" target="_blank" rel="noopener">${SEASONAL.link}</a>${SEASONAL.after}</p>`
    : "";

const detailsHtml = (a) => {
  const lines = categoryOf(a.category).lines(a.details);
  return lines.length ? `<ul class="hn-tags" aria-label="Details">${lines.map((t) => `<li>${escape(t)}</li>`).join("")}</ul>` : "";
};

const directionsHtml = (a) =>
  `<a class="hn-action hn-directions" href="${escape(directionsUrl(a))}" target="_blank" rel="noopener" aria-label="Directions to ${escape(a.name)} (opens Google Maps)">Directions</a>`;

// One result in the list. a: an amenity with .miles.
export function cardHtml(a) {
  const place = placeText(a);
  return (
    `<li class="hn-card" data-id="${escape(a.id)}" data-category="${escape(a.category)}">` +
      `<div class="hn-card-top">${badgeHtml(a.category)}<span class="hn-dist">${milesText(a.miles)}</span></div>` +
      `<h3 class="hn-card-title"><button type="button" class="hn-locate" data-locate="${escape(a.id)}" aria-label="${escape(a.name)}: show on map">${escape(a.name)}</button></h3>` +
      (place ? `<p class="hn-addr">${escape(place)}</p>` : "") +
      detailsHtml(a) +
      seasonalHtml(a) +
      `<div class="hn-actions">${directionsHtml(a)}</div>` +
    `</li>`
  );
}

// The map popup: the same facts, shorter.
export function popupHtml(a) {
  const place = placeText(a);
  const lines = categoryOf(a.category).lines(a.details);
  return (
    `<div class="pa-popup">` +
      `<p class="pa-popup-title"><strong>${escape(a.name)}</strong></p>` +
      (place ? `<p>${escape(place)}</p>` : "") +
      (lines.length ? `<p>${lines.map(escape).join(" · ")}</p>` : "") +
      `<p><strong>${milesText(a.miles)}</strong> away (straight line)</p>` +
      seasonalHtml(a) +
      `<p><a href="${escape(directionsUrl(a))}" target="_blank" rel="noopener">Directions</a></p>` +
    `</div>`
  );
}

/*
 * One "nearest of each" card. n: a selectView() nearest entry. In the radius
 * it's a button that picks the amenity; outside it, the distance and its
 * directions; none in the data, a plain card.
 */
export function nearestHtml(n, radius) {
  const c = categoryOf(n.key);
  const t = nearestText(n, radius);
  const inner =
    `${iconSvg(c.icon, "hn-icon pa-near-icon")}` +
    `<span class="pa-near-words"><span class="pa-near-head">${escape(t.head)} · <strong>${escape(t.dist)}</strong></span>` +
    (n.amenity ? `<span class="pa-near-name">${escape(n.amenity.name)}</span>` : "") +
    (t.note ? `<span class="pa-near-note">${escape(t.note)}</span>` : "") +
    `</span>`;
  const attrs = `class="pa-near" data-tone="${c.tone}" style="--hn-pin:${c.color}"`;
  if (n.amenity && n.inRadius) {
    return `<li><button type="button" ${attrs} data-locate="${escape(n.amenity.id)}" aria-label="Nearest ${escape(c.one.toLowerCase())}: ${escape(n.amenity.name)}, ${milesText(n.amenity.miles)}. Show on map">${inner}</button></li>`;
  }
  if (n.amenity) {
    return `<li><a ${attrs} href="${escape(directionsUrl(n.amenity))}" target="_blank" rel="noopener" aria-label="Nearest ${escape(c.one.toLowerCase())}: ${escape(n.amenity.name)}, ${milesText(n.amenity.miles)}, outside your radius. Directions (opens Google Maps)">${inner}</a></li>`;
  }
  return `<li><span ${attrs}>${inner}</span></li>`;
}

export const skeletonHtml = (n = 3) =>
  Array.from({ length: n }, () => '<li class="hn-card is-skeleton" aria-hidden="true"><span class="sk-line"></span><span class="sk-line sk-short"></span></li>').join("");
