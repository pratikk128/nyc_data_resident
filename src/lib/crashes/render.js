/*
 * HTML for the crash lookup's results and deep dive. Pure and browser-safe
 * (the page script inserts it; tests check it). Every value is escaped;
 * missing ones read "Not recorded".
 */
import { date } from "../format.js";
import { NOT_RECORDED } from "./present.js";
import { BROAD_TOTAL } from "./search.js";

export const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const val = (v) => (v == null || v === "" || (Array.isArray(v) && !v.length)
  ? `<span class="cl-missing">${NOT_RECORDED}</span>`
  : escape(Array.isArray(v) ? v.join("; ") : v));
const when = (d, t) => `${escape(date(d))}${t ? `, ${escape(t)}` : `, <span class="cl-missing">time not recorded</span>`}`;

// A definition list, one row per [label, value].
const dl = (rows, cls = "") => `<dl class="cl-dl ${cls}">${rows.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${val(v)}</dd></div>`).join("")}</dl>`;

// ---------- Results ----------

const STRENGTH_WORDS = { exact: "", close: "close", partial: "partial" };

export function chipsHtml(chips) {
  if (!chips.length) return "";
  return `<ul class="cl-chips" aria-label="Details that match">${chips.map((c) => `<li class="cl-chip cl-chip-${c.strength}">${escape(c.label)}${STRENGTH_WORDS[c.strength] ? ` <span class="cl-chip-how">${STRENGTH_WORDS[c.strength]}</span>` : ""}</li>`).join("")}</ul>`;
}

export function cardHtml(r, rank) {
  const place = r.location ?? "Street not recorded";
  const hurt = r.killed ? `${r.killed} killed` : r.injured ? `${r.injured} injured` : null;
  return `<li class="cl-card">
  <article aria-labelledby="cl-card-${escape(r.collisionId)}">
    <div class="cl-card-top">
      <p class="cl-rank">#${rank}</p>
      ${r.percent != null ? `<p class="cl-score"><strong>${r.percent}%</strong> match</p>` : ""}
    </div>
    <h3 class="cl-card-title" id="cl-card-${escape(r.collisionId)}">${when(r.date, r.time)}</h3>
    <p class="cl-card-place">${escape(place)}${r.area ? ` · ${escape(r.area)}` : ""}</p>
    <p class="cl-card-line"><span class="cl-card-key">Vehicles</span> ${escape(r.vehicles)}</p>
    <p class="cl-card-line"><span class="cl-card-key">People</span> ${escape(r.people)}${hurt ? ` · ${escape(hurt)}` : ""}</p>
    ${chipsHtml(r.chips)}
    ${r.missed.length ? `<p class="cl-missed"><span class="cl-card-key">Didn’t match</span> ${escape(r.missed.join(", "))}</p>` : ""}
    <p class="cl-card-open"><a class="cl-open" href="?crash=${escape(r.collisionId)}" data-open="${escape(r.collisionId)}">See this crash<span class="sr-only">: ${escape(date(r.date))}, ${escape(place)}</span></a></p>
  </article>
</li>`;
}

export function broadHtml(total) {
  return `<div class="callout callout-heads-up cl-broad" role="note">
  <p><strong>That’s a lot of crashes.</strong> ${escape(total.toLocaleString("en-US"))} fit at least one detail (more than ${BROAD_TOTAL}).
  Add what you know best: a cross street, the vehicle’s make and year, or a narrower date range.</p>
</div>`;
}

export const emptyHtml = () => `<div class="cl-empty">
  <p><strong>No crashes fit those details.</strong></p>
  <p>Try fewer details, a wider date range, or a street name without the direction (“72 St” instead of “W 72 St”).
  Not every crash is in this data: it has police-reported crashes only.</p>
</div>`;

// ---------- Deep dive ----------

function personRows(p, { withVehicle = true } = {}) {
  const r = p.recognize;
  return [
    ["Age", r.age],
    ["Sex", r.sex],
    ...(withVehicle ? [["Vehicle", r.vehicle]] : []),
    ["Where they were", r.position]
  ];
}

function personLine(p) {
  const r = p.recognize;
  const bits = [r.age != null ? `age ${r.age}` : null, r.sex?.toLowerCase(), r.position].filter(Boolean);
  return `${escape(p.roleLabel ?? "Person")}${bits.length ? `, ${escape(bits.join(", "))}` : ""}`;
}

function vehicleRecognizeHtml(v) {
  const r = v.recognize;
  const people = v.people.length
    ? `<ul class="cl-people">${v.people.map((p) => `<li>${personLine(p)}</li>`).join("")}</ul>`
    : `<p class="cl-missing">No one recorded in this vehicle.</p>`;
  return `<section class="cl-vehicle" aria-labelledby="cl-v-${v.number}">
  <h4 id="cl-v-${v.number}">Vehicle ${v.number}: ${escape(v.label)}</h4>
  ${dl([
    ["Type", r.type], ["Make", r.make], ["Model year", r.year], ["Registration state", r.state],
    ["Direction", r.direction], ["Occupants", r.occupants], ["Driver’s sex", r.driverSex],
    ["Driver’s license", r.licenseStatus], ["License state", r.licenseJurisdiction]
  ])}
  ${r.makeAsRecorded && r.makeAsRecorded !== r.make ? `<p class="cl-note">Make as the police wrote it: ${escape(r.makeAsRecorded)}</p>` : ""}
  <h5>People in this vehicle</h5>
  ${people}
