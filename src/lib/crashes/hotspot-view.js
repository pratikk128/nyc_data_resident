/*
 * NYC Crash Hotspots: the summary from /api/crash-hotspots/summary turned
 * into what the page says — the stat cards, "What to watch for here", the
 * breakdowns and the time patterns. Pure and browser-safe; hotspot-render.js
 * writes the HTML.
 */
import { DIMENSIONS } from "./facts.js";
import { count, percent } from "../format.js";

// "What to watch for" takes a kind of crash only with at least MIN_LOCAL crashes here
// and at least MIN_RATIO × its share in the area compared with (DESIGN.md §7, small counts).
export const WATCH = { minLocal: 5, minRatio: 1.5, max: 4 };

// Groups that describe most crashes anywhere, so being common here says nothing to act on.
const NOT_WATCHED = new Set(["maneuvers:straight", "vehicles:sedan", "vehicles:suv", "who:occupant"]);

/*
 * One practical line per kind of crash, for "What to watch for". Plain and
 * factual: what to expect there, not a lecture.
 */
export const TIPS = {
  "who:pedestrian": "Expect people crossing, including mid-block. Drivers: slow down and scan the crosswalk before you turn.",
  "who:cyclist": "Check mirrors and blind spots before you turn or open a door. Riding: stay visible and use the bike lane where there is one.",
  "who:e-rider": "E-bikes and mopeds move faster than they look. Give them room and look twice before you turn or pull out.",
  "who:motorcyclist": "Motorcycles are easy to miss. Look twice before changing lanes or turning left.",
  "causes:distracted": "Most of these crashes start with someone not looking. Keep your eyes up, phone away.",
  "causes:yield": "People here often don’t wait their turn. Make eye contact before you go, on foot or behind the wheel.",
  "causes:tailgating": "Traffic here stops suddenly. Leave more room ahead than feels necessary.",
  "causes:speeding": "Speed is what turns a crash into a serious one. NYC’s limit is 25 mph unless a sign says otherwise.",
  "causes:red-light": "Lights and stop signs get run here. Look both ways even on a green.",
  "causes:lane": "Expect cars to cut in. Signal early and check your blind spot.",
  "causes:turning": "Turns go wrong here. Take them slowly and watch for people crossing.",
  "causes:backing": "Back up slowly and look behind you: kids and cyclists are hard to see.",
  "causes:impaired": "Alcohol or drugs show up in these reports more than usual, mostly late at night.",
  "causes:aggressive": "Aggressive driving shows up here more than usual. Let them pass; don’t engage.",
  "causes:inexperience": "New drivers crash here more than usual. Give learners room.",
  "causes:drowsy-ill": "Drivers who fell asleep or fell ill show up here more than usual. Pull over if you’re tired.",
  "causes:road": "Slippery pavement, glare or blocked views show up in these reports. Slow down where you can’t see far.",
  "causes:ped-error": "People here often cross against the light or mid-block. Expect them.",
  "causes:defect": "Brake, tire and steering failures show up here more than usual.",
  "maneuvers:left-turn": "Left turns are where drivers meet people crossing. Wait for a clear crosswalk, then turn slowly.",
  "maneuvers:right-turn": "Before turning right, check for cyclists on your right and people in the crosswalk.",
  "maneuvers:u-turn": "U-turns end in crashes here more than usual. Go around the block instead.",
  "maneuvers:lane-change": "Lane changes and merges go wrong here. Signal early and check mirrors and blind spots.",
  "maneuvers:backing": "Back up slowly and look behind you: kids and cyclists are hard to see.",
  "maneuvers:stop-go": "Traffic here stops and starts suddenly. Leave room ahead.",
  "maneuvers:parking": "Look back before you open a car door, and watch for cars pulling out of spots.",
  "maneuvers:wrong-way": "Vehicles going the wrong way or fleeing police show up here more than usual.",
  "vehicles:truck": "Trucks have big blind spots. If you can’t see the driver in their mirror, they can’t see you.",
  "vehicles:bus": "Give buses room as they pull in and out of stops.",
  "vehicles:taxi": "Expect sudden stops and pickups at the curb.",
  "vehicles:motorcycle": "Motorcycles are easy to miss. Look twice before changing lanes or turning left.",
  "vehicles:moped": "Mopeds move faster than they look. Give them room.",
  "vehicles:e-bike": "E-bikes move faster than they look. Look twice before you turn or open a door.",
  "vehicles:e-scooter": "E-scooters are small and quick. Look twice before you turn or open a door.",
  "vehicles:bike": "Check for cyclists before you turn or open a door.",
  "vehicles:pickup": "Pickups have high hoods and blind spots up front. Make eye contact before crossing in front of one.",
  "vehicles:van": "Vans block the view of what’s behind them. Watch for people stepping out from behind parked ones."
};

