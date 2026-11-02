/*
 * NYC Crash Hotspots: HTML for the parts of the page the script fills in,
 * from hotspot-view.js's results. Pure strings, every value escaped; the
 * component (src/components/crash-hotspots/CrashHotspots.astro) puts them in place.
 */
import { CAUSES } from "./facts.js";
import { pct, ratioText, DAYS, hourLabel, monthLabel } from "./hotspot-view.js";
import { escape } from "./render.js";
import { MIN_CORNER_CRASHES } from "./hotspot-sql.js";
import { boroughLabel } from "../complaints311/config.js";
import { count } from "../format.js";

export { escape };

export function statCardsHtml(cards) {
  return cards.map((c) => `<div class="stat-card" data-stat="${escape(c.name)}">
    <p class="stat-label">${escape(c.label)}</p>
    <p class="stat-value">${escape(c.value)}</p>
    ${c.context ? `<p class="stat-context">${escape(c.context)}</p>` : ""}
  </div>`).join("");
}

// "What to watch for here": one card per kind of crash, or a line saying nothing stands out.
export function watchHtml(items, { compareLabel, areaLabel, enough }) {
  if (!enough) {
    return `<p class="hs-empty">Too few crashes ${escape(areaLabel ? `at ${areaLabel}` : "here")} with these filters to say what stands out. Try a bigger area or fewer filters.</p>`;
  }
  if (!items.length) {
    return `<p class="hs-empty">Nothing stands out: the kinds of crash here are about as common as across ${escape(compareLabel)}. That’s not the same as safe; the numbers above still apply.</p>`;
  }
  return `<ul class="hs-watch-list">${items.map((w) => `<li class="hs-watch">
    <h3 class="hs-watch-title">${escape(w.title)}</h3>
    <p class="hs-watch-stat"><strong>${escape(pct(w.share))}</strong> of crashes here vs ${escape(pct(w.baseShare))} across ${escape(compareLabel)}
      <span class="hs-ratio">(${escape(ratioText(w.ratio))})</span></p>
    <p class="hs-watch-count">${escape(count(w.n))} crash${w.n === 1 ? "" : "es"}${w.ksi ? `, ${escape(count(w.ksi))} of them seriously hurt or killed someone` : ""}.</p>
    ${w.tip ? `<p class="hs-watch-tip">${escape(w.tip)}</p>` : ""}
  </li>`).join("")}</ul>`;
}

const causeLabel = (key) => CAUSES.find((c) => c.key === key)?.label ?? "—";

// The intersections table's body rows; each row's button focuses the page on that corner.
export function cornerRowsHtml(rows) {
  if (!rows.length) return `<tr><td colspan="6" class="hs-none">No intersection here has ${MIN_CORNER_CRASHES} or more crashes with these filters.</td></tr>`;
  return rows.map((r, i) => {
    const [street, cross] = r.label.split(" & ");
    return `<tr>
      <td>${i + 1}</td>
      <th scope="row"><button type="button" class="cl-link-btn hs-corner-btn" data-corner-street="${escape(street)}" data-corner-cross="${escape(cross ?? "")}" data-corner-boro="${escape(r.borough ?? "")}">${escape(r.label)}</button>
        <span class="hs-corner-boro">${escape(boroughLabel(r.borough) ?? "")}</span></th>
      <td>${escape(count(r.n))}</td>
      <td>${escape(count(r.injured))}</td>
      <td>${escape(count(r.ksi))}</td>
      <td class="hs-cause">${escape(r.topCause ? causeLabel(r.topCause) : "—")}</td>
    </tr>`;
  }).join("");
}

/*
 * When crashes happen: a 7 × 24 table, each cell shaded by its share of the
 * busiest one (and its count in the cell's label, for screen readers and hover).
 */
