/*
 * HTML for the Building Report Card (plain strings, drawn by the page
 * script). Each section's *Html() takes its summary from summarize.js and the
 * lot; *Takeaway() is its line in the overview's key takeaways, { tone, value,
 * text }. Every value from the data goes through escape(). The wording states
 * what the records say and never grades the building, and names agencies in
 * plain words (readers needn't know what HPD or ECB stand for).
 */
import { escape } from "../address-report/render.js";
import { count, money, date } from "../format.js";
import { CLASSES } from "./config.js";
import { classInfo } from "./summarize.js";

export { escape };

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const p = (html, cls = "br-text") => `<p class="${cls}">${html}</p>`;
const note = (html) => p(html, "ar-note");
const sub = (text) => `<h4 class="ar-sub">${text}</h4>`;
const list = (items) => `<ul class="ar-list">${items.join("")}</ul>`;
const row = (main, side = "", below = "") =>
  `<li><span class="ar-row-main">${main}</span>${side ? `<span class="ar-row-side">${side}</span>` : ""}` +
  `${below ? `<span class="ar-row-sub">${below}</span>` : ""}</li>`;
const stat = (value, label, tone = "") =>
  `<div class="br-stat"${tone ? ` data-tone="${tone}"` : ""}><span class="br-stat-value">${value}</span><span class="br-stat-label">${label}</span></div>`;
const stats = (items) => `<div class="br-stats">${items.join("")}</div>`;
const takeaway = (tone, value, text) => ({ tone, value, text });
const monthName = (ym, style = "short") =>
  new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-US", { month: style, year: style === "short" ? undefined : "numeric", timeZone: "UTC" });

export const UPSTREAM_TEXT = "Couldn’t reach NYC Open Data. Their servers might be stuck behind a double-parked truck. Try again in a minute.";

// A lot HPD doesn't cover and has never cited: no zeros, just what that means.
// The why is said once, in the first HPD section (violations).
export function noHpdHtml(what, { explain = false } = {}) {
  return p(`<strong>No HPD records for this building.</strong> The city’s housing agency (HPD) has no ${what} on file for this lot.`) +
    (explain ? note("HPD enforces the housing code mainly in rental buildings with 3 or more apartments. One- and two-family homes and commercial buildings usually have no HPD records, so an empty section here doesn’t mean HPD inspected and found nothing.") : "");
}
export const NO_HPD_TEXT = "No records from the city’s housing agency";

// Shown in place of an HPD section's body when HPD has nothing at all for the lot.
export const isEmptyHpd = (lot, ever) => !lot.hpd && !ever;

// "Source: Housing Maintenance Code Violations, updated Nov 1, 2026"
export function sourcesHtml(sources) {
  return `<p class="br-source">${sources.map((s) =>
    `Source: <a href="${escape(s.url)}" rel="noopener">${escape(s.name)}</a>, ` +
    (s.updatedAt ? `updated <time datetime="${escape(s.updatedAt)}">${date(s.updatedAt)}</time>` : "update date unavailable")
  ).join("<br>")}</p>`;
}

/*
 * A small column chart in HTML: one bar per item, the value in each bar's
 * label for screen readers, a label every `every` items under the axis.
 * items: [{ label, short, n }]
 */
export function columnsHtml(items, { caption, every = 1 }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return `<figure class="br-cols-frame"><ol class="br-cols" aria-label="${escape(caption)}">${items.map((it, i) =>
    `<li class="br-col-item"><span class="br-col-value">${it.n ? count(it.n) : ""}</span>` +
    `<span class="br-col"><span style="height:${it.n ? Math.max(3, (it.n / max) * 100).toFixed(1) : 0}%"></span></span>` +
    `<span class="br-col-label" aria-hidden="true">${i % every === 0 || i === items.length - 1 ? escape(it.short) : ""}</span>` +
    `<span class="sr-only">${escape(it.label)}: ${count(it.n)}</span></li>`).join("")}</ol>` +
    `<figcaption class="ar-note">${escape(caption)}</figcaption></figure>`;
}

function barsHtml(items) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return `<ol class="ar-bars">${items.map((t) =>
    `<li><span>${escape(t.label)}</span><span class="ar-row-side">${count(t.n)}</span>` +
    `<span class="ar-bar" aria-hidden="true"><span style="width:${((t.n / max) * 100).toFixed(1)}%"></span></span></li>`).join("")}</ol>`;
}

// ---------- Red flags ----------

