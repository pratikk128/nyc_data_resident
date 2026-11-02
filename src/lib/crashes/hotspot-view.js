/*
 * NYC Crash Hotspots: the summary from /api/crash-hotspots/summary turned
 * into what the page says: the stat cards, "What to watch for here" and, for
 * each dangerous intersection, what goes wrong there. Pure and browser-safe;
 * hotspot-render.js writes the HTML.
 */
import { DIMENSIONS } from "./facts.js";
import { modeOf } from "./hotspot-query.js";
import { count, percent } from "../format.js";

/*
 * A kind of crash is called out only with at least minLocal of them and at
 * least minRatio × its share in the borough (DESIGN.md §7, small counts):
 * WATCH for an area, CORNER for one intersection, where counts are small.
 */
export const WATCH = { minLocal: 5, minRatio: 1.5, max: 3 };
export const CORNER = { minLocal: 3, minRatio: 1.5, max: 2 };

// Groups that describe most crashes anywhere, so being common here says nothing to act on.
const NOT_WATCHED = new Set(["maneuvers:straight", "vehicles:sedan", "vehicles:suv", "who:occupant"]);

/*
 * One practical line per kind of crash, said to the person reading: walking,
 * biking or driving (MODES), or `all` when we don't know or there's no
 * line for them. Plain and factual: what to expect there, not a lecture.
 */