const an = (word) => (/^(?:[aeiou]|suv)/i.test(word) ? "An" : "A");

// How a kind of crash reads as a headline: "Pedestrians hurt", "Speeding", "A vehicle turning left", "A truck involved".
export function groupTitle(column, group) {
  if (column === "who") return `${group.label} hurt`;
  if (column === "maneuvers") return `A vehicle ${group.label.toLowerCase()}`;
  if (column === "vehicles") {
    const name = group.key === "suv" ? "SUV" : group.label.charAt(0).toLowerCase() + group.label.slice(1);
    return `${an(name)} ${name} involved`;
  }
  return group.label;
}

// 0.314 → "31%", 0.042 → "4.2%", 0.0004 → "<0.1%"
export const pct = (share) => (share > 0 && share < 0.001 ? "<0.1%" : percent(share, share >= 0.1 || share === 0 ? 0 : 1));

// "2.1×", or words when it's close
export function ratioText(ratio) {
  if (!Number.isFinite(ratio)) return "much higher";
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×`;
}

const ksiOf = (t) => t.killed + t.serious;
const share = (n, of) => (of ? n / of : 0);

/*
 * → [{ name, label, value, context }] for StatCard-like cards.
 * summary.compare (an area's borough, or NYC for a borough) adds the comparison lines.
 */
export function statCards(summary) {
  const { here, compare, compareTo } = summary;
  const days = Math.max(1, daysCovered(summary));
  const hurtShare = share(here.hurtCrashes, here.crashes);
  const ksiShare = share(here.ksiCrashes, here.crashes);
  const vs = (local, base, fmt) => (compare && compare.crashes ? ` ${fmt(local, base)} across ${compareTo.label}.` : "");
  return [
    {
      name: "crashes", label: "Crashes reported", value: count(here.crashes),
      context: here.crashes >= days ? `About ${count(here.crashes / days)} a day.` : `About ${count((here.crashes / days) * 7)} a week.`
    },
    {
      name: "hurt", label: "People hurt", value: count(here.injured),
      context: `${pct(hurtShare)} of crashes hurt someone.${vs(hurtShare, share(compare?.hurtCrashes, compare?.crashes), (_, b) => `vs ${pct(b)}`)}`
    },
    {
      name: "ksi", label: "Killed or seriously hurt", value: count(ksiOf(here)),
      context: `${count(here.killed)} killed, ${count(here.serious)} seriously hurt.`
    },
    {
      name: "ksi-rate", label: "Crashes that seriously hurt or killed someone",
      value: here.ksiCrashes ? `1 in ${count(here.crashes / here.ksiCrashes)}` : "None",
      context: compare && compare.ksiCrashes && here.ksiCrashes
        ? rateLine(ksiShare, share(compare.ksiCrashes, compare.crashes), compareTo.label)
        : here.crashes ? `${pct(ksiShare)} of crashes.` : ""
    }
  ];
}

function rateLine(local, base, where) {
  const ratio = local / base;
  if (ratio >= 0.9 && ratio <= 1.1) return `About the same as across ${where} (1 in ${count(1 / base)}).`;
  return `${ratioText(ratio)} the rate across ${where} (1 in ${count(1 / base)}).`;
}

// Days from the start of the range through the newest crash.
export function daysCovered({ dateFrom, dataThrough }) {
  if (!dateFrom || !dataThrough) return 365;
  return Math.round((Date.parse(`${dataThrough}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 864e5) + 1;
}