// What's active now, in words: "1 vacate order in effect, on the city’s watch list"
export function flagsSummary(d) {
  const parts = [];
  if (d.activeVacates.length) parts.push(`${plural(d.activeVacates.length, "vacate order")} in effect`);
  if (d.aep?.active) parts.push("on the city’s watch list for neglected buildings");
  if (d.pendingCases) parts.push(`${plural(d.pendingCases, "open court case")} brought by the city`);
  return parts.join(", ");
}

export function flagsTakeaway(d) {
  if (!d.active) return takeaway("info", "None", d.any ? "Nothing active now (some past ones on record)" : "No vacate order, no city watch list, no open court case");
  const text = flagsSummary(d);
  return takeaway("warn", "Yes", text[0].toUpperCase() + text.slice(1));
}

export function flagsHtml(d) {
  const out = [];
  if (d.activeVacates.length) {
    out.push(sub("Vacate orders in effect"));
    out.push(list(d.activeVacates.map((v) => row(
      escape(`${v.type ?? "Vacate"} vacate: ${v.reason ?? "reason not given"}`),
      v.date ? date(v.date) : "",
      v.units != null ? `${plural(v.units, "unit")} vacated` : ""
    ))));
    out.push(note("A vacate order means the city ordered people out of all or part of the building until a dangerous condition is fixed."));
  }
  if (d.pastVacates) out.push(note(`${plural(d.pastVacates, "earlier vacate order")} here ${d.pastVacates === 1 ? "has" : "have"} since been lifted.`));
  if (d.aep) {
    const a = d.aep;
    out.push(sub("The city’s watch list for neglected buildings"));
    out.push(p(a.active
      ? `<strong>On the list since ${date(a.start)}.</strong> Each year the city’s housing agency picks the buildings with the most serious problems for this program (the Alternative Enforcement Program, or AEP) and makes the owner fix what’s behind them.`
      : `Was on the list from ${date(a.start)}${a.discharged ? ` to ${date(a.discharged)}` : ""}${a.status ? ` (${escape(a.status.replace(/^AEP /, "").toLowerCase())})` : ""}.`));
    if (a.violationsAtStart != null) out.push(note(`${plural(a.violationsAtStart, "urgent or serious repair order")} were open when it was picked.`));
  }
  if (d.pendingCases) {
    out.push(sub("Open court cases"));
    out.push(p(`The city has ${plural(d.pendingCases, "case")} against the owner still pending in Housing Court. See Housing Court cases below.`));
  }
  if (!out.length) out.push(p("No vacate order, no city watch list, no open court case."));
  return out.join("");
}

// ---------- Violations ----------

export function violationsTakeaway(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return takeaway("info", "—", NO_HPD_TEXT);
  if (!d.open.total) return takeaway("info", "0", "Nothing the city ordered fixed is still open");
  return takeaway(d.open.C ? "warn" : "info", count(d.open.total),
    d.open.C ? `${count(d.open.C)} urgent, like no heat or lead paint (24 hours to fix)` : "None urgent");
}

export function violationsHtml(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return noHpdHtml("violations", { explain: true });
  const out = [];
  out.push(`<div class="br-classes">${CLASSES.map((c) =>
    `<div class="br-class" data-class="${c.key}"${c.key === "C" && d.open.C ? ' data-tone="warn"' : ""}>` +
    `<span class="br-class-n">${count(d.open[c.key])}</span>` +
    `<span class="br-class-name">${c.label}</span><span class="br-class-short">${c.short} · ${c.code}</span></div>`).join("")}</div>`);
  out.push(note(`${plural(d.open.total, "open repair order")}${d.open.I ? `, plus ${plural(d.open.I, "open city notice")}` : ""}. ${count(d.issued12)} issued in the last 12 months (since ${date(d.since)}), ${count(d.ever)} on record in all.`));
  out.push(note("“Open” means the city hasn’t recorded it as fixed. Owners certify their own repairs and inspectors may not have checked yet, so some may already be done."));

  if (d.byYear.length > 1) {
    out.push(sub("Repair orders issued by year"));
    out.push(columnsHtml(d.byYear.map((y) => ({ label: String(y.year), short: `’${String(y.year).slice(-2)}`, n: y.n })),
      { caption: `Repair orders (HPD violations) issued each year, ${d.byYear[0].year} to ${d.byYear.at(-1).year} (this year so far).`, every: 2 }));
  }
  if (d.recent.length) {
    out.push(sub(d.open.total > d.recent.length ? `The ${d.recent.length} most recent open orders` : "Open orders"));
    out.push(list(d.recent.map((v) => row(
      `${pill(v.class)} ${escape(v.text)}`,
      v.date ? date(v.date) : "",
      [v.apartment ? `Apt ${escape(v.apartment)}` : "", v.status ? escape(v.status) : ""].filter(Boolean).join(" · ")
    ))));
  }
  return out.join("");
}

