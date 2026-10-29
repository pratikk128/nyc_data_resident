/*
 * HTML for Shop Diverse NYC: filter options, summary chips, result cards and
 * the business detail. Shared by the page (which renders the first view on
 * the server) and its script (every later view).
 * Data shapes come from filter.js (search) and src/lib/server/shop-diverse.js
 * (detail). Empty fields are left out, never shown as blanks.
 */
import { CERTS, CERT_ORDER, DATASET_URL, LINKS } from "./config.js";
import { count, money, date } from "../format.js";

export const escape = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const UPSTREAM_TEXT = "We couldn’t reach NYC Open Data just now. Please try again in a minute.";
export const LOADING_TEXT = "Loading businesses…";
// The detail panel's name until a business heading is in it
export const DETAIL_LABEL = "Business details";
export const ZIP_ERROR = "Enter a 5-digit ZIP code, like 11216.";
export const NOT_FOUND_TEXT = "This business is no longer on the list. It may have left since the link was shared.";

// The ZIP only moves businesses up in the Recommended order.
export const zipHint = (sort) => sort === "recommended"
  ? "Businesses in this ZIP, then its borough, come first."
  : "Applies to the Recommended order only. Switch Sort by to Recommended to use it.";

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

// ---------- Badges ----------

export function certBadges(certs, { long = false } = {}) {
  return (certs ?? []).filter((c) => CERTS[c]).map((c) => {
    const info = CERTS[c];
    const text = long ? `${escape(info.long)} (${c})` : escape(info.label);
    return `<span class="sd-badge" data-tone="${info.tone}" title="${escape(info.long)}">${text}</span>`;
  }).join("");
}

const BOROUGH_BULLETS = { Manhattan: "M", Brooklyn: "Bk", Queens: "Q", Bronx: "Bx", "Staten Island": "SI" };

// Generic borough bullet (not an MTA mark) + the place name.
function placeHtml(place) {
  if (!place) return "";
  const bullet = BOROUGH_BULLETS[place];
  return `<span class="sd-place">${bullet ? `<span class="sd-boro-bullet" aria-hidden="true">${bullet}</span>` : ""}${escape(place)}</span>`;
}

// ---------- Filters ----------

const option = (value, label, selected) =>
  `<option value="${escape(value)}"${selected ? " selected" : ""}>${escape(label)}</option>`;

// Options with a count; empty ones are hidden, but the selected one always
// stays so the select never silently changes.
export function categoryOptionsHtml(rows, selected, anyLabel) {
  const shown = rows.filter((r) => r.count > 0 || r.label === selected);
  if (selected && !shown.some((r) => r.label === selected)) shown.unshift({ label: selected, count: 0 });
  return option("", anyLabel, !selected) + shown.map((r) => option(r.label, `${r.label} (${count(r.count)})`, r.label === selected)).join("");
}

export function boroughOptionsHtml(rows, selected) {
  return option("", "Anywhere", !selected) +
    rows.filter((r) => r.count > 0 || r.slug === selected)
      .map((r) => option(r.slug, `${r.label} (${count(r.count)})`, r.slug === selected)).join("");
}

export function ethnicityChipsHtml(rows, selected) {
  return rows.map((r) => `
    <label class="pay-chip sd-eth-chip">
      <input type="checkbox" name="eth" value="${escape(r.slug)}"${selected.includes(r.label) ? " checked" : ""}${r.count || selected.includes(r.label) ? "" : " disabled"}>
      ${escape(r.label)} <span class="sd-count">${count(r.count)}</span>
    </label>`).join("");
}

// Removable chips for activeFilters() (page-state.js), as links so they work
// without script. hrefFor(query) → URL. Empty when no filter is on.
export function activeFiltersHtml(filters, hrefFor, clearHref) {
  if (!filters.length) return "";
  const x = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
  const chips = filters.map((f, i) =>
    `<li><a class="sd-active-chip" href="${escape(hrefFor(f.query))}" data-remove="${i}"><span class="sr-only">Remove filter: </span>${escape(f.label)}${x}</a></li>`).join("");
  return `<ul class="sd-active-list" aria-label="Active filters">${chips}</ul>` +
    (filters.length > 1 ? `<a class="sd-clear" href="${escape(clearHref)}" data-clear>Clear all</a>` : "");
}

// ---------- Summary ----------

// The chips that say something the filters don't: "both" only when neither
// or both certifications are picked (with one, it repeats the other chip),
// and "outside NYC" only when no borough is picked.
export function kpisHtml(k, query) {
  const chip = (value, label, tone) =>
    `<li class="sd-kpi"${tone ? ` data-tone="${tone}"` : ""}><span class="sd-kpi-value">${value}</span> <span class="sd-kpi-label">${label}</span></li>`;
  return [
    chip(count(k.total), k.total === 1 ? "business" : "businesses"),
    chip(count(k.wbe), "women-owned", CERTS.WBE.tone),
    chip(count(k.mbe), "minority-owned", CERTS.MBE.tone),
    query.who.length !== 1 ? chip(count(k.both), "both") : "",
    k.outside && !query.boro ? chip(count(k.outside), "outside NYC") : ""
  ].join("");
}

