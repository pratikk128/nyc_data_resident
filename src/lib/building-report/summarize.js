/*
 * Socrata rows → what each Building Report Card section shows. The server
 * runs these on the results of soql.js's queries and sends the browser only
 * the summary. Pure, so the tests cover the counting rules:
 *   - bedbugs: a building can file more than once for the same filing period;
 *     the latest filing is the one that counts
 *   - DOB complaints: date_entered is text, filtered to the last 12 months here
 *   - city repairs: OMO and HWO combined; dollars only on orders where the work got done
 *   - "ever": whether HPD has any record at all, so an empty section can say
 *     "No HPD records" instead of looking spotless
 */
import { CLASSES, CONTACT_ROLES, COMPLAINT_CATEGORIES, BOROUGH_NAMES, dobCategoryLabel } from "./config.js";
import { yearAgo, workDone } from "./soql.js";
import { titleCase } from "../restaurants/inspections.js";

const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const day = (v) => (v ? String(v).slice(0, 10) : null);
const firstN = (rows) => num(rows?.[0]?.n);

// "07/09/2026" → "2026-07-09"
export function dobDate(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text ?? "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// "20260711" → "2026-07-11"
export function ecbDate(text) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(text ?? "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/*
 * HPD's violation text starts with the law it cites ("§ 27-2005, 27-2007 HMC …:
 * REPLACE OR REPAIR …") and is in capitals. → the order itself, in sentence
 * case, keeping codes like "A2" or "LL11" in capitals.
 */
export function plainViolation(text) {
  let s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.startsWith("§")) {
    const colon = s.indexOf(":");
    const code = /\b(ADM CODE|HMC|MDL)\b\s*[-–:]?\s*(?=[A-Z])/.exec(s);
    if (colon > 0 && s.length - colon > 20) s = s.slice(colon + 1);
    else if (code) s = s.slice(code.index + code[0].length);
  }
  s = s.trim().toLowerCase()
    .replace(/\b[a-z]*\d[a-z0-9]*\b/g, (w) => (/^\d+(st|nd|rd|th)$/.test(w) ? w : w.toUpperCase()))
    .replace(/\bi\b/g, "I")
    .replace(/([.!?]\s+)([a-z])/g, (_, gap, c) => gap + c.toUpperCase());
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

// ---------- The lot ----------

/*
 * pluto, footprints, hpdBuildings: rows from lotQueries(). → null when no
 * dataset knows the lot, else
 *   { bbl, boro, block, lot, borough, address, zip, lat, lon, units, unitsSource,
 *     buildings, bldgClass, yearBuilt, bins, hpd }
 * hpd: true when HPD lists a building on the lot (HPD's jurisdiction: rentals with
 * 3+ apartments, and some 1–2 family homes).
 */
export function summarizeLot(bbl, parts, { pluto = [], footprints = [], hpdBuildings = [] }) {
  const p = pluto[0];
  if (!p && !footprints.length && !hpdBuildings.length) return null;
  // BINs ending in 000000 are placeholders for lots without an assigned BIN.
  const bins = [...new Set([
    ...footprints.filter((f) => !/demol/i.test(f.last_status_type ?? "")).map((f) => String(f.bin ?? "")),
    ...hpdBuildings.map((b) => String(b.bin ?? ""))
  ])].filter((b) => /^[1-5]\d{6}$/.test(b) && !/^[1-5]000000$/.test(b)).sort();

  const activeHpd = hpdBuildings.filter((b) => b.recordstatus !== "Inactive");
  const hpdUnits = activeHpd.reduce((sum, b) => sum + num(b.legalclassa) + num(b.legalclassb), 0);
  const hpdAddress = activeHpd.find((b) => b.housenumber && b.streetname);
  const address = p?.address
    ? titleCase(p.address)
    : hpdAddress ? titleCase(`${hpdAddress.housenumber} ${hpdAddress.streetname}`) : null;
  const lat = Number(p?.latitude), lon = Number(p?.longitude);

  return {
    bbl,
    ...parts,
    borough: BOROUGH_NAMES[parts.boro],
    address,
    zip: p?.zipcode ?? null,
    lat: Number.isFinite(lat) && p?.latitude ? lat : null,
    lon: Number.isFinite(lon) && p?.longitude ? lon : null,
    units: hpdUnits || (p?.unitsres != null ? num(p.unitsres) : null),
    unitsSource: hpdUnits ? "hpd" : p?.unitsres != null ? "pluto" : null,
    buildings: p?.numbldgs != null ? num(p.numbldgs) : null,
    bldgClass: p?.bldgclass ?? null,
    yearBuilt: num(p?.yearbuilt) || null,
    bins,
    hpd: activeHpd.length > 0
  };
}

// "1967 Marmion Avenue, Bronx" (or the BBL when no dataset has an address)
export const lotName = (lot) => `${lot.address ?? `Lot ${lot.bbl}`}, ${lot.borough}`;

// ---------- Violations ----------

export function summarizeViolations(r, today) {
  const open = { A: 0, B: 0, C: 0, I: 0 };
  for (const row of r.openByClass ?? []) if (row.class in open) open[row.class] = num(row.n);
  const counts = new Map((r.byYear ?? []).map((row) => [Number(row.year), num(row.n)]));
  const thisYear = Number(today.slice(0, 4));
  const firstYear = Math.min(...counts.keys(), thisYear);
  const byYear = [];
  for (let y = Math.max(firstYear, thisYear - 14); y <= thisYear; y++) byYear.push({ year: y, n: counts.get(y) ?? 0 });

  return {
    ever: firstN(r.ever),
    open: { ...open, total: open.A + open.B + open.C + open.I },
    issued12: firstN(r.issued12),
    since: yearAgo(today),
    byYear,
    recent: (r.recentOpen ?? []).map((v) => ({
      id: v.violationid,
      class: v.class,
      date: day(v.novissueddate ?? v.inspectiondate),
      text: plainViolation(v.novdescription),
      apartment: v.apartment ?? null,
      status: v.currentstatus ? titleCase(v.currentstatus) : null
    }))
  };
}

export const classInfo = (key) => CLASSES.find((c) => c.key === key);

// ---------- Complaints ----------

// The 12 calendar months ending this month: ["2025-12", …, "2026-11"]
export function lastMonths(today, n = 12) {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - n + i, 1)).toISOString().slice(0, 7));
}

