/*
 * Number and date formatting shared by server-rendered markup and
 * client-side chart scripts. Money is always rounded: $1.2B, $85K.
 */

export function money(value, digits = 1) {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}$${trim((abs / 1e9).toFixed(digits))}B`;
  if (abs >= 1e6) return `${sign}$${trim((abs / 1e6).toFixed(digits))}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

// "30.0" → "30", but keep "30.4"
function trim(str) {
  return str.replace(/\.0+$/, "");
}

export function count(value) {
  return Math.round(value).toLocaleString("en-US");
}

export function percent(fraction, digits = 1) {
  return `${(fraction * 100).toFixed(digits)}%`;
}

// "2026-10-27" → "Oct 27, 2026" (parsed as a calendar date, no timezone shift)
export function date(iso) {
  if (!iso) return "unknown";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC"
  });
}

// "2026-10-27" → "Oct 27"
export function shortDate(iso) {
  return date(iso).replace(/, \d{4}$/, "");
}

const NYC_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

// The calendar date in New York, as YYYY-MM-DD. NYC Open Data dates are New
// York local time, so "today" follows New York's day, not UTC's: after 8 pm
// in New York (7 pm in winter) UTC is already on tomorrow.
export function nycToday(now = new Date()) {
  return NYC_DATE.format(now);
}
