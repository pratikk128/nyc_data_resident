/*
 * The shortlist CSV: one row per business, with what a contractor or agency
 * buyer needs to reach a firm and count it toward M/WBE goals. Built on the
 * server from cleanVendor() records (the full rows, read live by id), in the
 * order given. Pure, so the tests cover it.
 */
import { CERTS, CERT_ORDER } from "./config.js";
import { addressLines } from "./render.js";

// Quote fields with commas, quotes or line breaks. A field starting with
// = + - @ (a formula to a spreadsheet) gets a leading apostrophe, since the
// names and descriptions are written by the businesses.
export function csvField(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  ["business_name", (v) => v.dba || v.name],
  ["legal_name", (v) => v.name],
  ["certifications", (v) => CERT_ORDER.filter((c) => v.certs?.includes(c)).join(" ")],
  ["certifications_long", (v) => CERT_ORDER.filter((c) => v.certs?.includes(c)).map((c) => CERTS[c].long).join("; ")],
  ["cert_renewal_date", (v) => (v.renewals ?? []).at(-1) ?? ""],
  ["owner_ethnicity", (v) => (v.certs?.includes("MBE") && v.ethnicity !== "Non-minority" ? v.ethnicity : "")],
  ["naics_code", (v) => v.naics],
  ["naics_title", (v) => v.title],
  ["naics_sector", (v) => v.sector],
  ["nigp_codes", (v) => (v.nigp ?? []).join(" ")],
  ["bonding_limit", (v) => v.bonding],
  ["largest_contract", (v) => v.largestContract],
  ["union_contracts", (v) => v.union],
  ["passport_enrolled", (v) => (v.passport ? "yes" : "")],
  ["established", (v) => v.established],
  ["contact", (v) => v.contact],
  ["phone", (v) => v.phone?.display],
  ["website", (v) => v.website],
  ["address", (v) => addressLines(v).join(", ")],
  ["borough", (v) => v.borough],
  ["sbs_account_number", (v) => v.id]
];

export function vendorsCsv(vendors) {
  const lines = [
    COLUMNS.map(([name]) => name).join(","),
    ...vendors.map((v) => COLUMNS.map(([, get]) => csvField(get(v))).join(","))
  ];
  return `${lines.join("\r\n")}\r\n`;
}

// "357418,12345" → ["357418", "12345"]: account numbers, each once, up to max.
export function parseIds(value, max) {
  return [...new Set(String(value ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{1,12}$/.test(s)))].slice(0, max);
}
