/*
 * HTML for the near-me station cards (plain strings, drawn by the section
 * script): each leads with the street description and a one-line verdict,
 * then the comparison sentences. Sparklines are drawn into the
 * [data-spark] slots after the HTML is inserted (charts.js).
 */
import { monthLabel, isResample, sharePct, tileStatus, STATUS_TEXT, STATUS_ICON } from "./stats.js";
import { measurementText, isDetected } from "./parse.js";
import { boroughLabel, REFERENCES as R, TILE_THRESHOLDS } from "./config.js";
import { count, date } from "../format.js";

export const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const fmt2 = (v) => (v == null ? "–" : String(Number(Number(v).toFixed(2))));

/*
 * "A bit lower than the citywide median (0.52 vs. 0.66 mg/L)." Within 10% (or
 * 0.05) counts as about the same.
 */
export function compareText(here, city, unit) {
  if (here == null || city == null) return "Not enough results to compare.";
  const diff = here - city;
  const close = Math.abs(diff) <= Math.max(0.05, Math.abs(city) * 0.1);
  const words = close ? "About the same as" : diff > 0 ? "Higher than" : "Lower than";
  return `${words} the citywide median (${fmt2(here)} vs. ${fmt2(city)} ${unit}).`;
}

/*
 * What the comparison means, from this station's samples (totals over the window):
 * "Any detectable amount up to 4 mg/L is normal, higher or lower; 99.6% of samples here were in that range."
 */
export function meaningText(kind, ok, n) {
  if (!n) return "";
  const share = sharePct(ok, n);
  return kind === "cl"
    ? `Any detectable amount up to ${R.chlorine.max} mg/L is normal, higher or lower; ${share} of samples here were in that range.`
    : `Lower is clearer: ${share} of samples here were under the state’s ${R.turbidity.max} NTU standard.`;
}

const RANK = { none: 0, green: 1, amber: 2, red: 3 };
const samplesText = (k) => `${count(k)} ${k === 1 ? "sample" : "samples"}`;

/*
 * The card's one-line answer, like the report card's verdict, from the
 * station's totals and detections: { status, text }, or null with no samples.
 * E. coli makes it amber at least; the rest use the report card's thresholds.
 */
export function stationVerdict(details) {
  const t = details?.totals;
  if (!t?.n) return null;
  const ecoli = (t.ecoliPos ?? 0) + details.detections.filter((d) => isResample(d.sampleClass) && isDetected(d.ecoli)).length;
  const share = (ok, n) => (n ? ok / n : null);
  const checks = {
    ecoli: ecoli ? "amber" : t.coliN ? "green" : "none",
    coliform: tileStatus(share(t.coliN - t.coliPos, t.coliN)),
    chlorine: tileStatus(share(t.clOk, t.clN)),
    cloudiness: tileStatus(share(t.turbOk, t.turbN))
  };
  const status = Object.values(checks).reduce((a, s) => (RANK[s] > RANK[a] ? s : a), "none");

  const bacteria = !t.coliN ? "No bacteria results"
    : ecoli ? `E. coli in ${samplesText(ecoli)}, details below`
    : t.coliPos ? `No E. coli; coliform in ${count(t.coliPos)} of ${samplesText(t.coliN)}`
    : "No bacteria found";
  const off = ["chlorine", "cloudiness"].filter((k) => checks[k] === "amber" || checks[k] === "red");
  const water = off.length
    ? `${off.join(" and ")} out of range in more than ${Math.round((1 - TILE_THRESHOLDS.green) * 100)}% of samples`
    : "chlorine and cloudiness normal";
  return { status, text: `${STATUS_TEXT[status]}. ${bacteria}; ${water}.` };
}