/*
 * The kinds of crash that make up a clearly bigger share here than across
 * the area compared with, biggest gap first. Kinds already filtered on are
 * left out (every crash shown has them).
 * → [{ id, column, key, title, n, ksi, share, baseShare, ratio, tip }]
 */
export function watchFor(summary, filters = {}) {
  const { here, compare } = summary;
  if (!compare || !compare.crashes || !here.crashes) return [];
  const items = [];
  for (const d of DIMENSIONS) {
    if (filters[d.param]?.length) continue;
    for (const g of d.groups) {
      const id = `${d.column}:${g.key}`;
      if (NOT_WATCHED.has(id)) continue;
      const { n, ksi } = here.groups[d.column][g.key];
      if (n < WATCH.minLocal) continue;
      const s = n / here.crashes, base = compare.groups[d.column][g.key].n / compare.crashes;
      const ratio = base ? s / base : Infinity;
      if (ratio < WATCH.minRatio) continue;
      items.push({ id, column: d.column, key: g.key, title: groupTitle(d.column, g), n, ksi, share: s, baseShare: base, ratio, tip: TIPS[id] ?? null });
    }
  }
  return items.sort((a, b) => (b.share - b.baseShare) - (a.share - a.baseShare) || b.ratio - a.ratio).slice(0, WATCH.max);
}

/*
 * One dimension's groups, most common first, with the comparison share.
 * → [{ key, label, n, ksi, share, baseShare }] (groups with no crashes here left out)
 */
export function breakdown(summary, column) {
  const d = DIMENSIONS.find((x) => x.column === column);
  const { here, compare } = summary;
  return d.groups
    .map((g) => {
      const { n, ksi } = here.groups[column][g.key];
      return { key: g.key, label: g.label, n, ksi, share: share(n, here.crashes),
        baseShare: compare ? share(compare.groups[column][g.key].n, compare.crashes) : null };
    })
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
}

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`;

/*
 * summary.hours → a 7 × 24 grid of { n, ksi } (Monday first), its busiest
 * cell, and the busiest stretch in words.
 */
export function hourGrid(hours) {
  const grid = DAYS.map(() => Array.from({ length: 24 }, () => ({ n: 0, ksi: 0 })));
  for (const [dow, hour, n, ksi] of hours) grid[dow][hour] = { n, ksi };
  let max = 0, peak = null;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (grid[d][h].n > max) { max = grid[d][h].n; peak = { dow: d, hour: h }; }
  return { grid, max, peak };
}

// The hour of the day with the most crashes, all days together → "5 pm" or null.
export function busiestHour(hours) {
  const byHour = Array(24).fill(0);
  for (const [, hour, n] of hours) byHour[hour] += n;
  const max = Math.max(...byHour);
  return max ? hourLabel(byHour.indexOf(max)) : null;
}

// "2026-03" → "Mar 2026"
export function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// Rows → CSV text (values quoted when needed).
export function toCsv(header, rows) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

// The filters in words, for chart subtitles and the summary line: "pedestrians hurt · speeding · night".
export function filtersText(filters, { SEVERITIES, TIMES }) {
  const parts = [];
  for (const d of DIMENSIONS) {
    const keys = filters[d.param] ?? [];
    if (keys.length) parts.push(d.groups.filter((g) => keys.includes(g.key)).map((g) => groupTitle(d.column, g).toLowerCase()).join(" or "));
  }
  if (filters.sev && filters.sev !== "all") parts.push(SEVERITIES.find((s) => s.key === filters.sev).label.toLowerCase());
  if (filters.time?.length) parts.push(TIMES.filter((t) => filters.time.includes(t.key)).map((t) => t.label.toLowerCase()).join(" or "));
  return parts.join(" · ");
}
