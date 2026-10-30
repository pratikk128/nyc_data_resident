/*
 * HTML for the street closures page: block cards, the purpose bars, the
 * closures-per-day strip and the most affected streets. Browser-safe; every
 * value from the data goes through escape().
 */
import { boroughLabel, METERS_PER_MILE } from "./config.js";
import { describePurpose, groupLabel } from "./purposes.js";
import { streetLabel } from "./streets.js";
import { mergeSpans } from "./closures.js";
import { queryToParams } from "./filter.js";
import { date, count } from "../format.js";

export const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

// "Oct 22 – Nov 9, 2026"; the year once when both ends share it.
export function rangeLabel(start, end) {
  if (start === end) return date(start);
  const first = date(start);
  return start.slice(0, 4) === end.slice(0, 4) ? `${first.replace(/, \d{4}$/, "")} – ${date(end)}` : `${first} – ${date(end)}`;
}

// "Murray Street between Broadway and Church Street, Manhattan"
export function blockTitle(b) {
  const on = streetLabel(b.on);
  const from = streetLabel(b.from), to = streetLabel(b.to);
  const where = from && to && from !== to ? ` between ${from} and ${to}` : from || to ? ` at ${from || to}` : "";
  const boro = boroughLabel(b.boro);
  return `${on}${where}${boro ? `, ${boro}` : ""}`;
}

// "3 days left", "Starts tomorrow", ...
export function timingText(status, today) {
  if (status.state === "active") {
    const started = status.span.start === today ? "Starts today · " : "";
    const left = status.daysLeft === 0 ? "Last day today" : status.daysLeft === 1 ? "Ends tomorrow" : `${count(status.daysLeft)} days left`;
    return started + left;
  }
  return status.startsIn === 1 ? "Starts tomorrow" : `Starts in ${count(status.startsIn)} days`;
}

// Status chips: words first, the color only helps. Nearly every block is
// active, so "Active now" would be on almost every card; the dates line says
// how long it has left, and the chips flag what stands out.
export function chips(status) {
  const out = [];
  if (status.state === "soon") out.push(["soon", "Starts soon"]);
  else if (status.state === "later") out.push(["later", "Upcoming"]);
  if (status.endingSoon) out.push(["ending", "Ending soon"]);
  if (status.longRunning) out.push(["long", "Long-running"]);
  return out;
}

export const milesText = (meters) => {
  const mi = meters / METERS_PER_MILE;
  return mi < 0.1 ? "Under 0.1 mi away" : `${mi.toFixed(1)} mi away`;
};

const purposeLabels = (permits) => [...new Set(permits.map((p) => describePurpose(p.purpose).label))];

export function cardHtml(b, today) {
  const s = b.status;
  const spans = mergeSpans(b.permits).filter((x) => x.end >= today);
  const chipsHtml = chips(s).map(([tone, text]) => `<span class="scl-chip" data-tone="${tone}">${text}</span>`).join("");
  const dist = b.meters != null ? `<span class="scl-dist">${milesText(b.meters)}</span>` : "";
  const top = chipsHtml || dist ? `<div class="scl-card-top">${chipsHtml}${dist}</div>` : "";
  const dates = spans.map((x) => rangeLabel(x.start, x.end)).join("; ");
  const permitList = b.permits.length > 1 ? `
    <details class="scl-permits">
      <summary>${plural(b.permits.length, "permit")} on this block</summary>
      <ul>${b.permits.map((p) => `<li><span class="scl-permit-dates">${rangeLabel(p.start, p.end)}</span> ${escape(describePurpose(p.purpose).label)}</li>`).join("")}</ul>
    </details>` : "";
  return `<li class="scl-card" data-seg="${escape(b.seg)}" data-state="${s.state}">
    ${top}
    <h3 class="scl-card-title"><button type="button" class="scl-locate" data-locate="${escape(b.seg)}" aria-label="${escape(blockTitle(b))}, show on map">${escape(blockTitle(b))}</button></h3>
    <p class="scl-card-dates"><strong>${dates}</strong> · ${timingText(s, today)}</p>
    <p class="scl-card-purpose">${purposeLabels(b.inView ?? b.permits).map(escape).join("; ")}</p>
    ${permitList}
  </li>`;
}

// "What's the work?": one bar per purpose group, a button that filters by it.
export function purposeBarsHtml(counts, selected) {
  if (!counts.length) return '<p class="scl-empty-small">No closures to break down.</p>';
  const max = Math.max(...counts.map((c) => c.blocks));
  return `<ul class="scl-bars">${counts.map((c) => `
    <li><button type="button" class="scl-bar-btn" data-purpose="${c.group}" aria-pressed="${c.group === selected}">
      <span class="scl-bar-label">${escape(groupLabel(c.group))}</span>
      <span class="scl-bar-track"><span class="scl-bar" style="width:${Math.max(2, (c.blocks / max) * 100).toFixed(1)}%"></span></span>
      <span class="scl-bar-value">${count(c.blocks)}</span>
    </button></li>`).join("")}</ul>`;
}

