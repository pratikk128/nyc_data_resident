/*
 * The history subsection's data: every complete month from the first to the
 * latest complete one (gaps included, as null), the E. coli detections by
 * month, and the table/CSV rows. A month still loading is left out. Built on the server from the monthly and detections jobs and
 * handed to the chart script as JSON.
 */
import { nextMonth, hasEcoli, isResample, completeMonths } from "./stats.js";

export function historySeries(monthly, detections = []) {
  const have = completeMonths(monthly);
  const byMonth = new Map(have.map((m) => [m.month, m]));
  const months = [];
  if (have.length) {
    const last = have[have.length - 1].month;
    for (let k = have[0].month; k <= last; k = nextMonth(k)) months.push(k);
  }
  // Every E. coli detection in those months, any sample class, for the list.
  const ecoli = {};
  for (const d of detections.filter(hasEcoli)) {
    const k = d.date.slice(0, 7);
    if (k >= months[0] && k <= months[months.length - 1]) (ecoli[k] ??= []).push(d);
  }
  // Routine E. coli counts come from the monthly job, like the samples they're
  // out of; resample positives are counted separately.
  const rows = months.map((k) => {
    const m = byMonth.get(k);
    return {
      month: k,
      samples: m?.n ?? 0,
      coliTested: m?.coli.n ?? 0,
      coliPositive: m?.coli.pos ?? 0,
      ecoliPositive: m?.ecoli.pos ?? 0,
      ecoliResample: (ecoli[k] ?? []).filter((d) => isResample(d.sampleClass)).length,
      chlorineMedian: m?.cl.med ?? null
    };
  });
  return { months, ecoli, rows };
}

const pctText = (share) => (share == null ? "" : (share * 100).toFixed(2));

// rows: from historySeries; ecoliResample null when the detections didn't load.
export function historyCsvHref(rows) {
  const csv = [
    "month,routine_samples,coliform_tested,coliform_positive,coliform_positive_pct,ecoli_positive,ecoli_positive_resamples,median_free_chlorine_mg_l",
    ...rows.map((r) => [
      r.month, r.samples, r.coliTested, r.coliPositive,
      pctText(r.coliTested ? r.coliPositive / r.coliTested : null), r.ecoliPositive, r.ecoliResample ?? "", r.chlorineMedian ?? ""
    ].join(","))
  ].join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv + "\n")}`;
}