</section>`;
}

function peopleListHtml(title, people, note = "") {
  if (!people.length) return "";
  return `<section class="cl-group">
  <h4>${escape(title)}</h4>${note ? `<p class="cl-note">${note}</p>` : ""}
  <ul class="cl-person-list">${people.map((p) => `<li><h5>${escape(p.roleLabel ?? "Person")}</h5>${dl(personRows(p), "cl-dl-inline")}</li>`).join("")}</ul>
</section>`;
}

function recognizeHtml(d) {
  const r = d.recognize;
  return `<section class="cl-part" aria-labelledby="cl-recognize-title">
  <h3 id="cl-recognize-title">Is this the crash?</h3>
  <section class="cl-group" aria-labelledby="cl-where-title">
    <h4 id="cl-where-title">When and where</h4>
    <div class="cl-where">
      ${dl([
        ["Date", r.date ? date(r.date) : null], ["Time", r.time],
        ["Street", r.onStreet], ["Cross street", r.crossStreet], ["Off-street location", r.offStreet],
        ["Borough", r.borough], ["ZIP code", r.zip]
      ])}
      ${r.point ? `<div class="cl-map" data-crash-map role="img" aria-label="Map of where the crash happened"></div>` : `<p class="cl-note">No map point recorded for this crash.</p>`}
    </div>
  </section>
  <section class="cl-group" aria-labelledby="cl-vehicles-title">
    <h4 id="cl-vehicles-title">Vehicles</h4>
    ${d.vehicles.length ? d.vehicles.map(vehicleRecognizeHtml).join("") : `<p class="cl-missing">No vehicles recorded.</p>`}
  </section>
  ${peopleListHtml("Pedestrians, cyclists and riders", d.outside)}
  ${peopleListHtml("Others in a vehicle", d.unplaced, "The report lists them in a vehicle that isn’t in the vehicle table.")}
  ${peopleListHtml("Also on the report", d.notInvolved, "Registered owners, witnesses and people the police notified. They weren’t necessarily there.")}
</section>`;
}

function detailsHtml(d) {
  const c = d.details;
  const counts = [
    ["Everyone", c.injured, c.killed], ["Pedestrians", c.pedestriansInjured, c.pedestriansKilled],
    ["Cyclists", c.cyclistsInjured, c.cyclistsKilled], ["Motorists", c.motoristsInjured, c.motoristsKilled]
  ];
  const everyone = [...d.vehicles.flatMap((v) => v.people.map((p) => [p, v])), ...d.outside.map((p) => [p, null]), ...d.unplaced.map((p) => [p, null])];
  return `<section class="cl-part" aria-labelledby="cl-details-title">
  <h3 id="cl-details-title">What happened</h3>
  <section class="cl-group">
    <h4>Injuries and deaths</h4>
    <div class="table-scroll"><table class="data-table cl-counts">
      <thead><tr><th scope="col">Who</th><th scope="col">Injured</th><th scope="col">Killed</th></tr></thead>
      <tbody>${counts.map(([who, i, k]) => `<tr><th scope="row">${who}</th><td>${val(i)}</td><td>${val(k)}</td></tr>`).join("")}</tbody>
    </table></div>
    ${dl([["Contributing factors (crash)", c.factors]])}
  </section>
  ${d.vehicles.length ? `<section class="cl-group"><h4>Each vehicle</h4>${d.vehicles.map((v) => `<h5>Vehicle ${v.number}: ${escape(v.label)}</h5>${dl([
    ["Before the crash", v.details.preCrash], ["Point of impact", v.details.pointOfImpact], ["Damage", v.details.damage],
    ["Public property damaged", v.details.publicPropertyDamage], ["What was damaged", v.details.publicPropertyDamageType],
    ["Contributing factors", v.details.factors]
  ])}`).join("")}</section>` : ""}
  ${everyone.length ? `<section class="cl-group"><h4>Each person</h4>${everyone.map(([p, v]) => `<h5>${personLine(p)}${v ? ` · Vehicle ${v.number}` : ""}</h5>${dl([
    ["Injury", p.details.injury], ["Injury to", p.details.bodilyInjury], ["Complaint", p.details.complaint],
    ["Ejected", p.details.ejection], ["Safety equipment", p.details.safetyEquipment], ["Condition", p.details.emotionalStatus],
    ...(p.role === "pedestrian" || p.role === "cyclist" || p.role === "other-motorized"
      ? [["Where they were", p.details.pedLocation], ["What they were doing", p.details.pedAction]] : []),
    ["Contributing factors", p.details.factors]
  ])}`).join("")}</section>` : ""}
</section>`;
}

export function detailHtml(d) {
  return `<article class="cl-detail" aria-labelledby="cl-detail-title">
  <p class="cl-back"><a href="#cl-results" data-close>← Back to results</a></p>
  <h2 id="cl-detail-title" tabindex="-1">${when(d.recognize.date, d.recognize.time)}${d.recognize.location ? ` · ${escape(d.recognize.location)}` : ""}</h2>
  <p class="cl-possible">A possible match, not a confirmation. Check it with the NYPD (see below).</p>
  ${recognizeHtml(d)}
  <p class="cl-toggle-row"><button type="button" class="cl-toggle" aria-expanded="false" aria-controls="cl-details-body" data-details-toggle>Show crash details</button></p>
  <div id="cl-details-body" hidden>${detailsHtml(d)}</div>
  <footer class="cl-detail-foot">
    <p>Collision ID <code>${escape(d.collisionId)}</code>. From NYPD crash reports on NYC Open Data:
      ${d.sources.map((s) => `<a href="${escape(s.url)}" rel="noopener">${escape(s.name)}</a> (${escape(s.id)})`).join(", ")}.</p>
  </footer>
</article>`;
}
