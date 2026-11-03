/*
 * SoQL for the Building Report Card: one function per section, each →
 * { name: { dataset, params } }, the queries that section runs in parallel.
 * Counting happens on Socrata ($select count(*) … $group); detail lists are
 * capped with $limit. Pure, so the tests check the query text.
 *
 * lot: { bbl, boro, block, lot, bins } (bblParts() plus the lot's BINs).
 * today: "YYYY-MM-DD" in New York (format.js nycToday()).
 */
import { DATASETS, WORK_DONE, HYGIENE_COMPLAINTS, HYGIENE_WORDS } from "./config.js";

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const q = (key, params) => ({ dataset: DATASETS[key].id, params });

// The same day a year earlier: the start of every "last 12 months".
export function yearAgo(today) {
  const [y, m, d] = today.split("-").map(Number);
  const back = new Date(Date.UTC(y - 1, m - 1, d));
  return back.toISOString().slice(0, 10);
}

// Every bbl filter, by how the dataset stores it.
const bblText = (lot) => `bbl = ${quote(lot.bbl)}`;
const bblNumber = (lot) => `bbl = ${Number(lot.bbl)}`;
const binsIn = (lot) => `bin in (${lot.bins.map(quote).join(", ")})`;

export function violationsQueries(lot, today) {
  const where = bblText(lot);
  const open = `${where} AND violationstatus = 'Open'`;
  return {
    openByClass: q("violations", { $select: "class, count(*) AS n", $where: open, $group: "class" }),
    issued12: q("violations", { $select: "count(*) AS n", $where: `${where} AND novissueddate >= ${quote(yearAgo(today))}` }),
    byYear: q("violations", {
      $select: "date_extract_y(novissueddate) AS year, count(*) AS n",
      $where: `${where} AND novissueddate IS NOT NULL`, $group: "year", $order: "year"
    }),
    // A plain "novissueddate DESC" puts the undated rows first and takes Socrata
    // 20–50 seconds; NULL LAST with a tiebreaker comes back in about one.
    recentOpen: q("violations", {
      $select: "violationid, class, novissueddate, inspectiondate, novdescription, apartment, story, currentstatus",
      $where: open, $order: "novissueddate DESC NULL LAST, violationid DESC", $limit: "10"
    }),
    ever: q("violations", { $select: "count(*) AS n", $where: where })
  };
}

// Rows are problems; a complaint can have several. Months count complaints, categories count problems.
export function complaintsQueries(lot, today) {
  const where = bblNumber(lot);
  // The chart and the total count from the same day, so the bars add up to it.
  const since = yearAgo(today);
  return {
    byMonth: q("complaints", {
      $select: "date_trunc_ym(received_date) AS month, count(distinct complaint_id) AS n",
      $where: `${where} AND received_date >= ${quote(since)}`, $group: "month", $order: "month"
    }),
    last12: q("complaints", {
      $select: "count(distinct complaint_id) AS n",
      $where: `${where} AND received_date >= ${quote(since)}`
    }),
    topCategories: q("complaints", {
      $select: "major_category, count(*) AS n",
      $where: `${where} AND received_date >= ${quote(since)}`,
      $group: "major_category", $order: "n DESC", $limit: "8"
    }),
    ever: q("complaints", { $select: "count(distinct complaint_id) AS n", $where: where })
  };
}

/*
 * Pests, mold and garbage: the open violations whose text names one (sorted
 * by kind in summarize.js), and the last 12 months' complaints about them.
 * Complaint rows are problems: types count problems, the total complaints.
 * everViolations and everComplaints: whether HPD has any record of the lot at all.
 */
export function hygieneQueries(lot, today) {
  const words = HYGIENE_WORDS.map((w) => `novdescription like ${quote(`%${w}%`)}`).join(" OR ");
  const complaints = `${bblNumber(lot)} AND received_date >= ${quote(yearAgo(today))} AND ` +
    `minor_category in (${HYGIENE_COMPLAINTS.map(quote).join(", ")})`;
  return {
    openViolations: q("violations", {
      $select: "violationid, class, novissueddate, novdescription, apartment",
      $where: `${bblText(lot)} AND violationstatus = 'Open' AND (${words})`,
      $order: "novissueddate DESC NULL LAST, violationid DESC", $limit: "1000"
    }),
    complaintTypes: q("complaints", {
      $select: "minor_category, problem_code, count(*) AS n",
      $where: complaints, $group: "minor_category, problem_code", $order: "n DESC"
    }),
    complaints12: q("complaints", { $select: "count(distinct complaint_id) AS n", $where: complaints }),
    everViolations: q("violations", { $select: "count(*) AS n", $where: bblText(lot) }),
    everComplaints: q("complaints", { $select: "count(*) AS n", $where: bblNumber(lot) })
  };
}

