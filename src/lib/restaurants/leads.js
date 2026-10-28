/*
 * Pure logic for "Restaurant leads by service type" (dataset 43nn-pn8j),
 * shared by the daily leads job, the page script and the tests. Nothing in
 * here fetches.
 *
 * The daily job turns violation rows and inspection rows into one record per
 * restaurant (buildLeads). The page then picks a business group and a window
 * and ranks those records (rankLeads). Windows count back from the latest
 * inspection date in the data, not today: DOHMH publishes with a lag.
 */
import { LEADS_CONFIG, groupsFor } from "./business-groups.js";
import {
  day, isInspected, groupInspections, closesRestaurant, titleCase, addressLine, boroLabel
} from "./inspections.js";

// ---------- Window ----------

// "2026-10-24" + n days (n may be negative), as a calendar date.
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "Last 7 days" through the reference date, inclusive: 7 calendar days.
export function windowRange(referenceDate, days) {
  return { since: addDays(referenceDate, -(days - 1)), through: referenceDate };
}

// ---------- Urgency ----------

export const TIERS = ["closed", "reinspection", "standard"];

export const TIER_LABELS = {
  closed: "Closed by DOHMH",
  reinspection: "Re-inspection likely",
  standard: "Standard"
};

// latest: { actions, types, score }, with actions from the newest inspection and
// types and score from the newest scored one. Closed when the newest inspection
// closed (or re-closed) the restaurant and didn't also reopen it. Otherwise
// re-inspection likely when an initial inspection scored at or over the
// threshold: DOHMH comes back after those, but a re-inspection that scores 14+
// gets a B or C grade instead of another visit.
export function urgencyTier(latest, { reinspectionScore = LEADS_CONFIG.reinspectionScore } = {}) {
  if (!latest) return "standard";
  if (closesRestaurant(latest.actions)) return "closed";
  const initial = (latest.types ?? []).some((t) => /initial inspection/i.test(t));
  if (initial && latest.score != null && latest.score >= reinspectionScore) return "reinspection";
  return "standard";
}

// ---------- Daily job: rows → restaurants ----------

const normalizeText = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function coord(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 1e6) / 1e6 : null;
}

/*
 * violationRows: lead violation rows in the window (see leadViolationParams).
 * inspectionRows: every inspection in the window, one row per (camis, date,
 * type, action, score, grade) (see leadInspectionParams). Score repeats on
 * every violation row, so the latest inspection comes from these, deduped by
 * camis + date with groupInspections().
 *
 * → { restaurants: [...], descriptions: { code: text } }
 */
export function buildLeads(violationRows, inspectionRows, config = LEADS_CONFIG) {
  const inspectionsByCamis = Map.groupBy(groupInspections(inspectionRows), (insp) => insp.camis);

  // The most common spelling of each code's description (some differ only in spacing).
  const spellings = new Map();
  const byCamis = new Map();
  for (const row of violationRows) {
    const code = String(row.violation_code ?? "").trim();
    if (!code || !isInspected(row) || !groupsFor(code).length) continue;
    const text = normalizeText(row.violation_description);
    const counts = spellings.get(code) ?? new Map();
    counts.set(text, (counts.get(text) ?? 0) + 1);
    spellings.set(code, counts);

    let r = byCamis.get(row.camis);
    if (!r) {
      r = { info: row, violations: new Map() };
      byCamis.set(row.camis, r);
    }
    const date = day(row.inspection_date);
    if (date > day(r.info.inspection_date)) r.info = row; // newest row has the current name and address
    // One citation per code per inspection, even when the day had two inspection types.
    const key = `${date}|${code}`;
    if (!r.violations.has(key)) r.violations.set(key, { code, date, critical: row.critical_flag === "Critical" });
  }

  const restaurants = [];
  for (const [camis, { info, violations }] of byCamis) {
    const inspections = inspectionsByCamis.get(camis) ?? [];
    const newest = inspections[0] ?? null;
    const scored = inspections.find((insp) => insp.score != null) ?? null;
    const latest = newest && {
      date: newest.date,
      type: newest.types.join(" / "),
      action: newest.actions.join(" "),
      // An inspection without a score (some administrative ones) shows the last scored one.
      score: scored?.score ?? null,
      scoreDate: scored?.date ?? null,
      grade: scored?.grade ?? null
    };
    restaurants.push({
      camis,
      name: titleCase(info.dba) || "Name not listed",
      address: addressLine(info),
      boro: boroLabel(info.boro),
      zipcode: info.zipcode ?? "",
      phone: String(info.phone ?? "").replace(/\D/g, ""),
      cuisine: info.cuisine_description ?? "",
      lat: coord(info.latitude),
      lng: coord(info.longitude),
      latest,
      tier: urgencyTier(newest && { actions: newest.actions, types: scored?.types ?? [], score: scored?.score ?? null }, config),
      violations: [...violations.values()].sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code))
    });
  }
  restaurants.sort((a, b) => a.camis.localeCompare(b.camis));

  const descriptions = {};
  for (const [code, counts] of [...spellings].sort(([a], [b]) => a.localeCompare(b))) {
    descriptions[code] = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }
  return { restaurants, descriptions };
}

