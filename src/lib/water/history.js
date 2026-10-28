/*
 * The history page's data: every month from the first to the last (gaps
 * included, as null), the two charted series, the E. coli months, and the
 * table/CSV rows. Built on the server from the monthly and detections jobs and
 * handed to the chart script as JSON.
 */
import { nextMonth, hasEcoli } from "./stats.js";

export function historySeries(monthly, detections = []) {
  const byMonth = new Map(monthly.months.map((m) => [m.month, m]));
  const months = [];
  if (monthly.months.length) {
    const last = monthly.months[monthly.months.length - 1].month;
    for (let k = monthly.months[0].month; k <= last; k = nextMonth(k)) months.push(k);
  }
  const coliform = {}, chlorine = {};
  for (const k of months) {
    const m = byMonth.get(k);
    coliform[k] = m?.coli.n ? m.coli.pos / m.coli.n : null;
    chlorine[k] = m?.cl.med ?? null;
  }
  // E. coli markers come from every sample class, so a resample positive shows too.
  const ecoli = {};
  for (const d of detections.filter(hasEcoli)) {
    const k = d.date.slice(0, 7);
    (ecoli[k] ??= []).push(d);
  }
  const rows = months.map((k) => {
    const m = byMonth.get(k);
    return {
      month: k,
      samples: m?.n ?? 0,
      coliTested: m?.coli.n ?? 0,
      coliPositive: m?.coli.pos ?? 0,
      ecoliPositive: ecoli[k]?.length ?? 0,
      chlorineMedian: m?.cl.med ?? null
    };
  });
  return { months, coliform, chlorine, ecoli, rows };
}

const pctText = (share) => (share == null ? "" : (share * 100).toFixed(2));

export function historyCsvHref(rows) {
  const csv = [
    "month,routine_samples,coliform_tested,coliform_positive,coliform_positive_pct,ecoli_positive_all_classes,median_free_chlorine_mg_l",
    ...rows.map((r) => [
      r.month, r.samples, r.coliTested, r.coliPositive,
      pctText(r.coliTested ? r.coliPositive / r.coliTested : null), r.ecoliPositive, r.chlorineMedian ?? ""
    ].join(","))
  ].join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv + "\n")}`;
}