// "312 businesses · page 2 of 13"
export function statusText(data) {
  if (!data.total) return "No matches.";
  const pages = data.pages > 1 ? ` · page ${count(data.page)} of ${count(data.pages)}` : "";
  return `${plural(data.total, "business", "businesses")}${pages}`;
}

// The button that closes the filter drawer on phones
export const showResultsLabel = (total) => (total ? `Show ${plural(total, "business", "businesses")}` : "Close filters");

// ---------- Results ----------

export function cardsHtml(results, hrefFor) {
  return results.map((r) => `
    <li>
      <a class="sd-card" href="${escape(hrefFor(r.id))}" data-id="${escape(r.id)}">
        <span class="sd-card-badges">${certBadges(r.certs)}${r.lapsed ? `<span class="sd-badge sd-badge-lapsed">Renewal date passed</span>` : ""}</span>
        <span class="sd-card-name">${escape(r.name)}</span>
        ${r.category ? `<span class="sd-card-category">${escape(r.category)}</span>` : ""}
        ${r.excerpt ? `<span class="sd-card-excerpt">${escape(r.excerpt)}</span>` : ""}
        ${placeHtml(r.place)}
      </a>
    </li>`).join("");
}

export function skeletonCards(n = 6) {
  return Array.from({ length: n }, () =>
    `<li aria-hidden="true"><span class="sd-card is-skeleton"><span class="sk-line sk-short"></span><span class="sk-line"></span><span class="sk-line"></span></span></li>`
  ).join("");
}

// Links, so paging works without script and in a new tab. hrefFor(page) → URL.
export function pagerHtml(data, hrefFor) {
  if (data.pages <= 1) return "";
  const link = (page, label, rel) => page < 1 || page > data.pages
    ? `<span class="pager-btn" aria-disabled="true">${label}</span>`
    : `<a class="pager-btn" href="${escape(hrefFor(page))}" data-page="${page}" rel="${rel}">${label}</a>`;
  return `${link(data.page - 1, "Previous", "prev")}<span class="sd-pager-text">Page ${count(data.page)} of ${count(data.pages)}</span>${link(data.page + 1, "Next", "next")}`;
}

// ---------- Detail ----------

