/*
 * HTML for the address report (plain strings, drawn by the page script).
 * Every value from the data goes through escape(). Each takes what report.js
 * picked, so the wording is tested without a browser.
 *
 * Each topic has two parts: *Glance() is its one line in the "At a glance"
 * strip, { tone, text } (plain text; tone is good, warn, bad or info), and
 * *Html() is its section's body.
 */
import { milesText } from "./report.js";
import { count, percent } from "../format.js";
import { ratioText } from "../complaints311/stats.js";
import { blockTitle, timingText, milesText as metersText } from "../street-closures/render.js";
import { stationVerdict } from "../water/near-me.js";
import { monthLabel, isStale, STATUS_ICON, STATUS_TEXT } from "../water/stats.js";
import { boroughLabel as waterBorough } from "../water/config.js";
import { fullAddress, directionsUrl } from "../help-near-me/render.js";
import { TYPE_BY_SLUG, LINKS } from "../schools/config.js";
import { gradeInfo } from "../restaurants/inspections.js";
import { detailHref } from "../restaurants/render.js";
import { flagsTakeaway, violationsTakeaway, complaintsTakeaway, dobTakeaway, isEmptyHpd } from "../building-report/render.js";
import { lotName } from "../building-report/summarize.js";
import { daysCovered, howOften, pct } from "../crashes/hotspot-view.js";
import { categoryOf as parkKind } from "../park-amenities/config.js";
import { seasonOf } from "../park-amenities/nearby.js";
import { placeText, directionsUrl as parkDirections } from "../park-amenities/render.js";
import { PARKS_ONLY } from "../park-amenities/page-state.js";
import { date } from "../format.js";

export const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const lead = (html) => `<p class="ar-lead">${html}</p>`;
const note = (html) => `<p class="ar-note">${html}</p>`;
const sub = (text) => `<h5 class="ar-sub">${text}</h5>`;
const list = (items) => `<ul class="ar-list">${items.join("")}</ul>`;
const row = (main, side = "", sub = "") =>
  `<li><span class="ar-row-main">${main}</span>${side ? `<span class="ar-row-side">${side}</span>` : ""}` +
  `${sub ? `<span class="ar-row-sub">${sub}</span>` : ""}</li>`;
const glance = (tone, text) => ({ tone, text });

// ---------- Drinking water ----------

const WATER_TONE = { green: "good", amber: "warn", red: "bad" };

// The latest month with samples ("2026-09"), and whether DEP should have posted newer ones by today.
function waterMonth(data, today) {
  const month = data?.completeMonth ?? data?.months?.at(-1);
  return month ? { month, stale: isStale(month, today) } : null;
}

// station: nearestStation() (with .miles); data: /api/water/stations for it; today: "YYYY-MM-DD".
export function waterGlance(station, data, today = new Date().toISOString().slice(0, 10)) {
  const v = station ? stationVerdict(data?.stations?.[station.site]) : null;
  if (!v || !WATER_TONE[v.status]) return glance("info", "No recent water samples nearby");
  const text = `Water: ${STATUS_TEXT[v.status].toLowerCase()}`;
  const m = waterMonth(data, today);
  if (!m) return glance(WATER_TONE[v.status], text);
  const when = monthLabel(m.month, "short");
  // Old samples can't vouch for today's water, so a good verdict turns amber.
  if (m.stale) return glance(v.status === "red" ? "bad" : "warn", `${text}, but no samples since ${when}`);
  return glance(WATER_TONE[v.status], `${text} (samples to ${when})`);
}

export function waterHtml(station, data, today = new Date().toISOString().slice(0, 10)) {
  if (!station) return lead("No active sampling station near here.");
  const details = data?.stations?.[station.site];
  const v = stationVerdict(details);
  const months = data?.months ?? [];
  const range = months.length ? `${monthLabel(months[0], "short")}–${monthLabel(months[months.length - 1], "short")}` : "";
  const where = `Station ${escape(station.site)}, ${milesText(station.miles)} away${station.borough ? ` in ${escape(waterBorough(station.borough))}` : ""}`;
  if (!v) return lead(`${where}: no routine samples in the last 12 months.`);
  return `<p class="water-card-verdict" data-status="${v.status}"><span class="water-status-icon" aria-hidden="true">${STATUS_ICON[v.status]}</span>` +
    `<span>${escape(v.text)}</span></p>` +
    note(`${where}${station.place ? ` (${escape(station.place)})` : ""}. Routine samples${range ? `, ${escape(range)}` : ""}.`) +
    (waterMonth(data, today)?.stale ? note("The city hasn’t posted newer samples yet, so this may be out of date.") : "");
}

