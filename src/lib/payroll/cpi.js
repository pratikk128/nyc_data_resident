/*
 * NYC-area consumer prices, for showing payroll in inflation-adjusted dollars.
 *
 * Series CUURS12ASA0 from the Bureau of Labor Statistics: CPI-U, all items,
 * New York-Newark-Jersey City, not seasonally adjusted, monthly. Each fiscal
 * year's index is the average of its months (July to June), so FY2026 uses
 * July 2025 through June 2026. BLS skipped some months (October 2025, during
 * the federal shutdown), so a year with a month or two missing averages the
 * rest.
 *
 * Pure apart from the global fetch (there in both Workers and Node), so the
 * cron and the refresh script share it through buildPayroll().
 */
export const CPI_SERIES = "CUURS12ASA0";
const BLS_API = "https://api.bls.gov/publicAPI/v1/timeseries/data/";
const MAX_YEARS_PER_REQUEST = 10; // BLS v1 limit (no key needed)
const MIN_MONTHS = 10;             // fewer, and the fiscal year gets no index

export const CPI_SOURCE = {
  series: CPI_SERIES,
  name: "Consumer Price Index for All Urban Consumers (CPI-U), New York-Newark-Jersey City",
  url: `https://data.bls.gov/timeseries/${CPI_SERIES}`
};

/*
 * Monthly values for calendar years firstYear..lastYear:
 * [{ year: 2025, month: 7, value: 351.2 }]. Months BLS hasn't published are
 * simply missing.
 */
export async function fetchNycCpi(firstYear, lastYear) {
  const months = [];
  for (let start = firstYear; start <= lastYear; start += MAX_YEARS_PER_REQUEST) {
    const end = Math.min(lastYear, start + MAX_YEARS_PER_REQUEST - 1);
    const res = await fetch(BLS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesid: [CPI_SERIES], startyear: String(start), endyear: String(end) })
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from BLS`);
    const body = await res.json();
    if (body.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS: ${body.status} ${(body.message ?? []).join(" ")}`);
    for (const d of body.Results?.series?.[0]?.data ?? []) {
      // M13 is the annual average; skip it and anything that isn't a number.
      const month = Number(d.period?.slice(1));
      const value = Number(d.value);
      if (/^M(0[1-9]|1[0-2])$/.test(d.period) && Number.isFinite(value)) months.push({ year: Number(d.year), month, value });
    }
  }
  return months;
}

/*
 * index: { "2014": 255.123, ... }, the average of each fiscal year's months.
 * short: { "2026": 11 }, fiscal years averaged over fewer than 12 months.
 * missing: fiscal years with fewer than MIN_MONTHS months, left out of index.
 */
export function cpiByFiscalYear(months, fiscalYears) {
  const index = {};
  const short = {};
  const missing = [];
  for (const fy of fiscalYears) {
    const values = months
      .filter((m) => (m.year === fy - 1 && m.month >= 7) || (m.year === fy && m.month <= 6))
      .map((m) => m.value);
    if (values.length < MIN_MONTHS) {
      missing.push(fy);
      continue;
    }
    index[fy] = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3));
    if (values.length < 12) short[fy] = values.length;
  }
  return { index, short, missing };
}
