/*
 * CSV download for the payroll table, shared by the server-rendered link and
 * the agency and pay type filters (which rebuild it in the browser). With some
 * pay types filtered out, their columns are dropped and the total column sums
 * only the ones kept. Every row names the agency (or citywide) so the file
 * still makes sense once it's separated from the page.
 */

const PAY_COLUMNS = [
  ["regular", "regular_pay"],
  ["overtime", "overtime_pay"],
  ["other", "other_pay"]
];

export const CITYWIDE_LABEL = "All agencies (citywide)";

// Quote fields with commas or quotes, e.g. "Borough President, Bronx".
const field = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function payrollCsvHref(years, payTypes = PAY_COLUMNS.map(([key]) => key), agencyLabel = CITYWIDE_LABEL) {
  const columns = PAY_COLUMNS.filter(([key]) => payTypes.includes(key));
  const allPay = columns.length === PAY_COLUMNS.length;
  const csv = [
    ["agency", "fiscal_year", ...columns.map(([, name]) => name), allPay ? "total_pay" : "selected_pay_total", "active_june_30", "people_paid"].join(","),
    ...years.map((y) => [
      field(agencyLabel),
      y.fiscalYear,
      ...columns.map(([key]) => y[key]),
      allPay ? y.total : columns.reduce((sum, [key]) => sum + y[key], 0),
      y.activeJune30,
      y.peoplePaid
    ].join(","))
  ].join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv + "\n")}`;
}