// ---------- Street closures ----------

// c: closuresCard()
export function closuresGlance(c) {
  if (c.today) return glance("warn", `${plural(c.today, "block")} closed today`);
  if (c.week) return glance("info", `${plural(c.week, "block")} closing later this week`);
  return glance("good", "No street closures this week");
}

export function closuresHtml(c) {
  if (!c.week) return lead("No street closures posted within ¼ mile this week.");
  const now = c.today ? `<strong>${plural(c.today, "block")}</strong> closed today within ¼ mile` : "Nothing closed today within ¼ mile";
  const later = c.week - c.today;
  return lead(`${now}${later ? `, and ${plural(later, "block")} later this week` : ""}.`) +
    list(c.nearest.map((b) => row(escape(blockTitle(b)), escape(metersText(b.meters)), escape(timingText(b.status, c.date)))));
}

// ---------- 311 ----------

/*
 * c: complaintsCard(); standouts: complaintsStandouts(), or null while the
 * city's numbers load (or when they couldn't).
 */
export function complaintsGlance(c, standouts) {
  if (!c.total) return glance("good", "No 311 requests nearby this year");
  const top = standouts?.above?.[0];
  // Information, not a warning: "more common than citywide" can be animals in a park.
  if (top) return glance("info", `Stands out on 311: ${top.label} (${ratioText(top.ratio)} the city)`);
  return glance("info", `Most common 311 request: ${c.top[0].label}`);
}

export function complaintsHtml(c) {
  if (!c.total) return lead("No 311 requests within ¼ mile in the last 12 months. Even the pigeons are quiet.");
  const max = c.top[0].count;
  return lead(`<strong>${plural(c.total, "request")}</strong> to 311 within ¼ mile in the last 12 months. ` +
      `${percent(c.openShare, 0)} are still open.`) +
    `<div class="ar-split">` +
      `<div>${sub("Most common")}<ol class="ar-bars">${c.top.map((t) =>
        `<li><span class="ar-row-main">${escape(t.label)}</span><span class="ar-row-side">${count(t.count)}</span>` +
        `<span class="ar-bar" aria-hidden="true"><span style="width:${((t.count / max) * 100).toFixed(1)}%"></span></span></li>`).join("")}</ol></div>` +
      `<div data-standouts>${sub("More common here than citywide")}` +
        `<span class="sk-line"></span><span class="sk-line sk-short"></span><span class="sk-line"></span></div>` +
    `</div>`;
}

// What fills [data-standouts] once the city's numbers are in. s: complaintsStandouts(), or null if they couldn't load.
export function standoutsHtml(s) {
  const body = !s ? note("The comparison with the whole city isn’t available right now.")
    : !s.enough ? note("Too few requests within ¼ mile to compare fairly with the whole city.")
    : !s.above.length ? note("Nothing stands out: requests here look like the city’s usual mix.")
    : list(s.above.map((r) => row(escape(r.label), `${ratioText(r.ratio)} the city`, `${plural(r.count, "request")} here`))) +
      note("Each type’s share of requests here, against its share across the city.");
  return sub("More common here than citywide") + body;
}

// ---------- Restaurants ----------

const GRADES = [["A", "A"], ["B", "B"], ["C", "C"], ["other", "Not graded yet"]];
const GRADE_TONE = { A: "a", B: "b", C: "c", other: "pending" };

// c: restaurantsCard()
export function restaurantsGlance(c) {
  if (!c.total) return glance("info", "No restaurants within ½ mile");
  return glance("info", `${count(c.grades.A)} of ${c.total} nearby restaurants have an A`);
}