// Every filing (a building files once a year, sometimes more than once for the same year).
export function bedbugsQueries(lot) {
  return {
    filings: q("bedbugs", {
      $select: "building_id, bin, of_dwelling_units, infested_dwelling_unit_count, eradicated_unit_count, " +
        "re_infested_dwelling_unit, filing_date, filing_period_start_date, filling_period_end_date",
      $where: bblText(lot), $order: "filing_period_start_date DESC, filing_date DESC", $limit: "60"
    })
  };
}

export function flagsQueries(lot) {
  return {
    vacate: q("vacate", {
      $select: "vacate_order_number, vacate_type, primary_vacate_reason, vacate_effective_date, actual_rescind_date, number_of_vacated_units",
      $where: bblNumber(lot), $order: "vacate_effective_date DESC NULL LAST", $limit: "20"
    }),
    aep: q("aep", {
      $select: "current_status, aep_start_date, discharge_date, aep_round, of_b_c_violations_at_start",
      $where: bblNumber(lot), $order: "aep_start_date DESC NULL LAST", $limit: "5"
    }),
    pendingCases: q("litigation", { $select: "count(*) AS n", $where: `${bblText(lot)} AND casestatus = 'PENDING'` })
  };
}

export function courtQueries(lot) {
  return {
    cases: q("litigation", {
      $select: "litigationid, casetype, caseopendate, casestatus, casejudgement, findingofharassment, findingdate, penalty",
      $where: bblText(lot), $order: "caseopendate DESC NULL LAST, litigationid DESC", $limit: "25"
    }),
    total: q("litigation", { $select: "count(*) AS n", $where: bblText(lot) })
  };
}

// Grouped by outcome: orders where the work got done count toward the dollars (summarize.js).
export function repairsQueries(lot) {
  return {
    omo: q("omo", {
      $select: "omostatusreason AS reason, count(*) AS n, sum(omoawardamount) AS amount, max(omocreatedate) AS latest",
      $where: bblText(lot), $group: "omostatusreason"
    }),
    hwo: q("hwo", {
      $select: "hwostatusreason AS reason, count(*) AS n, sum(chargeamount) AS amount, max(hwocreatedate) AS latest",
      $where: bblText(lot), $group: "hwostatusreason"
    })
  };
}

export const workDone = (reason) => WORK_DONE.includes(reason);

// Registrations have no bbl column: borough, block and lot as numbers.
export function registrationQuery(lot) {
  return q("registrations", {
    $select: "registrationid, buildingid, bin, lastregistrationdate, registrationenddate",
    $where: `boroid = ${lot.boro} AND block = ${lot.block} AND lot = ${lot.lot}`,
    $order: "lastregistrationdate DESC NULL LAST", $limit: "10"
  });
}

// Names and roles only: no contact addresses are asked for.
export function contactsQuery(registrationIds) {
  return q("contacts", {
    $select: "registrationid, type, corporationname, firstname, lastname",
    $where: `registrationid in (${registrationIds.map(Number).join(", ")})`,
    $limit: "100"
  });
}

/*
 * DOB complaints' date_entered is text ("07/09/2026"), so SoQL can't compare
 * it as a date: this asks for this year's and last year's (small for one
 * building) and summarize.js keeps the last 12 months.
 */