export function bacteriaHtml(details, range) {
  const t = details.totals;
  const found = details.detections;
  if (!t?.coliN) return `<p>No bacteria results for ${escape(range)}.</p>`;
  if (!found.length) {
    return `<p><strong>None found.</strong> No coliform or E. coli in ${count(t.coliN)} ` +
      `${t.coliN === 1 ? "sample" : "samples"} (${escape(range)}).</p>`;
  }
  const items = found.map((d) => {
    const parts = [];
    if (isDetected(d.ecoli)) parts.push(`<strong>E. coli ${escape(measurementText(d.ecoli))}</strong>`);
    if (isDetected(d.coliform)) parts.push(`coliform ${escape(measurementText(d.coliform))}`);
    return `<li>${escape(date(d.date))}: ${parts.join(", ")} MPN/100 mL${isResample(d.sampleClass) ? " (resample)" : ""}</li>`;
  }).join("");
  // t counts routine samples; the list also has resamples, so they're counted alongside.
  const resamples = found.filter((d) => isResample(d.sampleClass)).length;
  const inResamples = resamples ? `${t.coliPos ? " and" : ", but"} in ${count(resamples)} ${resamples === 1 ? "resample" : "resamples"}` : "";
  return `<p>Found in ${t.coliPos ? count(t.coliPos) : "none"} of ${count(t.coliN)} routine samples${inResamples} (${escape(range)}). ` +
    `Each positive sample is followed up with repeat samples.</p><ul class="water-detections">${items}</ul>`;
}

/*
 * station: { site, place, borough, miles? }  details: one entry of the API's stations.
 * ctx: { months, cityTotals, index }
 */
export function stationCardHtml(station, details, ctx) {
  const range = `${monthLabel(ctx.months[0], "short")}–${monthLabel(ctx.months[ctx.months.length - 1], "short")}`;
  const t = details?.totals;
  const head =
    `<header class="water-card-head">` +
      `<span class="water-pin water-pin-inline" aria-hidden="true"><span>${ctx.index + 1}</span></span>` +
      `<div><h3 class="water-card-title">${escape(station.place || `Station ${station.site}`)}</h3>` +
      `<p class="water-card-meta">Station ${escape(station.site)} · ${escape(boroughLabel(station.borough))}` +
        `${station.miles != null ? ` · ${station.miles < 0.1 ? "under 0.1" : station.miles.toFixed(1)} mi away` : ""}</p></div>` +
      `<button type="button" class="water-remove" data-remove="${escape(station.site)}" aria-label="Remove station ${escape(station.site)}">Remove</button>` +
    `</header>`;
  if (!t?.n) {
    return `<article class="water-card">${head}<p class="water-empty">No routine samples here in ${escape(range)}. ` +
      `This station may have been retired or paused.</p></article>`;
  }
  const c = ctx.cityTotals;
  const v = stationVerdict(details);
  return (
    `<article class="water-card">${head}` +
      (v ? `<p class="water-card-verdict" data-status="${v.status}">` +
        `<span class="water-status-icon" aria-hidden="true">${STATUS_ICON[v.status]}</span>${escape(v.text)}</p>` : "") +
      `<div class="water-metric">` +
        `<h4 class="water-h4">Bacteria</h4>` +
        bacteriaHtml(details, range) +
      `</div>` +
      `<div class="water-metric">` +
        `<h4 class="water-h4">Chlorine (mg/L)</h4>` +
        `<div class="water-spark-slot" data-spark="cl"></div>` +
        `<p>${escape(compareText(t.clMed, c?.clMed, "mg/L"))} ${escape(meaningText("cl", t.clOk, t.clN))}</p>` +
      `</div>` +
      `<div class="water-metric">` +
        `<h4 class="water-h4">Cloudiness (NTU)</h4>` +
        `<p>${escape(compareText(t.turbMed, c?.turbMed, "NTU"))} ${escape(meaningText("turb", t.turbOk, t.turbN))}</p>` +
      `</div>` +
    `</article>`
  );
}

export function cardSkeletonHtml() {
  return `<article class="water-card is-skeleton" aria-hidden="true"><span class="sk-line"></span><span class="sk-line sk-short"></span><div class="sk-block"></div></article>`;
}