export function summarizeComplaints(r, today) {
  const counts = new Map((r.byMonth ?? []).map((row) => [String(row.month).slice(0, 7), num(row.n)]));
  return {
    ever: firstN(r.ever),
    last12: firstN(r.last12),
    since: yearAgo(today),
    months: lastMonths(today).map((month) => ({ month, n: counts.get(month) ?? 0 })),
    top: (r.topCategories ?? []).filter((row) => row.major_category).map((row) => ({
      key: row.major_category,
      label: COMPLAINT_CATEGORIES[row.major_category] ?? titleCase(row.major_category),
      n: num(row.n)
    }))
  };
}

// ---------- Bedbugs ----------

/*
 * Filings → one entry per filing period (Nov 1 to Oct 31), newest first,
 * summing each building's latest filing for that period.
 * → { periods: [{ start, end, filed, units, infested, eradicated, reinfested }], latest, stale }
 * stale: the newest period ended more than two years before today (no recent filing).
 */
export function summarizeBedbugs(rows, today) {
  const latest = new Map(); // "period|building" → the newest filing
  for (const f of rows ?? []) {
    const start = day(f.filing_period_start_date);
    if (!start) continue;
    const key = `${start}|${f.building_id ?? f.bin ?? ""}`;
    const prev = latest.get(key);
    if (!prev || (day(f.filing_date) ?? "") > (day(prev.filing_date) ?? "")) latest.set(key, f);
  }
  const periods = new Map();
  for (const f of latest.values()) {
    const start = day(f.filing_period_start_date);
    const p = periods.get(start) ?? { start, end: day(f.filling_period_end_date), filed: null, units: 0, infested: 0, eradicated: 0, reinfested: 0 };
    p.filed = [p.filed, day(f.filing_date)].filter(Boolean).sort().at(-1) ?? null;
    p.units += num(f.of_dwelling_units);
    p.infested += num(f.infested_dwelling_unit_count);
    p.eradicated += num(f.eradicated_unit_count);
    p.reinfested += num(f.re_infested_dwelling_unit);
    periods.set(start, p);
  }
  const list = [...periods.values()].sort((a, b) => b.start.localeCompare(a.start));
  const newest = list[0] ?? null;
  const twoYearsAgo = yearAgo(yearAgo(today));
  return { periods: list, latest: newest, stale: Boolean(newest?.end && newest.end < twoYearsAgo) };
}

// ---------- Red flags ----------

export function summarizeFlags(r) {
  const vacates = (r.vacate ?? []).map((v) => ({
    number: v.vacate_order_number,
    type: v.vacate_type ?? null,
    reason: v.primary_vacate_reason ?? null,
    date: day(v.vacate_effective_date),
    rescinded: day(v.actual_rescind_date),
    units: v.number_of_vacated_units != null ? num(v.number_of_vacated_units) : null
  }));
  const active = vacates.filter((v) => !v.rescinded);
  const aepRow = r.aep?.[0];
  const aep = aepRow ? {
    active: aepRow.current_status === "AEP Active",
    status: aepRow.current_status ?? null,
    start: day(aepRow.aep_start_date),
    discharged: day(aepRow.discharge_date),
    round: aepRow.aep_round ?? null,
    violationsAtStart: aepRow.of_b_c_violations_at_start != null ? num(aepRow.of_b_c_violations_at_start) : null
  } : null;
  const pendingCases = firstN(r.pendingCases);
  return {
    activeVacates: active,
    pastVacates: vacates.length - active.length,
    aep,
    pendingCases,
    // What the summary card calls a red flag right now; a past AEP or vacate still shows in the section.
    active: active.length > 0 || Boolean(aep?.active) || pendingCases > 0,
    any: vacates.length > 0 || Boolean(aep) || pendingCases > 0
  };
}