export const TIPS = {
  "who:pedestrian": {
    all: "People on foot get hit here more than usual. Expect people crossing, including mid-block.",
    drive: "People on foot get hit here more than usual. Slow down and scan the crosswalk before you turn."
  },
  "who:cyclist": {
    all: "Cyclists get hit here more than usual.",
    drive: "Cyclists get hit here more than usual. Check mirrors and your blind spot before you turn or open a door."
  },
  "who:e-rider": {
    all: "E-bike, e-scooter and moped riders get hit here more than usual.",
    drive: "E-bikes and mopeds move faster than they look. Look twice before you turn or pull out."
  },
  "who:motorcyclist": { all: "Motorcycles are easy to miss. Look twice before changing lanes or turning left." },
  "causes:distracted": {
    all: "These crashes start with someone not looking.",
    walk: "Drivers here often aren’t looking. Make eye contact before you step off the curb, and keep your own phone down.",
    bike: "Drivers here often aren’t looking. Ride as if they can’t see you.",
    drive: "These crashes start with someone not looking. Keep your eyes up and your phone away."
  },
  "causes:yield": {
    all: "People here often don’t wait their turn. Make eye contact before you go, on foot or behind the wheel.",
    walk: "Drivers here often don’t yield, even when you have the walk signal. Wait until they stop, or catch their eye.",
    bike: "Drivers here often don’t yield to bikes. Slow at the corner and be ready to stop.",
    drive: "Failing to yield is where it goes wrong here. Let people in the crosswalk and oncoming traffic go first."
  },
  "causes:tailgating": {
    all: "Traffic here stops suddenly. Leave more room ahead than feels necessary.",
    bike: "Traffic here stops suddenly. Leave room, and stay out of drivers’ blind spots."
  },
  "causes:speeding": {
    all: "Speed is what turns a crash into a serious one. NYC’s limit is 25 mph unless a sign says otherwise.",
    walk: "Cars here go fast. Don’t count on a driver stopping; wait for a real gap.",
    bike: "Cars here go fast. Ride where drivers can see you, in the bike lane if there is one."
  },
  "causes:red-light": {
    all: "Lights and stop signs get run here. Look both ways even on a green.",
    walk: "Lights get run here. Even with the walk signal, look both ways before you step out.",
    bike: "Lights get run here. On a green, still check the cross street before you go."
  },
  "causes:lane": {
    all: "Expect cars to cut in. Signal early and check your blind spot.",
    bike: "Cars here cut across lanes. Watch for drivers drifting into the bike lane or your path."
  },
  "causes:turning": {
    all: "Turns go wrong here. Take them slowly and watch for people crossing.",
    walk: "Turning drivers hit people here. Watch the cars waiting to turn before you cross.",
    bike: "Turning drivers hit bikes here. Don’t pass a car that might be about to turn."
  },
  "causes:backing": {
    all: "Back up slowly and look behind you: kids and cyclists are hard to see.",
    walk: "Vehicles back up here without seeing who’s behind them. Stay clear of reversing cars and trucks."
  },
  "causes:impaired": { all: "Alcohol or drugs show up in these reports more than usual. Late at night, give drivers who seem off a wide berth." },
  "causes:aggressive": { all: "Aggressive driving shows up here more than usual. Let them go; don’t engage." },
  "causes:inexperience": { all: "New drivers crash here more than usual. Give learners room." },
  "causes:drowsy-ill": {
    all: "Drivers who fell asleep or fell ill show up here more than usual.",
    drive: "Drivers who fell asleep or fell ill show up here more than usual. Pull over if you’re tired."
  },
  "causes:road": {
    all: "Slippery pavement, glare or blocked views show up in these reports. Slow down where you can’t see far.",
    walk: "Blocked views and glare show up in these reports. Cross where you can see oncoming traffic, and it can see you."
  },
  "causes:ped-error": {
    all: "People here often cross against the light or mid-block. Expect them.",
    walk: "Crossing against the light or mid-block shows up here more than usual. Cross at the corner, with the signal."
  },
  "causes:defect": { all: "Brake, tire and steering failures show up here more than usual." },
  "maneuvers:left-turn": {
    all: "Left turns are where drivers meet people crossing. Wait for a clear crosswalk, then turn slowly.",
    walk: "Drivers turning left hit people here. Watch for turning cars even when you have the walk signal.",
    bike: "Drivers turning left cut across bikes here. Watch oncoming cars waiting to turn."
  },
  "maneuvers:right-turn": {
    all: "Before turning right, check for bikes on your right and people in the crosswalk.",
    walk: "Drivers turning right hit people here. Watch for cars turning across the crosswalk beside you.",
    bike: "Drivers turning right cut across bikes here. Don’t ride up beside a car or truck that may turn."
  },
  "maneuvers:u-turn": {
    all: "U-turns end in crashes here more than usual. Watch for cars swinging around mid-block.",
    drive: "U-turns end in crashes here more than usual. Go around the block instead."
  },
  "maneuvers:lane-change": {
    all: "Lane changes and merges go wrong here. Signal early and check mirrors and blind spots.",
    bike: "Cars changing lanes clip bikes here. Stay out of blind spots and ride where you’re seen."
  },
  "maneuvers:backing": {
    all: "Back up slowly and look behind you: kids and cyclists are hard to see.",
    walk: "Vehicles back up here without seeing who’s behind them. Stay clear of reversing cars and trucks."
  },
  "maneuvers:stop-go": {
    all: "Traffic here stops and starts suddenly. Leave room ahead.",
    walk: "Cars here pull away suddenly. Don’t cross in front of a stopped car unless the driver has seen you."
  },
  "maneuvers:parking": {
    all: "Look back before you open a car door, and watch for cars pulling out of spots.",
    walk: "Cars pulling in and out of spots hit people here. Watch parked cars for a driver about to move.",
    bike: "Car doors and cars pulling out hit bikes here. Ride a door’s width away from parked cars."
  },
  "maneuvers:wrong-way": { all: "Vehicles going the wrong way or fleeing police show up here more than usual. On a one-way street, look both ways anyway." },
  "vehicles:truck": {
    all: "Trucks have big blind spots. If you can’t see the driver in their mirror, they can’t see you.",
    walk: "Trucks are in more crashes here. Don’t cross beside or in front of a turning truck; the driver can’t see you.",
    bike: "Trucks are in more crashes here. Never ride beside a turning truck."
  },
  "vehicles:bus": {
    all: "Give buses room as they pull in and out of stops.",
    walk: "Buses are in more crashes here. Don’t step out in front of a bus at a stop; cars passing it can’t see you."
  },
  "vehicles:taxi": {
    all: "Expect sudden stops and pickups at the curb.",
    bike: "Taxis and for-hire cars stop suddenly and open doors here. Give them room."
  },
  "vehicles:motorcycle": { all: "Motorcycles are easy to miss. Look twice before changing lanes or turning left." },
  "vehicles:moped": { all: "Mopeds move faster than they look. Give them room." },
  "vehicles:e-bike": {
    all: "E-bikes move faster than they look. Look twice before you turn or open a door.",
    walk: "E-bikes come faster than they look. Look both ways, in the bike lane too."
  },
  "vehicles:e-scooter": { all: "E-scooters are small and quick. Look twice before you turn, cross or open a door." },
  "vehicles:bike": {
    all: "Check for cyclists before you turn or open a door.",
    walk: "Bikes are in more crashes with people on foot here. Look both ways, in the bike lane too."
  },
  "vehicles:pickup": { all: "Pickups have high hoods and blind spots up front. Make eye contact before crossing in front of one." },
  "vehicles:van": { all: "Vans block the view of what’s behind them. Watch for people stepping out from behind parked ones." }
};

// The tip for a kind of crash, in the voice for the mode.
export const tipFor = (id, mode) => (TIPS[id] ? TIPS[id][mode] ?? TIPS[id].all : null);

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

// "2.1×", or words when there's nothing to divide by
export function ratioText(ratio) {
  if (!Number.isFinite(ratio)) return "much higher";
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×`;
}

// Who a crash hurt, for labels: "someone", "a pedestrian", "a cyclist or e-rider".
/** @param {string | null} [mode] */
export const victimOf = (mode) => modeOf(mode)?.victim ?? "someone";

// Days from the start of the range through the newest crash.
export function daysCovered({ dateFrom, dataThrough }) {
  if (!dateFrom || !dataThrough) return 365;
  return Math.round((Date.parse(`${dataThrough}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 864e5) + 1;
}

// How often, in words a person can picture: "About 3 a day", "About 2 a week", "About 1 a month", "4 in the last year".
export function howOften(n, days) {
  const per = (span) => (n / days) * span;
  if (!n) return "None in the last year.";
  if (per(1) >= 1.5) return `About ${count(per(1))} a day.`;
  if (per(7) >= 1.5) return `About ${count(per(7))} a week.`;
  if (per(30.4) >= 1.5) return `About ${count(per(30.4))} a month.`;
  return `${count(n)} in the last year.`;
}