const pill = (cls) => `<span class="br-pill" data-class="${escape(cls)}">${escape(classInfo(cls)?.label ?? `Class ${cls}`)}</span>`;

// ---------- Complaints ----------

export function complaintsTakeaway(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return takeaway("info", "—", NO_HPD_TEXT);
  return takeaway("info", count(d.last12), d.top[0] ? `${d.last12 === 1 ? "About" : "Most about"} ${d.top[0].label.toLowerCase().replace(/ \(.*\)$/, "")}` : "None in the last 12 months");
}

export function complaintsHtml(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return noHpdHtml("complaints");
  const out = [stats([stat(count(d.last12), "complaints in the last 12 months"), stat(count(d.ever), "on record in all")])];
  if (d.months.some((m) => m.n)) {
    out.push(sub("Complaints by month"));
    out.push(columnsHtml(d.months.map((m) => ({ label: monthName(m.month, "long"), short: monthName(m.month).slice(0, 1), n: m.n })),
      { caption: `Complaints to 311 and HPD each month, ${monthName(d.months[0].month, "long")} to ${monthName(d.months.at(-1).month, "long")}.` }));
  }
  if (d.top.length) {
    out.push(sub("What they were about"));
    out.push(barsHtml(d.top));
    out.push(note("Problems reported in the last 12 months. One complaint can list several problems."));
  } else out.push(p("No complaints in the last 12 months."));
  return out.join("");
}

// ---------- Bedbugs ----------

const periodText = (period) => `${date(period.start)} – ${date(period.end)}`;

export function bedbugsTakeaway(d, lot) {
  if (!d.latest) return takeaway("info", "—", lot.hpd ? "No yearly report filed, so no word either way" : NO_HPD_TEXT);
  if (d.stale) return takeaway("info", "—", `No yearly report filed since ${date(d.latest.end)}`);
  return takeaway(d.latest.infested ? "warn" : "info", count(d.latest.infested),
    `In the owner’s latest yearly report (${periodText(d.latest)})`);
}

export function bedbugsHtml(d, lot) {
  if (!d.latest) {
    return p("<strong>No bedbug report filed.</strong> That’s not the same as no bedbugs: there’s no report to say either way.") +
      note(lot.hpd
        ? "Owners of buildings with 3 or more apartments must report bedbugs to the city every year, even when there are none."
        : "The yearly bedbug report is required for buildings with 3 or more apartments, so smaller buildings usually have none.");
  }
  const l = d.latest;
  const out = [];
  if (d.stale) out.push(p(`<strong>No report filed since ${date(l.end)}.</strong> The latest one on file is below.`));
  out.push(stats([
    stat(count(l.infested), `${l.infested === 1 ? "apartment" : "apartments"} with bedbugs`, l.infested ? "warn" : ""),
    stat(count(l.eradicated), "treated and cleared"),
    stat(count(l.reinfested), "with bedbugs again after treatment")
  ]));
  out.push(note(`From the owner’s latest yearly report to the city, covering ${periodText(l)} (filed ${date(l.filed)}), for ${plural(l.units, "apartment")}. Owners report this themselves; nobody from the city inspects for it.`));
  if (d.periods.length > 1) {
    out.push(sub("Earlier reports"));
    out.push(list(d.periods.slice(1).map((x) => row(
      periodText(x),
      x.infested ? `${plural(x.infested, "apartment")} with bedbugs` : "None with bedbugs",
      x.eradicated || x.reinfested ? `${count(x.eradicated)} cleared, ${count(x.reinfested)} again after treatment` : ""
    ))));
  }
  out.push(note("When an owner filed more than once for the same year, only the latest filing counts."));
  return out.join("");
}

// ---------- Pests, mold and garbage ----------

export function hygieneTakeaway(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return takeaway("info", "—", NO_HPD_TEXT);
  const complaints = d.complaints12 ? `${plural(d.complaints12, "tenant complaint")} in the last year` : "No tenant complaints in the last year";
  if (!d.open) return takeaway("info", "0", complaints);
  return takeaway("info", count(d.open), `Mostly ${d.byKind[0].label.toLowerCase()}. ${complaints}`);
}

