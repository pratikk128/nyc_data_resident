/*
 * HTML for the Building Report Card (plain strings, drawn by the page
 * script). Each section's *Html() takes its summary from summarize.js and the
 * lot; *Glance() is its card in the "At a glance" row, { tone, text, value }.
 * Every value from the data goes through escape(). The wording states what
 * the records say and never grades the building.
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
const glance = (tone, value, text) => ({ tone, value, text });
const monthName = (ym, style = "short") =>
  new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-US", { month: style, year: style === "short" ? undefined : "numeric", timeZone: "UTC" });

export const UPSTREAM_TEXT = "Couldn’t reach NYC Open Data. Their servers might be stuck behind a double-parked truck. Try again in a minute.";

// A lot HPD doesn't cover and has never cited: no zeros, just what that means.
// The why is said once, in the first HPD section (violations).
export function noHpdHtml(what, { explain = false } = {}) {
  return p(`<strong>No HPD records for this building.</strong> HPD has no ${what} on file for this lot.`) +
    (explain ? note("HPD enforces the housing code mainly in rental buildings with 3 or more apartments. One- and two-family homes and commercial buildings usually have no HPD records, so an empty section here doesn’t mean HPD inspected and found nothing.") : "");
}

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

export function flagsGlance(d) {
  if (!d.active) return glance("info", "None", d.any ? "No active red flags (some past ones below)" : "No vacate order, AEP or open HPD case");
  const parts = [];
  if (d.activeVacates.length) parts.push(plural(d.activeVacates.length, "vacate order"));
  if (d.aep?.active) parts.push("in AEP");
  if (d.pendingCases) parts.push(plural(d.pendingCases, "open HPD case"));
  return glance("warn", "Yes", parts.join(", "));
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
    out.push(note("A vacate order means HPD ordered people out of all or part of the building until a dangerous condition is fixed."));
  }
  if (d.pastVacates) out.push(note(`${plural(d.pastVacates, "earlier vacate order")} here ${d.pastVacates === 1 ? "has" : "have"} since been lifted.`));
  if (d.aep) {
    const a = d.aep;
    out.push(sub("Alternative Enforcement Program (AEP)"));
    out.push(p(a.active
      ? `<strong>In AEP since ${date(a.start)}.</strong> HPD picks the buildings with the most serious violations for this program each year.`
      : `Was in AEP from ${date(a.start)}${a.discharged ? ` to ${date(a.discharged)}` : ""}${a.status ? ` (${escape(a.status.replace(/^AEP /, "").toLowerCase())})` : ""}.`));
    if (a.violationsAtStart != null) out.push(note(`${plural(a.violationsAtStart, "Class B or C violation")} were open when it was picked.`));
  }
  if (d.pendingCases) {
    out.push(sub("Open HPD court cases"));
    out.push(p(`HPD has ${plural(d.pendingCases, "case")} against the owner still pending in Housing Court. See Court cases below.`));
  }
  return out.join("");
}

// ---------- Violations ----------

export function violationsGlance(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return glance("info", "—", "No HPD records");
  return glance(d.open.C ? "warn" : "info", count(d.open.total), d.open.total ? `${count(d.open.C)} Class C (immediately hazardous)` : "No open violations");
}

export function violationsHtml(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return noHpdHtml("violations", { explain: true });
  const out = [];
  out.push(`<div class="br-classes">${CLASSES.map((c) =>
    `<div class="br-class" data-class="${c.key}"${c.key === "C" && d.open.C ? ' data-tone="warn"' : ""}>` +
    `<span class="br-class-n">${count(d.open[c.key])}</span>` +
    `<span class="br-class-name">${c.label}</span><span class="br-class-short">${c.short}</span></div>`).join("")}</div>`);
  out.push(note(`${plural(d.open.total, "open violation")}. ${plural(d.issued12, "violation")} issued in the last 12 months (since ${date(d.since)}), ${count(d.ever)} on record in all.`));
  out.push(note("“Open” means HPD hasn’t recorded it as fixed. Owners certify repairs and HPD may not have checked yet, so some may already be corrected."));

  if (d.byYear.length > 1) {
    out.push(sub("Violations issued by year"));
    out.push(columnsHtml(d.byYear.map((y) => ({ label: String(y.year), short: `’${String(y.year).slice(-2)}`, n: y.n })),
      { caption: `HPD violations issued each year, ${d.byYear[0].year} to ${d.byYear.at(-1).year} (this year so far).`, every: 2 }));
  }
  if (d.recent.length) {
    out.push(sub(d.open.total > d.recent.length ? `The ${d.recent.length} most recent open violations` : "Open violations"));
    out.push(list(d.recent.map((v) => row(
      `<span class="br-pill" data-class="${escape(v.class)}">${escape(classInfo(v.class)?.label ?? `Class ${v.class}`)}</span> ${escape(v.text)}`,
      v.date ? date(v.date) : "",
      [v.apartment ? `Apt ${escape(v.apartment)}` : "", v.status ? escape(v.status) : ""].filter(Boolean).join(" · ")
    ))));
  }
  return out.join("");
}

// ---------- Complaints ----------

export function complaintsGlance(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return glance("info", "—", "No HPD records");
  return glance("info", count(d.last12), d.top[0] ? `Most about ${d.top[0].label.toLowerCase().replace(/ \(.*\)$/, "")}` : "None in the last 12 months");
}

export function complaintsHtml(d, lot) {
  if (isEmptyHpd(lot, d.ever)) return noHpdHtml("complaints");
  const out = [stats([stat(count(d.last12), "complaints to HPD in the last 12 months"), stat(count(d.ever), "on record in all")])];
  if (d.months.some((m) => m.n)) {
    out.push(sub("Complaints by month"));
    out.push(columnsHtml(d.months.map((m) => ({ label: monthName(m.month, "long"), short: monthName(m.month).slice(0, 1), n: m.n })),
      { caption: `Complaints to HPD each month, ${monthName(d.months[0].month, "long")} to ${monthName(d.months.at(-1).month, "long")}.` }));
  }
  if (d.top.length) {
    out.push(sub("What they were about"));
    out.push(barsHtml(d.top));
    out.push(note("Problems reported in the last 12 months. One complaint can list several problems."));
  } else out.push(p("No complaints to HPD in the last 12 months."));
  return out.join("");
}

// ---------- Bedbugs ----------

const periodText = (period) => `${date(period.start)} – ${date(period.end)}`;

export function bedbugsGlance(d, lot) {
  if (!d.latest) return glance("info", "—", lot.hpd ? "No report filed" : "No HPD records");
  if (d.stale) return glance("info", "—", `No report filed since ${date(d.latest.end)}`);
  return glance(d.latest.infested ? "warn" : "info", count(d.latest.infested),
    d.latest.infested ? `${d.latest.infested === 1 ? "unit" : "units"} with bedbugs in the latest report` : "No infested units in the latest report");
}

export function bedbugsHtml(d, lot) {
  if (!d.latest) {
    return p("<strong>No bedbug report filed.</strong> That’s not the same as no bedbugs: there’s no report to say either way.") +
      note(lot.hpd
        ? "Owners of buildings with 3 or more apartments must report bedbugs to HPD every year, even when there are none."
        : "The yearly bedbug report is required for buildings with 3 or more apartments, so smaller buildings usually have none.");
  }
  const l = d.latest;
  const out = [];
  if (d.stale) out.push(p(`<strong>No report filed since ${date(l.end)}.</strong> The latest one on file is below.`));
  out.push(stats([
    stat(count(l.infested), `${l.infested === 1 ? "unit" : "units"} with bedbugs`, l.infested ? "warn" : ""),
    stat(count(l.eradicated), "units treated and cleared"),
    stat(count(l.reinfested), "units with bedbugs again after treatment")
  ]));
  out.push(note(`From the owner’s latest report, covering ${periodText(l)} (filed ${date(l.filed)}), for ${plural(l.units, "unit")}. Owners report this themselves; HPD doesn’t inspect for it.`));
  if (d.periods.length > 1) {
    out.push(sub("Earlier reports"));
    out.push(list(d.periods.slice(1).map((x) => row(
      periodText(x),
      x.infested ? `${plural(x.infested, "unit")} with bedbugs` : "None infested",
      x.eradicated || x.reinfested ? `${count(x.eradicated)} cleared, ${count(x.reinfested)} again after treatment` : ""
    ))));
  }
  out.push(note("When an owner filed more than once for the same year, only the latest filing counts."));
  return out.join("");
}

// ---------- DOB ----------

export function dobHtml(d) {
  if (!d.bins.length) return p("We couldn’t find a DOB building number (BIN) for this lot, so there are no DOB records to show.");
  const out = [];
  if (d.bins.length > 1) out.push(note(`This lot has ${d.bins.length} buildings (BINs ${d.bins.map(escape).join(", ")}). DOB keeps records per building; these numbers add them up.`));
  out.push(stats([
    stat(count(d.complaints12), "complaints to DOB in the last 12 months"),
    stat(count(d.ecb.open), "open ECB violations", d.ecb.open ? "warn" : ""),
    stat(d.ecb.due ? money(d.ecb.due) : "$0", "in ECB penalties still owed")
  ]));
  if (d.top.length) {
    out.push(sub("What people complained to DOB about"));
    out.push(barsHtml(d.top));
  }
  if (d.activeComplaints) out.push(note(`${plural(d.activeComplaints, "DOB complaint")} still open.`));
  if (d.ecb.bySeverity.length) {
    out.push(sub("Open ECB violations by severity"));
    out.push(list(d.ecb.bySeverity.map((s) => row(escape(severityLabel(s.severity)), count(s.n)))));
  }
  if (d.ecb.recent.length) {
    out.push(sub("Most recent open ECB violations"));
    out.push(list(d.ecb.recent.map((v) => row(
      escape(v.text || v.type || "ECB violation"),
      v.date ? date(v.date) : "",
      [v.type, v.severity ? severityLabel(v.severity) : "", v.due ? `${money(v.due)} owed` : ""].filter(Boolean).map(escape).join(" · ")
    ))));
  }
  if (d.ecb.due) out.push(note(`${money(d.ecb.due)} owed across ${plural(d.ecb.dueCount, "violation")}, open or resolved: a violation can be resolved and still have a penalty unpaid.`));
  out.push(note("DOB (the Department of Buildings) covers the structure: construction, elevators, boilers, gas, façades. ECB violations are the ones heard at the city’s tribunal (OATH), which sets the penalties."));
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
  if (!d.total) return p("HPD hasn’t taken the owner to Housing Court over this building.");
  const pending = d.cases.filter((c) => c.pending).length;
  const out = [p(`HPD has brought ${plural(d.total, "case")} against the owner in Housing Court${pending ? `, ${count(pending)} still pending` : ""}.`)];
  out.push(list(d.cases.map((c) => row(
    escape(c.type),
    c.opened ? date(c.opened) : "",
    [c.status, c.judgement ? "Judgment entered" : "", c.harassment ? "Harassment found" : "", c.penalty ? `Penalty: ${c.penalty}` : ""]
      .filter(Boolean).map(escape).join(" · ")
  ))));
  if (d.total > d.cases.length) out.push(note(`The ${d.cases.length} most recent of ${count(d.total)}.`));
  out.push(note("Cases HPD brought to make the owner fix conditions, restore heat or stop harassment. Tenants’ own cases against the owner aren’t in this data."));
  return out.join("");
}

// ---------- City repairs ----------

export function repairsGlance(d, lot) {
  if (!d.orders) return glance("info", "0", lot.hpd ? "No emergency repair orders" : "No HPD records");
  return glance("info", count(d.orders), d.amount ? `${money(d.amount)} of city-ordered work` : "Emergency repair orders");
}

export function repairsHtml(d, lot) {
  if (isEmptyHpd(lot, d.orders)) return noHpdHtml("emergency repair orders");
  if (!d.orders) return p("The city hasn’t had to order emergency repairs here.");
  const out = [stats([
    stat(count(d.orders), "emergency repair orders"),
    stat(count(d.done), "where the city’s contractor did the work"),
    stat(money(d.amount), "for that work (OMO awards plus HWO charges)")
  ])];
  out.push(list([
    row("Open Market Orders (OMO)", plural(d.omo.orders, "order"), d.omo.done ? `${count(d.omo.done)} with work done, ${money(d.omo.amount)} awarded` : ""),
    row("Handyman Work Orders (HWO)", plural(d.hwo.orders, "order"), d.hwo.done ? `${count(d.hwo.done)} with work done, ${money(d.hwo.amount)} charged` : "")
  ]));
  if (d.latest) out.push(note(`The most recent was created ${date(d.latest)}.`));
  out.push(note("When an owner doesn’t fix an emergency (no heat, a leak, a broken lock), HPD can hire a contractor and bill the owner; unpaid bills become a lien on the property. Many orders end with no work done because the owner fixed it first or the contractor couldn’t get in. Dollars count only the orders where the work got done."));
  return out.join("");
}

// ---------- Landlord ----------

export function landlordHtml(d, lot) {
  if (!d.registration) {
    return p(lot.hpd ? "<strong>No HPD registration on file.</strong>" : "<strong>No HPD records for this building.</strong> There’s no registration on file.") +
      note("Owners must register with HPD every year if the building has 3 or more apartments, or is a 1–2 family home where neither the owner nor their family lives.");
  }
  const r = d.registration;
  const out = [p(r.expired
    ? `<strong>Registration expired ${date(r.end)}.</strong> Last registered ${date(r.last)} (registration ID ${escape(r.id)}).`
    : `Registered with HPD through ${date(r.end)}. Last registered ${date(r.last)} (registration ID ${escape(r.id)}).`)];
  if (d.contacts.length) {
    out.push(sub("Who’s on the registration"));
    out.push(list(d.contacts.map((c) => row(escape(c.name), escape(c.label)))));
    out.push(note("As the owner listed them with HPD. A company owner is often an LLC set up for this one building."));
  }
  if (r.count > 1) out.push(note(`This lot has ${r.count} registrations (one per building); the most recent is shown.`));
  return out.join("");
}