const dayLabel = (iso) => date(iso).replace(/, \d{4}$/, "");

// Days after the latest posted start date: DOT hasn't posted all their permits yet.
const unposted = (d, postedThrough) => Boolean(postedThrough) && d.day > postedThrough;

/*
 * Blocks closed each day, as columns. The days in the picked window are
 * darker; days after `postedThrough` are hatched, since closures starting
 * then aren't posted yet. data-i lets the page show a day's count on hover;
 * the table under it is the non-chart version. The strip takes focus so the
 * arrow keys can step through the days.
 */
export function stripHtml(days, range, postedThrough) {
  const max = Math.max(1, ...days.map((d) => d.blocks));
  const inWindow = (d) => d.day >= range.from && (range.to == null || d.day <= range.to);
  const cols = days.map((d, i) => {
    const h = d.blocks ? Math.max(3, (d.blocks / max) * 100) : 0;
    // Today, then each month's 1st (unless it's too close to today's label to fit).
    const tick = i === 0 ? "Today" : d.day.endsWith("-01") && i >= 7 ? dayLabel(d.day) : "";
    const month = tick ? `<span class="scl-strip-tick">${tick}</span>` : "";
    const cls = `${inWindow(d) ? " is-in" : ""}${unposted(d, postedThrough) ? " is-unposted" : ""}`;
    return `<span class="scl-strip-col${cls}" data-i="${i}"><span class="scl-strip-bar" style="height:${h.toFixed(1)}%"></span>${month}</span>`;
  }).join("");
  const rows = days.map((d) => `<tr><th scope="row">${date(d.day)}</th><td>${count(d.blocks)}${unposted(d, postedThrough) ? " (not all posted yet)" : ""}</td></tr>`).join("");
  const partial = unposted(days[days.length - 1], postedThrough) ? `; days after ${date(postedThrough)} aren't fully posted yet` : "";
  const keys = ". Left and right arrow keys read each day";
  return `<div class="scl-strip" role="img" tabindex="0" aria-label="Closed blocks per day from ${date(days[0].day)} to ${date(days[days.length - 1].day)}: from ${count(Math.min(...days.map((d) => d.blocks)))} to ${count(max)} a day${partial}${keys}">${cols}</div>
    <details class="scl-table-toggle"><summary>View as table</summary>
      <div class="table-scroll"><table><thead><tr><th scope="col">Day</th><th scope="col">Closed blocks</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>`;
}

export const stripReadout = (d, postedThrough) =>
  `${date(d.day)}: ${plural(d.blocks, "block")} closed${unposted(d, postedThrough) ? " so far (not all posted yet)" : ""}`;

// Under the tabs when the window runs past the latest posted start, or null.
export function postedNote(range, postedThrough) {
  if (!postedThrough || (range.to != null && range.to <= postedThrough)) return null;
  return `DOT posts permits shortly before work starts. The latest one posted starts ${date(postedThrough)}, so closures starting after that aren’t listed yet.`;
}

// The streets with the most closed blocks; each links to that street's view.
export function topStreetsHtml(streets, query) {
  if (!streets.length) return '<p class="scl-empty-small">No closed streets in this view.</p>';
  const max = streets[0].blocks;
  return `<ol class="scl-top">${streets.map((s) => {
    const boro = s.boros.length === 1 ? s.boros[0] : null;
    const href = `?${queryToParams({ ...query, mode: "street", street: s.key, boro, lat: null, lon: null })}`;
    const where = s.boros.map(boroughLabel).filter(Boolean).join(", ");
    return `<li><a href="${escape(href)}" data-street="${escape(s.key)}" data-boro="${boro ?? ""}">
      <span class="scl-top-name">${escape(s.label)}<span class="scl-top-boro">${escape(where)}</span></span>
      <span class="scl-bar-track"><span class="scl-bar" style="width:${((s.blocks / max) * 100).toFixed(1)}%"></span></span>
      <span class="scl-bar-value">${plural(s.blocks, "block")}</span></a></li>`;
  }).join("")}</ol>`;
}

// "on or crossing West 8th Street in Brooklyn", "within 0.5 mile of your location", ...
export function placeText(query, label) {
  if (query.mode === "near") return `within ${query.r === 1 ? "1 mile" : `${query.r} mile`} of ${label || "the spot you picked"}`;
  if (query.mode === "street") return `on or crossing ${streetLabel(query.street)}${query.boro ? ` in ${boroughLabel(query.boro)}` : ""}`;
  if (query.mode === "borough") return `in ${boroughLabel(query.boro)}`;
  return "across all five boroughs";
}
