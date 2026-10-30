/*
 * HTML for the help finder's result cards. Browser-safe; every value from
 * the data goes through escape().
 */
import { categoryOf, HOURS_MISSING, PHONE_MISSING } from "./config.js";
import { milesText } from "./distance.js";

export const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const MAX_TAGS = 5;

export const iconSvg = (icon, cls = "hn-icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;

// "1910 Monterey Avenue, 5th Fl., Bronx, NY 10457"
export function fullAddress(s) {
  return [s.address, s.borough, ["NY", s.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// Google Maps directions to the site's address (its point when there's no address).
export function directionsUrl(s) {
  const to = s.address ? fullAddress(s) : `${s.lat},${s.lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(to)}`;
}

export function badgeHtml(category) {
  const c = categoryOf(category);
  return `<span class="hn-badge" data-tone="${c.tone}">${iconSvg(c.icon)}${escape(c.label)}</span>`;
}

function tagsHtml(services) {
  if (!services.length) return "";
  const shown = services.slice(0, MAX_TAGS);
  const rest = services.length - shown.length;
  return `<ul class="hn-tags" aria-label="Services">${shown.map((t) => `<li>${escape(t)}</li>`).join("")}` +
    (rest > 0 ? `<li class="hn-tag-more">+${rest} more</li>` : "") + `</ul>`;
}

// One result. s: a site, with .miles near a spot (none for a whole borough).
export function cardHtml(s) {
  const phone = s.phone
    ? `<a class="hn-action" href="tel:${escape(s.phone.tel)}" aria-label="Call ${escape(s.name)} at ${escape(s.phone.display)}">Call ${escape(s.phone.display)}</a>`
    : `<span class="hn-action is-missing">${PHONE_MISSING}</span>`;
  return (
    `<li class="hn-card" data-id="${escape(s.id)}" data-category="${escape(s.category)}">` +
      `<div class="hn-card-top">${badgeHtml(s.category)}${s.miles != null ? `<span class="hn-dist">${milesText(s.miles)}</span>` : ""}</div>` +
      `<h3 class="hn-card-title"><button type="button" class="hn-locate" data-locate="${escape(s.id)}" aria-label="${escape(s.name)}: show on map">${escape(s.name)}</button></h3>` +
      (s.closed ? `<p class="hn-closed">Temporarily closed</p>` : "") +
      `<p class="hn-addr">${escape(fullAddress(s))}</p>` +
      (s.provider && s.provider !== s.name ? `<p class="hn-provider">Run by ${escape(s.provider)}</p>` : "") +
      `<p class="hn-hours"><span class="hn-label">Hours</span> ${s.hours ? escape(s.hours) : `<span class="is-missing">${HOURS_MISSING}</span>`}</p>` +
      tagsHtml(s.services) +
      (s.note && !s.closed ? `<p class="hn-note">${escape(s.note)}</p>` : "") +
      `<div class="hn-actions">${phone}` +
        `<a class="hn-action hn-directions" href="${escape(directionsUrl(s))}" target="_blank" rel="noopener" aria-label="Directions to ${escape(s.name)} (opens Google Maps)">Directions</a>` +
      `</div>` +
    `</li>`
  );
}

export const skeletonHtml = (n = 3) =>
  Array.from({ length: n }, () => '<li class="hn-card is-skeleton" aria-hidden="true"><span class="sk-line"></span><span class="sk-line sk-short"></span></li>').join("");