export function hygieneHtml(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return noHpdHtml("pest, mold or garbage records");
  const out = [stats([
    stat(count(d.open), "open repair orders for pests, mold or garbage"),
    stat(count(d.complaints12), "tenant complaints about them in the last 12 months")
  ])];
  if (d.byKind.length) {
    out.push(sub("What the open orders are for"));
    out.push(barsHtml(d.byKind));
    if (d.apartments) out.push(note(`In ${plural(d.apartments, "apartment")}; orders for hallways or the whole building don’t name one.`));
  } else out.push(p("No open repair orders for pests, mold or garbage."));
  if (d.recent.length) {
    out.push(sub(d.open > d.recent.length ? `The ${d.recent.length} most recent` : "The open orders"));
    out.push(list(d.recent.map((v) => row(`${pill(v.class)} ${escape(v.text)}`, v.date ? date(v.date) : "", v.apartment ? `Apt ${escape(v.apartment)}` : ""))));
  }
  if (d.complaintTypes.length) {
    out.push(sub("What tenants complained about"));
    out.push(barsHtml(d.complaintTypes));
    out.push(note(`Since ${date(d.since)}. One complaint can list several problems.`));
  }
  out.push(note("Repair orders are what an inspector from the city’s housing agency saw and ordered fixed. We sort them by their wording (“roaches”, “mold”), so one that’s worded unusually may be missed."));
  return out.join("");
}

// ---------- Building safety (DOB) ----------

export function dobTakeaway(d) {
  if (!d.bins.length) return takeaway("info", "—", "No Department of Buildings records found");
  const complaints = `${plural(d.complaints12, "complaint")} in the last year`;
  return takeaway(d.ecb.open ? "warn" : "info", count(d.ecb.open), d.ecb.due ? `${money(d.ecb.due)} in fines still owed. ${complaints}` : complaints);
}

export function dobHtml(d) {
  if (!d.bins.length) return p("We couldn’t find a Department of Buildings number (BIN) for this lot, so there are no building-safety records to show.");
  const out = [];
  if (d.bins.length > 1) out.push(note(`This lot has ${d.bins.length} buildings (BINs ${d.bins.map(escape).join(", ")}). The Department of Buildings keeps records per building; these numbers add them up.`));
  out.push(stats([
    stat(count(d.complaints12), "complaints in the last 12 months"),
    stat(count(d.ecb.open), "open violations with fines", d.ecb.open ? "warn" : ""),
    stat(d.ecb.due ? money(d.ecb.due) : "$0", "in fines still owed")
  ]));
  if (d.top.length) {
    out.push(sub("What people complained about"));
    out.push(barsHtml(d.top));
  }
  if (d.activeComplaints) out.push(note(`${plural(d.activeComplaints, "complaint")} still open.`));
  if (d.ecb.bySeverity.length) {
    out.push(sub("Open violations by how serious they are"));
    out.push(list(d.ecb.bySeverity.map((s) => row(escape(severityLabel(s.severity)), count(s.n)))));
  }
  if (d.ecb.recent.length) {
    out.push(sub("Most recent open violations"));
    out.push(list(d.ecb.recent.map((v) => row(
      escape(v.text || v.type || "Violation"),
      v.date ? date(v.date) : "",
      [v.type, v.severity ? severityLabel(v.severity) : "", v.due ? `${money(v.due)} owed` : ""].filter(Boolean).map(escape).join(" · ")
    ))));
  }
  if (d.ecb.due) out.push(note(`${money(d.ecb.due)} owed across ${plural(d.ecb.dueCount, "violation")}, open or resolved: a violation can be resolved and still have a penalty unpaid.`));
  out.push(note("The Department of Buildings (DOB) covers the structure: construction, elevators, boilers, gas, façades. Violations with fines are heard at the city’s tribunal (OATH, formerly the ECB), which sets the penalty."));
  return out.join("");
}

// ECB mixes "CLASS - 1" with "Hazardous"; classes 1 to 3 run from most to least serious.
export function severityLabel(s) {
  const m = /^CLASS\s*-\s*(\d)/i.exec(s ?? "");
  if (!m) return s || "Unknown";
  return { 1: "Class 1 (immediately hazardous)", 2: "Class 2 (major)", 3: "Class 3 (lesser)" }[m[1]] ?? `Class ${m[1]}`;
}

// ---------- Court ----------

