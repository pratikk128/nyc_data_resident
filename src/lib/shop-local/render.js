/*
 * HTML for Shop Local: the tile and chip counts, result cards, the pager and
 * the business detail. Shared by the page (which renders the first view on
 * the server) and its script (every later view). Data shapes come from
 * filter.js. Empty fields are left out, never shown as blanks.
 */
import { CATEGORY_BY_KEY, OWNERS } from "./config.js";
import { DATASET_URL, LINKS } from "../shop-diverse/config.js";
import { count, date } from "../format.js";
import { escape } from "../shop-diverse/render.js";

export { escape };

export const UPSTREAM_TEXT = "We couldn’t reach NYC Open Data just now. Please try again in a minute.";
export const LOADING_TEXT = "Finding businesses…";
export const DETAIL_LABEL = "Business details";
export const ZIP_ERROR = "Enter a 5-digit NYC ZIP code, like 11216.";
export const NOT_FOUND_TEXT = "This business isn’t on the list anymore. It may have left since the link was shared.";

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export const iconSvg = (cat, size = 20) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CATEGORY_BY_KEY[cat]?.icon ?? ""}</svg>`;

// "1.4 mi" from ZIP middle to ZIP middle; 0 is the same ZIP.
export function distanceText(miles) {
  if (miles == null) return "";
  if (miles < 0.1) return "In your ZIP";
  return `About ${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi away`;
}

export function ownerBadges(labels) {
  return (labels ?? []).map((l) => {
    const tone = OWNERS.find((o) => o.label === l)?.tone ?? "purple";
    return `<span class="sd-badge" data-tone="${tone}">${escape(l)}</span>`;
  }).join("");
}

// "38 businesses near 11216", "No matches."
export function statusText(data, query, boroLabel) {
  if (!data.total) return "No matches.";
  const where = query.near ? ` near ${query.near}` : boroLabel ? ` in ${boroLabel}` : query.outside ? "" : " in NYC";
  const pages = data.pages > 1 ? ` · page ${count(data.page)} of ${count(data.pages)}` : "";
  return `${plural(data.total, "business", "businesses")}${where}${pages}`;
}

export const mapsUrl = (street, place, zip) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([street, place, `NY ${zip ?? ""}`.trim()].filter(Boolean).join(", "))}`;

const ICONS = {
  call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  map: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'
};
const icon = (name) => `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
const ext = 'target="_blank" rel="noopener noreferrer"';

// Call, Website, Directions; the business name is in each label for screen readers.
function actionsHtml({ name, tel, website, street, place, zip }) {
  const sr = `<span class="sr-only"> ${escape(name)}</span>`;
  const links = [
    tel ? `<a class="sl-action" href="tel:${escape(tel)}">${icon("call")}Call${sr}</a>` : "",
    website ? `<a class="sl-action" href="${escape(website)}" ${ext}>${icon("web")}Website${sr}</a>` : "",
    street ? `<a class="sl-action" href="${escape(mapsUrl(street, place, zip))}" ${ext}>${icon("map")}Directions${sr}</a>` : ""
  ].filter(Boolean);
  return links.length ? `<div class="sl-actions">${links.join("")}</div>` : "";
}

// hrefFor(id) → the page URL with ?biz=
export function cardsHtml(results, hrefFor) {
  return results.map((r) => {
    const where = [r.street ? `${r.street}, ${r.place}` : r.place, distanceText(r.miles)].filter(Boolean).join(" · ");
    return `
    <li class="sl-card" data-tone="${escape(CATEGORY_BY_KEY[r.cat]?.tone ?? "blue")}">
      <p class="sl-kind">${iconSvg(r.cat, 16)}${escape(r.kind)}</p>
      <h3 class="sl-card-name"><a href="${escape(hrefFor(r.id))}" data-id="${escape(r.id)}">${escape(r.name)}</a></h3>
      ${r.owners?.length ? `<p class="sl-owners">${ownerBadges(r.owners)}</p>` : ""}
      ${where ? `<p class="sl-place">${escape(where)}</p>` : ""}
      ${r.excerpt ? `<p class="sl-excerpt">${escape(r.excerpt)}</p>` : ""}
      ${actionsHtml(r)}
      ${r.since ? `<p class="sl-since">Since ${escape(r.since)}</p>` : ""}
    </li>`;
  }).join("");
}

export function skeletonCards(n = 6) {
  return Array.from({ length: n }, () =>
    `<li class="sl-card is-skeleton" aria-hidden="true"><span class="sk-line sk-short"></span><span class="sk-line"></span><span class="sk-line"></span></li>`
  ).join("");
}

// Links, so paging works without script. hrefFor(page) → URL.
export function pagerHtml(data, hrefFor) {
  if (data.pages <= 1) return "";
  const link = (page, label, rel) => page < 1 || page > data.pages
    ? `<span class="pager-btn" aria-disabled="true">${label}</span>`
    : `<a class="pager-btn" href="${escape(hrefFor(page))}" data-page="${page}" rel="${rel}">${label}</a>`;
  return `${link(data.page - 1, "Previous", "prev")}<span class="sd-pager-text">Page ${count(data.page)} of ${count(data.pages)}</span>${link(data.page + 1, "Next", "next")}`;
}

// ---------- Detail ----------

const paragraphs = (text) =>
  String(text ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");

const row = (label, html) => (html ? `<div class="sd-dl-row"><dt>${label}</dt><dd>${html}</dd></div>` : "");

// Page title and link preview for a shared ?biz= link.
export function businessMeta(d) {
  const lead = `${d.name}: ${d.kind.toLowerCase()} in ${d.place}.${d.owners.length ? ` ${d.owners.join(", ")}, certified by NYC Small Business Services.` : ""}`;
  const about = String(d.description ?? "").replace(/\s+/g, " ").trim();
  const text = about ? `${lead} ${about}` : lead;
  return { title: d.name, description: text.length > 200 ? `${text.slice(0, 199).replace(/\s+\S*$/, "")}…` : text };
}

/*
 * d: localDetail() (filter.js). The heading gets id="sl-detail-title" and
 * tabindex=-1 so the panel can focus it.
 */
export function detailHtml(d) {
  const where = d.street
    ? `${escape(d.street)}<br>${escape(d.place)}${d.zip ? `, NY ${escape(d.zip)}` : ""}`
    : `${escape(d.place)}${d.zip ? ` (ZIP ${escape(d.zip)})` : ""}<br><span class="sd-muted">Works by appointment or comes to you. Call or check the website for where.</span>`;
  const cert = d.renewal
    ? `Certified by NYC Small Business Services, with a renewal date of ${date(d.renewal)}.`
    : "Certified by NYC Small Business Services.";
  return `
    <header class="sd-detail-head">
      <p class="sl-kind" data-tone="${escape(CATEGORY_BY_KEY[d.cat]?.tone ?? "blue")}">${iconSvg(d.cat, 16)}${escape(d.kind)}</p>
      <h2 id="sl-detail-title" tabindex="-1">${escape(d.name)}</h2>
      ${d.owners.length ? `<p class="sl-owners">${ownerBadges(d.owners)}</p>` : ""}
    </header>
    ${actionsHtml({ ...d, tel: d.phone?.tel })}
    ${d.description ? `<section class="sd-detail-block"><h3>About</h3>${paragraphs(d.description)}</section>` : ""}
    <section class="sd-detail-block">
      <h3>Get in touch</h3>
      <dl class="sd-dl">
        ${row("Phone", d.phone ? (d.phone.tel ? `<a href="tel:${escape(d.phone.tel)}">${escape(d.phone.display)}</a>` : escape(d.phone.display)) : "")}
        ${row("Website", d.website ? `<a href="${escape(d.website)}" ${ext}>${escape(d.website.replace(/^https?:\/\//, ""))}</a>` : "")}
        ${row(d.street ? "Address" : "Area", where)}
        ${row("In business", d.since ? `Since ${escape(d.since)}${d.years >= 1 ? ` (${plural(d.years, "year")})` : ""}` : "")}
      </dl>
    </section>
    <section class="sd-detail-block">
      <h3>Certification</h3>
      <p>${cert} Certification checks who owns and runs the business. It isn’t a review of the work.</p>
      ${d.legalName ? `<p class="sd-muted">Legal name: ${escape(d.legalName)}</p>` : ""}
    </section>
    <p class="sd-detail-verify">
      We don’t have hours. Call or check the website before you go. Something wrong?
      <a href="${DATASET_URL}" ${ext}>Report it to NYC Open Data</a>, or check the
      <a href="${LINKS.sbsDirectory}" ${ext}>SBS directory</a>.
    </p>`;
}
