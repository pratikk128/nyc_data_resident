/*
 * CSV download for the payroll table, shared by the server-rendered link and
 * the agency and pay type filters (which rebuild it in the browser). With some
 * pay types filtered out, their columns are dropped and the total column sums
 * only the ones kept. Every row names the agency (or citywide) so the file
 * still makes sense once it's separated from the page. The last two columns
 * restate the total in the latest fiscal year's dollars and give the CPI
 * used (cpi is byYear.cpi; see payroll-inflation.js).
 */
import { inflationFactor } from "./payroll-inflation.js";

const PAY_COLUMNS = [
  ["regular", "regular_pay"],
  ["overtime", "overtime_pay"],
  ["other", "other_pay"]
];

export const CITYWIDE_LABEL = "All agencies (citywide)";

// Quote fields with commas or quotes, e.g. "Borough President, Bronx". One
// starting with = + - @ (a formula to a spreadsheet) gets a leading apostrophe.
const field = (value) => {
  const s = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function payrollCsvHref(years, cpi, payTypes = PAY_COLUMNS.map(([key]) => key), agencyLabel = CITYWIDE_LABEL) {
  const columns = PAY_COLUMNS.filter(([key]) => payTypes.includes(key));
  const allPay = columns.length === PAY_COLUMNS.length;
  const totalName = allPay ? "total_pay" : "selected_pay_total";
  const csv = [
    ["agency", "fiscal_year", ...columns.map(([, name]) => name), totalName, "active_june_30", "people_paid",
      `${totalName}_in_fy${cpi.baseFiscalYear}_dollars`, "nyc_cpi_fiscal_year_avg"].join(","),
    ...years.map((y) => {
      const total = allPay ? y.total : columns.reduce((sum, [key]) => sum + y[key], 0);
      const factor = inflationFactor(cpi, y.fiscalYear);
      return [
        field(agencyLabel),
        y.fiscalYear,
        ...columns.map(([key]) => y[key]),
        total,
        y.activeJune30,
        y.peoplePaid,
        factor === null ? "" : Math.round(total * factor),
        cpi.index[y.fiscalYear] ?? ""
      ].join(",");
    })
  ].join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv + "\n")}`;
}