export function courtHtml(d, lot) {
  if (isEmptyHpd(lot, d.total)) return noHpdHtml("court cases");
  if (!d.total) return p("The city hasn’t taken the owner to Housing Court over this building.");
  const pending = d.cases.filter((c) => c.pending).length;
  const out = [p(`The city’s housing agency has brought ${plural(d.total, "case")} against the owner in Housing Court${pending ? `, ${count(pending)} still pending` : ""}.`)];
  out.push(list(d.cases.map((c) => row(
    escape(c.type),
    c.opened ? date(c.opened) : "",
    [c.status, c.judgement ? "Judgment entered" : "", c.harassment ? "Harassment found" : "", c.penalty ? `Penalty: ${c.penalty}` : ""]
      .filter(Boolean).map(escape).join(" · ")
  ))));
  if (d.total > d.cases.length) out.push(note(`The ${d.cases.length} most recent of ${count(d.total)}.`));
  out.push(note("Cases the city brought to make the owner fix conditions, restore heat or stop harassing tenants. Tenants’ own cases against the owner aren’t in this data."));
  return out.join("");
}

// ---------- City repairs ----------

export function repairsTakeaway(d, lot) {
  if (!d.orders) return takeaway("info", "0", lot.hpd ? "The city hasn’t had to step in" : NO_HPD_TEXT);
  // The count is the orders where the city's contractor did the work; many end with none done.
  const of = `of ${plural(d.orders, "emergency order")}`;
  return takeaway("info", count(d.done), d.done
    ? `Out ${of}. ${money(d.amount)} of work, billed to the owner`
    : `None done by the city’s contractors, out ${of}`);
}

export function repairsHtml(d, lot) {
  if (isEmptyHpd(lot, d.orders)) return noHpdHtml("emergency repair orders");
  if (!d.orders) return p("The city hasn’t had to order emergency repairs here.");
  const out = [stats([
    stat(count(d.orders), "emergency repair orders"),
    stat(count(d.done), "where the city’s contractor did the work"),
    stat(money(d.amount), "for that work, billed to the owner")
  ])];
  out.push(list([
    row("Bigger jobs by outside contractors", plural(d.omo.orders, "order"), d.omo.done ? `${count(d.omo.done)} with work done, ${money(d.omo.amount)} awarded (Open Market Orders)` : "Open Market Orders"),
    row("Smaller fixes", plural(d.hwo.orders, "order"), d.hwo.done ? `${count(d.hwo.done)} with work done, ${money(d.hwo.amount)} charged (Handyman Work Orders)` : "Handyman Work Orders")
  ]));
  if (d.latest) out.push(note(`The most recent was created ${date(d.latest)}.`));
  out.push(note("When an owner doesn’t fix an emergency (no heat, a leak, a broken lock), the city’s housing agency can hire a contractor and bill the owner; unpaid bills become a lien on the property. Many orders end with no work done because the owner fixed it first or the contractor couldn’t get in. Dollars count only the orders where the work got done."));
  return out.join("");
}

// ---------- Landlord ----------

export function landlordTakeaway(d, lot) {
  if (!d.registration) return takeaway("info", "—", lot.hpd ? "Not registered with the city" : NO_HPD_TEXT);
  const owner = d.contacts.find((c) => /Owner/.test(c.role)) ?? d.contacts[0];
  const r = d.registration;
  return takeaway(r.expired ? "warn" : "info", owner ? owner.name : "Not listed",
    r.expired ? `Registration with the city expired ${date(r.end)}` : `Registered with the city through ${date(r.end)}`);
}

export function landlordHtml(d, lot) {
  if (!d.registration) {
    return p(lot.hpd ? "<strong>Not registered with the city.</strong>" : "<strong>No HPD records for this building.</strong> There’s no registration on file.") +
      note("Owners must register with the city’s housing agency every year if the building has 3 or more apartments, or is a 1–2 family home where neither the owner nor their family lives.");
  }
  const r = d.registration;
  const out = [p(r.expired
    ? `<strong>Registration expired ${date(r.end)}.</strong> Last registered ${date(r.last)} (registration ID ${escape(r.id)}).`
    : `Registered with the city’s housing agency (HPD) through ${date(r.end)}. Last registered ${date(r.last)} (registration ID ${escape(r.id)}).`)];
  if (d.contacts.length) {
    out.push(sub("Who’s on the registration"));
    out.push(list(d.contacts.map((c) => row(escape(c.name), escape(c.label)))));
    out.push(note("As the owner listed them with the city. A company owner is often an LLC set up for this one building."));
  }
  if (r.count > 1) out.push(note(`This lot has ${r.count} registrations (one per building); the most recent is shown.`));
  return out.join("");
}