export function restaurantsHtml(c) {
  if (!c.total) return lead("No restaurants within about half a mile.");
  const shown = GRADES.filter(([k]) => c.grades[k]);
  const head = c.more ? `the ${count(c.total)} nearest restaurants` : `${plural(c.total, "restaurant")} within about half a mile`;
  return lead(`Of ${head}, <strong>${count(c.grades.A)}</strong> ${c.grades.A === 1 ? "has" : "have"} an A.`) +
    `<div class="ar-mix" aria-hidden="true">${shown.map(([k]) =>
      `<span data-tone="${GRADE_TONE[k]}" style="width:${((c.grades[k] / c.total) * 100).toFixed(1)}%"></span>`).join("")}</div>` +
    `<ul class="ar-mix-key">${shown.map(([k, w]) =>
      `<li><span class="ar-mix-dot" data-tone="${GRADE_TONE[k]}" aria-hidden="true"></span>${escape(w)}: ${count(c.grades[k])}</li>`).join("")}</ul>` +
    sub("Nearest") +
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

// ---------- Help near me ----------

// sites: helpCard()
// How many kinds of help are close, not whichever one happens to be nearest.
export function helpGlance(sites) {
  if (!sites.length) return glance("info", "No city help sites within 2 miles");
  const close = sites.filter((s) => s.miles <= 1).length;
  return glance("info", close ? `${plural(close, "kind")} of city help within 1 mi` : `${plural(sites.length, "kind")} of city help within 2 mi`);
}

export function helpHtml(sites) {
  if (!sites.length) return lead("No city help sites within 2 miles.");
  return lead("The nearest open site for each kind of help.") + list(sites.map((s) => row(
    `<span class="ar-kind">${escape(s.kind)}</span> ${escape(s.name)}`,
    escape(milesText(s.miles)),
    `${escape(fullAddress(s))}<span class="ar-directions"> · <a href="${escape(directionsUrl(s))}" target="_blank" rel="noopener">Directions</a></span>`
  )));
}

// ---------- Schools ----------

// schools: nearestSchools()
export function schoolsGlance(schools) {
  if (!schools.length) return glance("info", "No public schools found nearby");
  return glance("info", `Nearest public school: ${milesText(schools[0].miles)}`);
}

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

// ---------- Your building ----------

// The Building Report Card's key takeaways the card shows (report.js BUILDING_SECTIONS), with its labels.
const BUILDING_TAKEAWAYS = [
  { key: "flags", label: "Serious warnings", take: flagsTakeaway },
  { key: "violations", label: "Open repair orders", take: violationsTakeaway },
  { key: "complaints", label: "Tenant complaints, last 12 months", take: complaintsTakeaway },
  { key: "dob", label: "Open building-safety violations", take: dobTakeaway }
];

// No building to show: the spot came from a ZIP, "Use my location" or a shared link (the URL never names one).
export const buildingAskGlance = () => glance("none", "Type a street address to see your building");
export const buildingAskHtml = () =>
  lead("A building’s report needs its street address: house number, street and borough.") +
  note("Type one above with “Change address”, or look it up on the Building Report Card.");

// The address has no tax lot the city's building records know.
export const buildingMissingGlance = () => glance("info", "No city building records for this address");
export const buildingMissingHtml = () => lead("We couldn’t find city building records for this address.");

/*
 * lot: /api/building-report/lot's lot; parts: { flags, violations, complaints, dob },
 * each that section's summary, or null when it couldn't load.
 */
export function buildingGlance(lot, parts) {
  const { flags, violations: v } = parts;
  if (flags?.active) return glance("warn", "Serious warning on file for this building");
  if (!v) return glance("info", flags ? "No serious warnings on file" : "See your building’s records");
  if (isEmptyHpd(lot, v.ever)) return glance("info", "No housing agency records for this building");
  if (v.open.C) return glance("warn", `${plural(v.open.C, "urgent repair order")} open in your building`);
  if (v.open.total) return glance("info", `${plural(v.open.total, "repair order")} open in your building`);
  return glance("good", "No open repair orders in your building");
}

export function buildingHtml(lot, parts) {
  const facts = [lot.units > 0 ? plural(lot.units, "apartment") : null, lot.yearBuilt ? `built ${lot.yearBuilt}` : null].filter(Boolean);
  return lead(`<strong>${escape(lotName(lot))}</strong>${facts.length ? ` · ${escape(facts.join(", "))}` : ""}`) +
    `<ul class="br-take-list ar-takes">${BUILDING_TAKEAWAYS.map(({ key, label, take }) => {
      const t = parts[key] ? take(parts[key], lot) : { tone: "none", value: "—", text: "Couldn’t load this. The full report may have it." };
      return `<li class="br-take" data-tone="${escape(t.tone)}"><span class="br-take-label">${escape(label)}</span>` +
        `<span class="br-take-value${t.value.length > 6 ? " br-take-value-text" : ""}">${escape(t.value)}</span>` +
        `<span class="br-take-text">${escape(t.text)}</span></li>`;
    }).join("")}</ul>`;
}

// ---------- Street safety ----------

const KSI = (c) => c.killed + c.serious;
// report.js CRASH_RADIUS (250 m), in Crash Hotspots' words.
const CRASH_AREA = "within about 3 blocks";

// c: safetyCard()
export function safetyGlance(c) {
  if (!c.hurt) return glance("good", `No crashes hurt anyone ${CRASH_AREA}`);
  const text = `${plural(c.hurt, "crash", "crashes")} hurt someone ${CRASH_AREA}`;
  return KSI(c) ? glance("warn", `${text}; ${plural(KSI(c), "person", "people")} killed or seriously hurt`) : glance("info", text);
}

export function safetyHtml(c) {
  const when = c.from && c.through ? note(`Police-reported crashes, ${escape(date(c.from))} to ${escape(date(c.through))}.`) : "";
  if (!c.hurt) return lead(`No police-reported crash hurt anyone ${CRASH_AREA}${c.crashes ? `, out of ${plural(c.crashes, "crash", "crashes")} reported` : ""}.`) + when;
  const days = Math.max(1, daysCovered({ dateFrom: c.from, dataThrough: c.through }));
  const stat = (value, label, tone = "") =>
    `<div class="br-stat"${tone ? ` data-tone="${tone}"` : ""}><span class="br-stat-value">${value}</span><span class="br-stat-label">${label}</span></div>`;
  const w = c.watch;
  return `<div class="br-stats">` +
      stat(count(c.hurt), `Crashes that hurt someone (${escape(howOften(c.hurt, days).replace(/\.$/, "").replace(/^About/, "about"))})`) +
      stat(count(KSI(c)), `People killed or seriously hurt${c.killed ? ` (${count(c.killed)} killed)` : ""}`, KSI(c) ? "warn" : "") +
    `</div>` +
    (w ? sub("Stands out here") +
      `<p class="ar-lead"><strong>${escape(w.title)}</strong>: ${escape(`${pct(w.share)} of crashes here, vs ${pct(w.baseShare)} across ${c.compareLabel ?? "the borough"}`)}.</p>` +
      (w.tip ? note(escape(w.tip)) : "") : "") +
    (c.corners.length ? sub("Corners where crashes hurt people most") + list(c.corners.map((k) => {
      const f = k.findings[0] ?? k.common;
      return row(escape(k.label), plural(k.hurt, "injury crash", "injury crashes"), f ? `Most often: ${escape(f.title.toLowerCase())}` : "");
    })) : "") +
    when;
}

// ---------- Parks ----------

// parks: nearestParks(). The playground leads the glance: it's what most people look for.
export function parksGlance(parks) {
  const a = parks.find((x) => x.category === "playground") ?? parks[0];
  if (!a) return glance("info", "No park amenities found nearby");
  return glance("info", `Nearest ${parkKind(a.category).one.toLowerCase()}: ${milesText(a.miles)}`);
}

export function parksHtml(parks, today = new Date()) {
  if (!parks.length) return lead("No NYC Parks playgrounds, dog runs, fountains or pools found nearby.");
  return lead("The nearest of each kind.") + list(parks.map((a) => {
    const off = seasonOf(a, today)?.short;
    const place = placeText(a);
    return row(
      `<span class="ar-kind">${escape(parkKind(a.category).one)}</span> ${escape(a.name)}`,
      escape(milesText(a.miles)),
      [place ? escape(place) : "", off ? escape(off) : ""].filter(Boolean).join(" · ") +
        `<span class="ar-directions"> · <a href="${escape(parkDirections(a))}" target="_blank" rel="noopener">Directions</a></span>`
    );
  })) + note(escape(PARKS_ONLY));
}
