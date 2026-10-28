/*
 * HTML for "Leads by service type": the flip cards and the empty state.
 * Used by the page script (src/components/restaurant-inspections/LeadsSection.astro);
 * lead shapes come from rankLeads() in leads.js.
 *
 * Each card has two faces. The front is one button (Enter/Space flips it);
 * the back has the contact links and the violation list, plus a button to
 * flip back. The script makes the face that's out of view inert.
 */
import { date, count } from "../format.js";
import { gradeInfo } from "./inspections.js";
import { escape, detailHref } from "./render.js";
import { TIER_LABELS, formatPhone, mapUrl } from "./leads.js";
import { LEADS_CONFIG } from "./business-groups.js";

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export function tierBadge(tier) {
  return `<span class="lead-tier" data-tier="${tier}">${TIER_LABELS[tier]}</span>`;
}

function scoreLine(latest) {
  if (latest?.score == null) return "No score yet";
  const grade = gradeInfo(latest.grade);
  return `Score <strong>${latest.score}</strong> · ${escape(grade.short ? `Grade ${grade.short}` : grade.label)}`;
}

function violationItems(violations, descriptions) {
  return violations.map((v) =>
    `<li class="lead-violation">` +
      `<span class="lead-violation-head"><span class="lead-code">${escape(v.code)}</span>` +
      `<time datetime="${v.date}">${date(v.date)}</time>` +
      (v.critical ? "" : `<span class="lead-not-critical">not critical</span>`) + `</span>` +
      `<span class="lead-violation-text">${escape(descriptions[v.code] ?? "")}</span>` +
    `</li>`
  ).join("");
}

// group: a BUSINESS_GROUPS entry. descriptions: { code: text } from the API.
export function leadCardHtml(lead, group, descriptions) {
  const id = `lead-${escape(lead.camis)}`;
  const place = [lead.boro, lead.zipcode].filter(Boolean).join(" · ");
  const fullAddress = [lead.address, [lead.boro, "NY", lead.zipcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const phone = formatPhone(lead.phone);
  const latest = lead.latest;
  const what = `${group.short} ${lead.groupViolationCount === 1 ? "violation" : "violations"}`;

  return (
    `<li class="lead-card" data-tier="${lead.tier}" data-camis="${escape(lead.camis)}">` +
    `<div class="lead-inner">` +
      // ---------- Front ----------
      `<button type="button" class="lead-face lead-front" aria-expanded="false" aria-controls="${id}-back" data-flip>` +
        `<span class="lead-top"><span class="lead-rank">#${lead.rank}</span>${tierBadge(lead.tier)}</span>` +
        `<span class="lead-name">${escape(lead.name)}</span>` +
        `<span class="lead-place">${escape(place)}</span>` +
        (lead.cuisine ? `<span class="lead-cuisine">${escape(lead.cuisine)}</span>` : "") +
        `<span class="lead-count"><span class="lead-count-n">${count(lead.groupViolationCount)}</span>` +
          `<span class="lead-count-label">${escape(what)}` +
          (lead.inspectionsAffected > 1 ? ` over ${lead.inspectionsAffected} inspections` : "") + `</span></span>` +
        `<span class="lead-score">${scoreLine(latest)}</span>` +
        `<span class="lead-flip-hint">Details and contact<span aria-hidden="true"> ↻</span></span>` +
      `</button>` +
      // ---------- Back ----------
      `<div class="lead-face lead-back" id="${id}-back" role="group" aria-label="${escape(lead.name)}, details" inert>` +
        `<div class="lead-back-head">` +
          `<p class="lead-back-name">${escape(lead.name)}</p>` +
          `<button type="button" class="lead-unflip" data-unflip>Flip back<span aria-hidden="true"> ↺</span></button>` +
        `</div>` +
        `<p class="lead-address">${escape(fullAddress)}</p>` +
        `<p class="lead-links">` +
          (phone ? `<a href="tel:+1${escape(lead.phone.slice(-10))}">${escape(phone)}</a>` : `<span class="lead-muted">No phone listed</span>`) +
          `<a href="${escape(mapUrl(lead))}" target="_blank" rel="noopener">Map<span class="sr-only"> (opens Google Maps)</span></a>` +
          `<a href="${detailHref(lead.camis)}">Full record</a>` +
        `</p>` +
        (latest ? `<p class="lead-latest">Latest inspection <time datetime="${latest.date}">${date(latest.date)}</time>` +
          (latest.type ? `, ${escape(latest.type)}` : "") + `</p>` : "") +
        `<p class="lead-list-title">${escape(group.label)}: ${plural(lead.groupViolationCount, "violation")}</p>` +
        `<ul class="lead-violations">${violationItems(lead.violations, descriptions)}</ul>` +
        (lead.other.length
          ? `<details class="lead-other"><summary>Other critical violations (${lead.other.length})</summary>` +
            `<ul class="lead-violations">${violationItems(lead.other, descriptions)}</ul></details>`
          : "") +
      `</div>` +
    `</div>` +
    `</li>`
  );
}

export function skeletonCardsHtml(n = 6) {
  return Array.from({ length: n }, () =>
    '<li class="lead-card is-skeleton" aria-hidden="true"><div class="lead-inner"><div class="lead-face">' +
    '<span class="sk-line sk-short"></span><span class="sk-line"></span><span class="sk-line sk-short"></span>' +
    '<span class="sk-block"></span></div></div></li>'
  ).join("");
}

// days: the window. filtered: borough, search, "urgent only" or "hide low scores" is on.
export function emptyStateText(group, days, { filtered = false } = {}) {
  const longest = Math.max(...LEADS_CONFIG.windows);
  if (filtered) return "No restaurants match these filters. Try all boroughs, clear the search or turn off “Urgent only” or “Hide low scores.”";
  if (days < longest) return `No critical ${group.short} violations in the last ${days} days. Try ${longest} days.`;
  return `No critical ${group.short} violations in the last ${days} days. Even the inspectors are surprised.`;
}