/*
 * → [{ name, label, value, context }] for StatCard-like cards: crashes that
 * hurt someone (the mode's someone), people killed or seriously hurt, and
 * either an intersection's rank in its borough or every crash reported.
 */
/** @param {string | null} [mode] */
export function statCards(summary, mode = null) {
  const { here, rank, area } = summary;
  const days = Math.max(1, daysCovered(summary));
  const victim = victimOf(mode);
  const cards = [
    { name: "hurt", label: `Crashes that hurt ${victim}`, value: count(here.hurtCrashes), context: howOften(here.hurtCrashes, days) },
    {
      // With the walk or bike mode, only the mode's people (hotspot-sql.js peopleOf()).
      name: "ksi", label: `${modeOf(mode)?.people ?? "People"} killed or seriously hurt`, value: count(here.killed + here.serious),
      context: `${count(here.killed)} killed, ${count(here.serious)} seriously hurt.`
    }
  ];
  if (rank && here.hurtCrashes) {
    const place = rank.above + 1;
    cards.push({
      name: "rank", label: `Among ${rank.label} intersections`, value: `#${count(place)}`,
      context: `of ${count(rank.total)} where a crash hurt ${victim}.${place / rank.total <= 0.01 ? " In the worst 1%." : place / rank.total <= 0.05 ? " In the worst 5%." : ""}`
    });
  } else if (!modeOf(mode)?.who.length && area?.kind !== "corner") {
    cards.push({ name: "crashes", label: "Crashes reported", value: count(here.crashes), context: "Including ones where nobody was hurt." });
  }
  return cards;
}

/*
 * The kinds of crash that make up a clearly bigger share of `here` than of
 * `base`, biggest gap first. Kinds that say nothing to act on, and (for a
 * mode) who was hurt, are left out.
 * → [{ id, column, key, title, n, of, ksi, share, baseShare, ratio, tip }]
 */
/** @param {string | null} [mode] */
export function patterns(here, base, mode = null, rules = WATCH) {
  if (!base?.crashes || !here?.crashes) return [];
  const items = [];
  for (const d of DIMENSIONS) {
    if (d.column === "who" && modeOf(mode)?.who.length) continue;
    for (const g of d.groups) {
      const id = `${d.column}:${g.key}`;
      if (NOT_WATCHED.has(id)) continue;
      const { n, ksi } = here.groups[d.column][g.key];
      if (n < rules.minLocal) continue;
      const s = n / here.crashes, b = base.groups[d.column][g.key].n / base.crashes;
      const ratio = b ? s / b : Infinity;
      if (ratio < rules.minRatio) continue;
      items.push({ id, column: d.column, key: g.key, title: groupTitle(d.column, g), n, of: here.crashes, ksi, share: s, baseShare: b, ratio, tip: tipFor(id, mode) });
    }
  }
  // Some kinds share a tip (backing up as a cause and as a maneuver); show it once.
  const tips = new Set();
  return items.sort((a, b) => (b.share - b.baseShare) - (a.share - a.baseShare) || b.ratio - a.ratio).slice(0, rules.max)
    .map((item) => {
      if (!item.tip || !tips.has(item.tip)) { tips.add(item.tip); return item; }
      return { ...item, tip: null };
    });
}

// "What to watch for here": the area against its borough (or a borough against NYC).
/** @param {string | null} [mode] */
export function watchFor(summary, mode = null) {
  const rules = summary.area?.kind === "corner" ? CORNER : WATCH;
  return patterns(summary.here, summary.compare, mode, rules);
}

// The borough totals a corner is compared with: its own borough, or all of NYC.
export const baseFor = (summary, borough) => summary.boroughs?.[borough] ?? summary.city;

/*
 * The dangerous intersections, each with what goes wrong there against its
 * borough (CORNER rules) and the tip for the first.
 * → [{ ...corner, findings: patterns() }]
 */
/** @param {string | null} [mode] */
export function cornerFindings(summary, mode = null) {
  return (summary.corners ?? []).map((c) => {
    const here = { crashes: c.n, groups: c.groups };
    const findings = patterns(here, baseFor(summary, c.borough), mode, CORNER);
    return { ...c, findings, common: findings.length ? null : mostCommon(here, baseFor(summary, c.borough), mode) };
  });
}

/*
 * When nothing at a place stands out against its borough, its most common
 * cause or action, if it's in at least a third of crashes there (and CORNER's
 * minimum): still the likeliest way to get hurt there.
 * → one patterns() item, or null
 */
/** @param {string | null} [mode] */
export function mostCommon(here, base, mode = null) {
  if (!here?.crashes) return null;
  return patterns(here, base, mode, { minLocal: CORNER.minLocal, minRatio: 0, max: Infinity })
    .filter((p) => p.column !== "who" && p.column !== "vehicles" && p.share >= 1 / 3)
    .sort((a, b) => b.n - a.n)[0] ?? null;
}

// Rows → CSV text (values quoted when needed).
export function toCsv(header, rows) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
