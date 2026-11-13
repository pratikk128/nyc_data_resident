/*
 * NYC Crash Hotspots: HTML for the parts of the page the script fills in,
 * from hotspot-view.js's results. Pure strings, every value escaped; the
 * component (src/components/crash-hotspots/CrashHotspots.astro) puts them in place.
 */
import { pct, ratioText } from "./hotspot-view.js";
import { boroughLabel } from "../complaints311/config.js";
import { count } from "../format.js";

export const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function statCardsHtml(cards) {
  return cards.map((c) => `<div class="stat-card" data-stat="${escape(c.name)}">
    <p class="stat-label">${escape(c.label)}</p>
    <p class="stat-value">${escape(c.value)}</p>
    ${c.context ? `<p class="stat-context">${escape(c.context)}</p>` : ""}
  </div>`).join("");
}

// "24 of 61 crashes here (39%) vs 26% across Brooklyn"
const evidence = (p, compareLabel, where = "here") =>
  `${count(p.n)} of ${count(p.of)} crashes ${where} (${pct(p.share)})${compareLabel ? ` vs ${pct(p.baseShare)} across ${compareLabel}` : ""}`;

/*
 * "What to watch for here": one card per kind of crash, tip first, the
 * numbers behind it under. `common` stands in when nothing stands out.
 */
export function watchHtml(items, { compareLabel, areaLabel, enough, common }) {
  if (!enough) {
    return `<p class="hs-empty">Too few crashes ${escape(areaLabel ? `at ${areaLabel}` : "here")} to say what goes wrong. Try a bigger area, or a street instead of one corner.</p>`;
  }
  if (!items.length && !common) {
    return `<p class="hs-empty">Nothing stands out: crashes here look like crashes across ${escape(compareLabel)}. That’s not the same as safe; the numbers above still apply.</p>`;
  }
  const card = (w, lead) => `<li class="hs-watch">
    <p class="hs-watch-kicker">${escape(lead)}</p>
    <h3 class="hs-watch-title">${escape(w.title)}</h3>
    ${w.tip ? `<p class="hs-watch-tip">${escape(w.tip)}</p>` : ""}
    <p class="hs-watch-stat">${escape(evidence(w, lead === "Most common here" ? null : compareLabel))}${w.fatal ? `. ${escape(count(w.fatal))} killed someone` : ""}.</p>
  </li>`;
  if (!items.length) {
    return `<p class="hs-watch-none">Nothing here is clearly more common than across ${escape(compareLabel)}, but one thing comes up often:</p>
      <ul class="hs-watch-list">${card(common, "Most common here")}</ul>`;
  }
  const lead = (w) => (Number.isFinite(w.ratio) ? `${ratioText(w.ratio)} as common as across ${compareLabel}` : `Rare across ${compareLabel}, common here`);
  return `<ul class="hs-watch-list">${items.map((w) => card(w, lead(w))).join("")}</ul>`;
}

/*
 * The dangerous intersections: a numbered card each (the number matches the
 * map), with its counts, what goes wrong there and the tip for it.
 */
export function spotsHtml(spots, { victim = "someone", shown = 5 } = {}) {
  if (!spots.length) return `<p class="hs-empty">No intersection here had a crash that hurt ${escape(victim)} more than once. Good news, or a small area: try a bigger one.</p>`;
  const item = (c, i) => {
    const [street, cross] = c.label.split(" & ");
    const f = c.findings[0] ?? c.common;
    const boro = boroughLabel(c.borough) ?? "";
    const what = c.findings.length
      ? c.findings.map((x) => `<li><strong>${escape(x.title)}</strong>: ${escape(`${count(x.n)} of ${count(x.of)} crashes, vs ${pct(x.baseShare)} across ${boro || "NYC"}`)}</li>`).join("")
      : c.common ? `<li><strong>${escape(c.common.title)}</strong>: ${escape(`${count(c.common.n)} of ${count(c.common.of)} crashes`)}</li>` : "";
    return `<li class="hs-spot"${i >= shown ? " data-extra hidden" : ""}>
      <span class="hs-spot-num" aria-hidden="true">${i + 1}</span>
      <div class="hs-spot-body">
        <h3 class="hs-spot-name"><span class="sr-only">${i + 1}. </span>${escape(c.label)}</h3>
        <p class="hs-spot-boro">${escape(boro)}</p>
        <p class="hs-spot-counts"><strong>${escape(count(c.hurt))}</strong> crash${c.hurt === 1 ? "" : "es"} hurt ${escape(victim)}${
          c.fatal ? ` · <strong class="hs-spot-fatal">${escape(count(c.fatal))}</strong> killed someone` : ""} · ${escape(count(c.n))} in all</p>
        ${what ? `<p class="hs-spot-label">${c.findings.length ? "What goes wrong here" : "Most common here"}</p><ul class="hs-spot-what">${what}</ul>` : `<p class="hs-spot-label">No one pattern stands out here.</p>`}
        ${f?.tip ? `<p class="hs-spot-tip">${escape(f.tip)}</p>` : ""}
        <p class="hs-spot-actions">
          <button type="button" class="cl-link-btn" data-corner-street="${escape(street)}" data-corner-cross="${escape(cross ?? "")}" data-corner-boro="${escape(c.borough ?? "")}">Look closer</button>
          ${c.lat != null ? `<button type="button" class="cl-link-btn" data-spot-map="${i}">Show on map</button>` : ""}
        </p>
      </div>
    </li>`;
  };
  const more = spots.length - shown;
  return `<ol class="hs-spots">${spots.map(item).join("")}</ol>${more > 0
    ? `<button type="button" class="hs-more-btn" data-more-spots aria-expanded="false">Show ${more} more</button>` : ""}`;
}