export function hourGridHtml({ grid, max }) {
  const head = `<tr><th scope="col"><span class="sr-only">Day</span></th>${Array.from({ length: 24 }, (_, h) =>
    `<th scope="col" class="hs-hour-head">${h % 3 === 0 ? escape(hourLabel(h)) : `<span class="sr-only">${escape(hourLabel(h))}</span>`}</th>`).join("")}</tr>`;
  const body = grid.map((row, d) => `<tr><th scope="row">${DAYS[d]}</th>${row.map((c, h) => {
    const level = max ? c.n / max : 0;
    const text = `${DAYS[d]} ${hourLabel(h)}: ${count(c.n)} crash${c.n === 1 ? "" : "es"}${c.ksi ? `, ${count(c.ksi)} serious or fatal` : ""}`;
    return `<td style="--level:${level.toFixed(3)}" title="${escape(text)}"><span class="sr-only">${escape(text)}</span></td>`;
  }).join("")}</tr>`).join("");
  return `<table class="hs-hours"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// Crashes per month as bars, the ones that seriously hurt or killed someone as a number under each.
export function monthsHtml(months) {
  const max = Math.max(1, ...months.map((m) => m[1]));
  return `<ol class="hs-months">${months.map(([ym, n, , ksi]) => `<li class="hs-month">
    <span class="hs-month-n">${escape(count(n))}</span>
    <span class="hs-month-bar" style="--h:${(n / max).toFixed(3)}" aria-hidden="true"></span>
    <span class="hs-month-label">${escape(monthLabel(ym).replace(" 20", " ’"))}</span>
    <span class="sr-only">${escape(`${monthLabel(ym)}: ${count(n)} crashes, ${count(ksi)} serious or fatal`)}</span>
  </li>`).join("")}</ol>`;
}

export function monthsTableHtml(months) {
  return `<table><thead><tr><th scope="col">Month</th><th scope="col">Crashes</th><th scope="col">Someone hurt</th><th scope="col">Seriously hurt or killed</th></tr></thead>
    <tbody>${months.map(([ym, n, hurt, ksi]) => `<tr><th scope="row">${escape(monthLabel(ym))}</th><td>${escape(count(n))}</td><td>${escape(count(hurt))}</td><td>${escape(count(ksi))}</td></tr>`).join("")}</tbody></table>`;
}

/*
 * One dimension's breakdown: a bar per group (its share of crashes here),
 * with a tick at its share in the area compared with.
 */
export function breakdownHtml(rows, { compareLabel, limit = 8 }) {
  if (!rows.length) return `<p class="hs-none">No crashes with these filters.</p>`;
  const max = Math.max(...rows.map((r) => Math.max(r.share, r.baseShare ?? 0)), 0.0001);
  const item = (r) => `<li class="hs-bar-row">
    <span class="hs-bar-label">${escape(r.label)}</span>
    <span class="hs-bar-value">${escape(pct(r.share))} <span class="hs-bar-n">(${escape(count(r.n))})</span></span>
    <span class="hs-bar-track" aria-hidden="true"><span class="hs-bar" style="--w:${(r.share / max).toFixed(3)}"></span>${
      r.baseShare != null ? `<span class="hs-bar-tick" style="--x:${(r.baseShare / max).toFixed(3)}"></span>` : ""}</span>
    ${r.baseShare != null ? `<span class="sr-only">${escape(`vs ${pct(r.baseShare)} across ${compareLabel}`)}</span>` : ""}
  </li>`;
  const shown = rows.slice(0, limit), rest = rows.slice(limit);
  return `<ul class="hs-bars">${shown.map(item).join("")}</ul>${rest.length
    ? `<details class="hs-more"><summary>${rest.length} more</summary><ul class="hs-bars">${rest.map(item).join("")}</ul></details>` : ""}`;
}

export function breakdownTableHtml(rows, compareLabel) {
  return `<table><thead><tr><th scope="col">Kind</th><th scope="col">Crashes</th><th scope="col">Share</th>${compareLabel ? `<th scope="col">Share across ${escape(compareLabel)}</th>` : ""}<th scope="col">Seriously hurt or killed</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${escape(r.label)}</th><td>${escape(count(r.n))}</td><td>${escape(pct(r.share))}</td>${compareLabel ? `<td>${escape(pct(r.baseShare ?? 0))}</td>` : ""}<td>${escape(count(r.ksi))}</td></tr>`).join("")}</tbody></table>`;
}