export function addressLines(v) {
  const street = [v.address1, v.address2].filter(Boolean).join(", ");
  const place = [v.city, [v.state, v.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, place].filter(Boolean);
}

export function mapsUrl(v) {
  const lines = addressLines(v);
  if (!v.address1 || lines.length < 2) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lines.join(", "))}`;
}

// What "Copy contact info" puts on the clipboard.
export function contactText(v) {
  return [
    v.dba || v.name,
    v.dba ? `Legal name: ${v.name}` : "",
    v.contact ? `Contact: ${v.contact}` : "",
    v.phone?.display ?? "",
    v.website ?? "",
    ...addressLines(v)
  ].filter(Boolean).join("\n");
}

const row = (label, valueHtml) => (valueHtml ? `<div class="sd-dl-row"><dt>${label}</dt><dd>${valueHtml}</dd></div>` : "");
const dl = (rows) => (rows.join("") ? `<dl class="sd-dl">${rows.join("")}</dl>` : "");
const block = (title, body) => (body ? `<section class="sd-detail-block"><h3>${title}</h3>${body}</section>` : "");

const paragraphs = (textValue) =>
  String(textValue ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");

const exactMoney = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const moneyHtml = (n) => `<span title="${exactMoney(n)}">${money(n)}</span>`;

function certificationBlock(v) {
  const certs = CERT_ORDER.filter((c) => v.certs?.includes(c));
  if (!certs.length) return "";
  const dates = v.renewals ?? [];
  let renewal = "";
  if (v.status === "lapsed") {
    renewal = `<p class="callout callout-heads-up"><strong>Heads up:</strong> the renewal date on file (${date(dates[dates.length - 1])}) has passed. Check the SBS directory below to see whether this business is still certified.</p>`;
  } else if (dates.length) {
    renewal = `<p class="sd-muted">Renewal date on file: ${dates.map(date).join(", ")}</p>`;
  } else {
    // Every women-owned-only firm, and a handful of others
    renewal = `<p class="sd-muted">No renewal date on file. SBS doesn’t publish one for women-owned-only certifications, so check the SBS directory below to confirm this one is current.</p>`;
  }
  const ethnicity = v.certs?.includes("MBE") && v.ethnicity && v.ethnicity !== "Non-minority"
    ? `<p class="sd-muted">Owner ethnicity (as listed by SBS): ${escape(v.ethnicity)}</p>` : "";
  return `<div class="sd-detail-badges">${certBadges(certs, { long: true })}</div>${renewal}${ethnicity}`;
}

function industryBlock(v) {
  const title = v.title ? `${escape(v.title)}${v.naics ? ` <span class="sd-code">NAICS ${escape(v.naics)}</span>` : ""}` : "";
  return dl([
    row("Industry", title),
    row("Subcategory", v.subsector && v.subsector !== v.title ? escape(v.subsector) : ""),
    row("Category", escape(v.sector ?? "")),
    row("Commodity codes", v.nigp?.length ? `${v.nigp.map(escape).join(", ")} <span class="sd-muted">(NIGP)</span>` : "")
  ]);
}

function jobsHtml(jobs) {
  if (!jobs?.length) return "";
  return `<ul class="sd-jobs">${jobs.map((j) => {
    const meta = [j.value ? moneyHtml(j.value) : "", j.date ? date(j.date) : "", j.selfPerformed ? `${j.selfPerformed}% done in-house` : ""].filter(Boolean).join(" · ");
    return `<li><strong>${escape(j.client)}</strong>${meta ? `<span class="sd-muted"> · ${meta}</span>` : ""}${j.description ? `<br>${escape(j.description)}` : ""}</li>`;
  }).join("")}</ul>`;
}

function capacityBlock(v) {
  return dl([
    row("Bonding limit", v.bonding ? moneyHtml(v.bonding) : ""),
    row("Largest contract", v.largestContract ? moneyHtml(v.largestContract) : ""),
    row("Union contracts", escape(v.union ?? "")),
    row("PASSPort", v.passport ? "Enrolled in PASSPort, the City’s procurement portal" : ""),
    row("Past clients", jobsHtml(v.jobs))
  ]);
}

/*
 * v: businessDetail() (status and years included). The heading gets
 * id="sd-detail-title" and tabindex=-1 so the panel can focus it.
 */
// Page title and meta description for a shared ?biz= link.
export function businessMeta(v) {
  const name = v.dba || v.name;
  const certs = CERT_ORDER.filter((c) => v.certs?.includes(c)).map((c) => CERTS[c].label.toLowerCase());
  const what = [v.title || v.sector, v.borough ?? [v.city, v.state].filter(Boolean).join(", ")].filter(Boolean).join(" in ");
  const lead = `${name}${what ? `: ${what}` : ""}.${certs.length ? ` Certified ${certs.join(" and ")} by NYC Small Business Services.` : ""}`;
  const about = String(v.description ?? "").replace(/\s+/g, " ").trim();
  const description = about ? `${lead} ${about}` : lead;
  return {
    title: name,
    description: description.length > 200 ? `${description.slice(0, 199).replace(/\s+\S*$/, "")}…` : description
  };
}

export function detailHtml(v) {
  const name = v.dba || v.name;
  const lines = addressLines(v);
  const maps = mapsUrl(v);
  const contact = dl([
    row("Contact", escape(v.contact ?? "")),
    row("Phone", v.phone ? (v.phone.tel ? `<a href="tel:${escape(v.phone.tel)}">${escape(v.phone.display)}</a>` : escape(v.phone.display)) : ""),
    row("Website", v.website ? `<a href="${escape(v.website)}" target="_blank" rel="noopener noreferrer">${escape(v.website.replace(/^https?:\/\//, ""))}</a>` : ""),
    row("Address", lines.length ? `${lines.map(escape).join("<br>")}${maps ? `<br><a href="${escape(maps)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>` : ""}` : "")
  ]);
  const est = v.established
    ? `<p>Established ${date(v.established)}${v.years != null ? ` · ${v.years < 1 ? "less than a year" : plural(v.years, "year")} in business` : ""}</p>` : "";

  return `
    <header class="sd-detail-head">
      <h2 id="sd-detail-title" tabindex="-1">${escape(name)}</h2>
      ${v.dba ? `<p class="sd-muted">Legal name: ${escape(v.name)}</p>` : ""}
      ${v.title || v.sector ? `<p class="sd-detail-category">${escape(v.title || v.sector)}</p>` : ""}
    </header>
    ${block("About", paragraphs(v.description))}
    ${block("Get in touch", contact + (contact ? `<div class="sd-copy-row"><button type="button" class="near-btn" data-copy>Copy contact info</button><span class="sd-copy-status" role="status" data-copy-status></span></div>` : ""))}
    ${block("Certification", certificationBlock(v))}
    ${block("Experience", est)}
    ${block("What they’re listed under", industryBlock(v))}
    ${block("Capacity", capacityBlock(v))}
    <p class="sd-detail-verify">
      Certification status comes from NYC Small Business Services. Confirm details with the business, and check the
      <a href="${LINKS.sbsDirectory}" target="_blank" rel="noopener noreferrer">SBS Online Directory</a> to verify a certification.
      <a href="${DATASET_URL}" target="_blank" rel="noopener noreferrer">Report a data problem</a>.
    </p>`;
}