// ---------- Page: one group, one window ----------

// This group's violations on or after `since`, and the rest (other service types).
export function groupStats(restaurant, groupId, since) {
  const inWindow = restaurant.violations.filter((v) => v.date >= since);
  const violations = inWindow.filter((v) => groupsFor(v.code).includes(groupId));
  const other = inWindow.filter((v) => !groupsFor(v.code).includes(groupId));
  return {
    groupViolationCount: violations.length,
    inspectionsAffected: new Set(violations.map((v) => v.date)).size,
    violations,
    other
  };
}

const TIER_ORDER = Object.fromEntries(TIERS.map((t, i) => [t, i]));

// Most violations in the group → most urgent → highest latest score → most
// recently inspected. camis last, so the order is stable.
export function compareLeads(a, b) {
  return (b.groupViolationCount - a.groupViolationCount) ||
    (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) ||
    ((b.latest?.score ?? -1) - (a.latest?.score ?? -1)) ||
    (b.latest?.date ?? "").localeCompare(a.latest?.date ?? "") ||
    a.camis.localeCompare(b.camis);
}

// Name, address or ZIP contains the text (case and spacing ignored).
export function matchesSearch(restaurant, text) {
  const q = normalizeText(text).toUpperCase();
  if (!q) return true;
  return [restaurant.name, restaurant.address, restaurant.zipcode].some((f) => normalizeText(f).toUpperCase().includes(q));
}

// Latest score at or under lowScoreMax. A restaurant with no score yet isn't low.
export function isLowScore(restaurant, { lowScoreMax = LEADS_CONFIG.lowScoreMax } = {}) {
  const score = restaurant.latest?.score;
  return score != null && score <= lowScoreMax;
}

// filters: { since, boro, search, urgentOnly, hideLowScores }. Restaurants with
// at least one violation in the group, ranked, each with its group stats and rank.
export function rankLeads(restaurants, groupId, { since, boro = "", search = "", urgentOnly = false, hideLowScores = false } = {}) {
  const leads = [];
  for (const r of restaurants) {
    if (boro && r.boro !== boro) continue;
    if (urgentOnly && r.tier === "standard") continue;
    if (hideLowScores && isLowScore(r)) continue;
    if (!matchesSearch(r, search)) continue;
    const stats = groupStats(r, groupId, since);
    if (stats.groupViolationCount) leads.push({ ...r, ...stats });
  }
  leads.sort(compareLeads);
  leads.forEach((lead, i) => { lead.rank = i + 1; });
  return leads;
}

// The summary strip for a ranked list.
export function summarizeLeads(leads) {
  return {
    restaurants: leads.length,
    violations: leads.reduce((sum, l) => sum + l.groupViolationCount, 0),
    closed: leads.filter((l) => l.tier === "closed").length,
    reinspection: leads.filter((l) => l.tier === "reinspection").length
  };
}

// ---------- Display and export ----------

// "2125551234" → "(212) 555-1234"; anything else as given.
export function formatPhone(digits) {
  const d = String(digits ?? "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return formatPhone(d.slice(1));
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}

export function mapUrl(r) {
  const query = r.lat != null && r.lng != null ? `${r.lat},${r.lng}`
    : [r.address, r.boro, "NY", r.zipcode].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Quoted when it holds a comma, quote or line break. A text cell starting with
// =, +, -, @, tab or CR would run as a formula in Excel or Sheets, so it gets a
// leading apostrophe (OWASP's CSV injection advice).
function csvCell(value) {
  let s = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "rank", "name", "address", "borough", "zipcode", "phone", "cuisine", "group_violations",
  "urgency", "latest_score", "latest_inspection", "violation_codes", "violation_descriptions"
];

// A ranked list as CSV text, one row per restaurant. descriptions: { code: text }
// from the API; each code's description goes in the same order as the codes,
// separated by " | ".
export function leadsCsv(leads, descriptions = {}) {
  const rows = leads.map((l) => {
    const codes = [...new Set(l.violations.map((v) => v.code))];
    return [
      l.rank, l.name, l.address, l.boro, l.zipcode, formatPhone(l.phone), l.cuisine, l.groupViolationCount,
      TIER_LABELS[l.tier], l.latest?.score ?? "", l.latest?.date ?? "",
      codes.join(" "), codes.map((c) => `${c}: ${descriptions[c] ?? ""}`).join(" | ")
    ].map(csvCell).join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}
