/*
 * CSV download for the payroll table, shared by the server-rendered link and
 * the agency and pay type filters (which rebuild it in the browser). With some
 * pay types filtered out, their columns are dropped and the total column sums
 * only the ones kept.
 */

const PAY_COLUMNS = [
  ["regular", "regular_pay"],
  ["overtime", "overtime_pay"],
  ["other", "other_pay"]
];

export function payrollCsvHref(years, payTypes = PAY_COLUMNS.map(([key]) => key)) {
  const columns = PAY_COLUMNS.filter(([key]) => payTypes.includes(key));
  const allPay = columns.length === PAY_COLUMNS.length;
  const csv = [
    ["fiscal_year", ...columns.map(([, name]) => name), allPay ? "total_pay" : "selected_pay_total", "people_paid"].join(","),
    ...years.map((y) => [
      y.fiscalYear,
      ...columns.map(([key]) => y[key]),
      allPay ? y.total : columns.reduce((sum, [key]) => sum + y[key], 0),
      y.peoplePaid
    ].join(","))
  ].join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv + "\n")}`;
}