export function dobQueries(lot, today) {
  const year = Number(today.slice(0, 4));
  const bins = binsIn(lot);
  return {
    complaints: q("dobComplaints", {
      $select: "complaint_number, status, date_entered, complaint_category",
      $where: `${bins} AND (date_entered like '%/${year}' OR date_entered like '%/${year - 1}')`,
      $limit: "2000"
    }),
    activeComplaints: q("dobComplaints", { $select: "count(*) AS n", $where: `${bins} AND status = 'ACTIVE'` }),
    ecbBySeverity: q("ecb", {
      $select: "severity, count(*) AS n",
      $where: `${bins} AND ecb_violation_status = 'ACTIVE'`, $group: "severity"
    }),
    // Penalties still owed, open or not: a resolved violation can still carry a balance.
    ecbBalance: q("ecb", { $select: "sum(balance_due) AS due, count(*) AS n", $where: `${bins} AND balance_due > 0` }),
    ecbRecent: q("ecb", {
      $select: "ecb_violation_number, issue_date, severity, violation_type, violation_description, balance_due",
      $where: `${bins} AND ecb_violation_status = 'ACTIVE'`, $order: "issue_date DESC NULL LAST, ecb_violation_number DESC", $limit: "5"
    })
  };
}

// ---------- The lot ----------

export function lotQueries(bbl, parts) {
  return {
    pluto: {
      params: {
        $select: "bbl, address, borough, zipcode, unitsres, unitstotal, numbldgs, bldgclass, yearbuilt, latitude, longitude",
        $where: `bbl = ${quote(bbl)}`, $limit: "1"
      }
    },
    // Condo buildings sit on a billing lot (75xx): base_bbl is the building's own lot, mappluto_bbl the billing one.
    footprints: {
      params: {
        $select: "bin, base_bbl, mappluto_bbl, last_status_type",
        $where: `base_bbl = ${quote(bbl)} OR mappluto_bbl = ${quote(bbl)}`, $limit: "100"
      }
    },
    hpdBuildings: {
      params: {
        $select: "buildingid, bin, housenumber, streetname, legalclassa, legalclassb, recordstatus, lifecycle",
        $where: `boroid = ${quote(parts.boro)} AND block = ${quote(parts.block)} AND lot = ${quote(parts.lot)}`,
        $limit: "50"
      }
    }
  };
}

// ---------- The owner's other buildings ----------

/*
 * Owner names from one registration's contacts → the contacts on every
 * other registration with the same names. keys: ownerKeys() in
 * summarize.js, a company owner by its name, a person (head officer,
 * individual or joint owner) by first and last name. Both sides upper-cased:
 * HPD has names in capitals and in mixed case.
 */
export const OWNER_TYPES = ["CorporateOwner", "HeadOfficer", "IndividualOwner", "JointOwner"];
const PERSON_TYPES = OWNER_TYPES.filter((t) => t !== "CorporateOwner");

export function ownerMatchQuery(keys) {
  const byName = keys.map((k) => k.kind === "company"
    ? `(type = 'CorporateOwner' AND upper(corporationname) = ${quote(k.company)})`
    : `(type in (${PERSON_TYPES.map(quote).join(", ")}) AND upper(firstname) = ${quote(k.first)} AND upper(lastname) = ${quote(k.last)})`);
  return q("contacts", {
    $select: "registrationid, type, corporationname, firstname, lastname",
    $where: byName.join(" OR "),
    $order: "registrationid DESC", $limit: "5000"
  });
}

// `in (…)` lists in pieces short enough for a URL.
export const IN_CHUNK = 150;
export function chunks(values, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

// Only registrations filed since `since`: an owner who sold years ago is still on the old one.
export function portfolioRegistrationsQueries(registrationIds, since) {
  return chunks(registrationIds).map((ids) => q("registrations", {
    $select: "registrationid, buildingid, boroid, block, lot, housenumber, streetname, lastregistrationdate",
    $where: `registrationid in (${ids.map(Number).join(", ")}) AND lastregistrationdate >= ${quote(since)}`,
    $limit: "5000"
  }));
}

export function portfolioViolationsQueries(bbls) {
  return chunks(bbls).map((list) => q("violations", {
    $select: "bbl, class, count(*) AS n",
    $where: `bbl in (${list.map(quote).join(", ")}) AND violationstatus = 'Open'`,
    $group: "bbl, class", $limit: "5000"
  }));
}

// Apartments per building, from HPD's building list (as the lot's header counts them).
export function portfolioUnitsQueries(buildingIds) {
  return chunks(buildingIds).map((ids) => ({
    params: {
      $select: "buildingid, legalclassa, legalclassb, recordstatus",
      $where: `buildingid in (${ids.map(Number).join(", ")})`, $limit: "5000"
    }
  }));
}