// ---------- Court cases ----------

export function summarizeCourt(r) {
  return {
    total: firstN(r.total),
    cases: (r.cases ?? []).map((c) => ({
      id: c.litigationid,
      type: c.casetype ?? "Case",
      opened: day(c.caseopendate),
      status: c.casestatus ? titleCase(c.casestatus).replace(/[\s-]+$/, "") : null,
      pending: c.casestatus === "PENDING",
      judgement: c.casejudgement === "YES",
      harassment: /yes/i.test(c.findingofharassment ?? "") ? true : null,
      penalty: c.penalty ?? null
    }))
  };
}

// ---------- City repairs ----------

function repairTotals(rows) {
  let orders = 0, done = 0, amount = 0, latest = null;
  for (const row of rows ?? []) {
    const n = num(row.n);
    orders += n;
    if (workDone(row.reason)) { done += n; amount += num(row.amount); }
    const d = day(row.latest);
    if (d && (!latest || d > latest)) latest = d;
  }
  return { orders, done, amount: Math.round(amount * 100) / 100, latest };
}

// → { omo, hwo, orders, done, amount, latest }: emergency repair orders, and the work the city paid for.
export function summarizeRepairs(r) {
  const omo = repairTotals(r.omo), hwo = repairTotals(r.hwo);
  return {
    omo, hwo,
    orders: omo.orders + hwo.orders,
    done: omo.done + hwo.done,
    amount: Math.round((omo.amount + hwo.amount) * 100) / 100,
    latest: [omo.latest, hwo.latest].filter(Boolean).sort().at(-1) ?? null
  };
}

// ---------- Landlord ----------

const contactName = (c) =>
  (c.corporationname?.trim() || [c.firstname, c.lastname].filter(Boolean).join(" ").trim() || null);

/*
 * registrations: newest first. A lot with several buildings can have one per
 * building; the newest stands for the lot, and contacts come from all of them.
 * → { registration: { id, last, end, expired, count } | null, contacts: [{ role, label, name }] }
 */
export function summarizeLandlord(registrations, contacts, today) {
  const reg = registrations?.[0];
  const seen = new Set();
  const people = [];
  for (const role of CONTACT_ROLES) {
    for (const c of contacts ?? []) {
      if (c.type !== role.type) continue;
      const raw = contactName(c);
      if (!raw) continue;
      // HPD has names in capitals (sometimes half: "SARPONG-APPIAh"). A company name
      // typed in mixed case ("8 Spruce (NY) Owner LLC") is kept as typed.
      const name = c.corporationname && raw.toUpperCase() !== raw ? raw : titleCase(raw);
      const key = `${role.type}|${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      people.push({ role: role.type, label: role.label, name });
    }
  }
  const end = day(reg?.registrationenddate);
  return {
    registration: reg ? {
      id: reg.registrationid,
      last: day(reg.lastregistrationdate),
      end,
      expired: Boolean(end && end < today),
      count: registrations.length
    } : null,
    contacts: people
  };
}

// ---------- DOB ----------

export function summarizeDob(r, today, bins) {
  const since = yearAgo(today);
  const recent = (r.complaints ?? []).filter((c) => (dobDate(c.date_entered) ?? "") >= since);
  const byCode = new Map();
  for (const c of recent) {
    const code = String(c.complaint_category ?? "").trim().toUpperCase();
    if (code) byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }
  const top = [...byCode].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6)
    .map(([code, n]) => ({ code, label: dobCategoryLabel(code), n }));
  const bySeverity = (r.ecbBySeverity ?? []).map((row) => ({ severity: row.severity ?? "Unknown", n: num(row.n) }))
    .sort((a, b) => b.n - a.n);
  return {
    bins,
    complaints12: recent.length,
    since,
    activeComplaints: firstN(r.activeComplaints),
    top,
    ecb: {
      open: bySeverity.reduce((s, x) => s + x.n, 0),
      bySeverity,
      due: Math.round(num(r.ecbBalance?.[0]?.due) * 100) / 100,
      dueCount: num(r.ecbBalance?.[0]?.n),
      recent: (r.ecbRecent ?? []).map((v) => ({
        number: v.ecb_violation_number,
        date: ecbDate(v.issue_date),
        severity: v.severity ?? null,
        type: v.violation_type && v.violation_type !== "Unknown" ? v.violation_type : null,
        text: plainViolation(v.violation_description),
        due: num(v.balance_due)
      }))
    }
  };
}
