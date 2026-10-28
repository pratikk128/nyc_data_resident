/*
 * CSV download for the payroll table, shared by the server-rendered link and
 * the agency filter (which rebuilds it in the browser).
 */

export function payrollCsvHref(years) {
  const csv = [
    "fiscal_year,regular_pay,overtime_pay,other_pay,total_pay,people_paid",
    ...years.map((y) => [y.fiscalYear, y.regular, y.overtime, y.other, y.total, y.peoplePaid].join(","))
  ].join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv + "\n")}`;
}
