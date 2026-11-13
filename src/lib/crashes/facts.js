/*
 * NYC Crash Hotspots: each crash boiled down to one row of crash_facts
 * (schema.js), with what the dashboard filters on worked out once, in the
 * hotspots build (npm run data:hotspots), instead of joining the vehicles on every
 * request. Browser-safe: the page builds its filters from the same
 * groups.
 *
 * Four kinds of crash, each stored as a bitmask so any mix of filters is a
 * single-table scan ("(causes & ?) != 0"):
 *   who        who was hurt or killed: pedestrians, cyclists, e-riders, motorcyclists, people in vehicles
 *   causes     the contributing factors on the report, grouped
 *   maneuvers  what the vehicles were doing (pre_crash), grouped
 *   vehicles   the kinds of vehicle in the crash (vehicle-types.js keys)
 *
 * Bits are stored in the packed facts (public/data/crash-hotspots/facts.json,
 * and browsers' caches of it),
 * so a group's `bit` never changes and new groups take the next free one
 * (a test checks). The arrays' order is the order
 * rules are tried, and the order the page lists them; it can change.
 *
 * factsRow() takes rows as rows.js builds them, or as they come back from
 * the tables (the same columns).
 */
import { streetMatchKey } from "./normalize.js";
import { vehicleTypeKey } from "./vehicle-types.js";
import { prettyStreet } from "../complaints311/location-input.js";

export const WHO = [
  { key: "pedestrian", label: "Pedestrians", bit: 0 },
  { key: "cyclist", label: "Cyclists", bit: 1 },
  { key: "e-rider", label: "E-bike, e-scooter and moped riders", bit: 2 },
  { key: "motorcyclist", label: "Motorcyclists", bit: 3 },
  { key: "occupant", label: "People in cars, trucks and buses", bit: 4 }
];

/*
 * The WHO kinds with their own people counts in crash_facts (the walk and
 * bike modes' someone), by column prefix: ped_killed, ped_injured, …
 */
export const KIND_COLUMNS = { pedestrian: "ped", cyclist: "cyc", "e-rider": "erider" };

/*
 * Contributing factors as the police form writes them ("Driver
 * Inattention/Distraction", "Traffic Control Disregarded"), first matching
 * rule wins. Factors that say nothing a resident can act on ("Other
 * Vehicular", "Reaction to Uninvolved Vehicle") are in no group.
 */
export const CAUSES = [
  { key: "distracted", label: "Distracted driving", bit: 0,
    pattern: /INATTENTION|DISTRACTION|CELL PHONE|TEXTING|ELECTRONIC DEVICE|NAVIGATION|HEADPHONES|EATING OR DRINKING/ },
  { key: "yield", label: "Failure to yield", bit: 1, pattern: /FAILURE TO YIELD/ },
  { key: "tailgating", label: "Following too closely", bit: 2, pattern: /FOLLOWING TOO CLOSELY/ },
  { key: "speeding", label: "Speeding", bit: 3, pattern: /UNSAFE SPEED/ },
  // Before "lane": the road's own markings and devices aren't a driver's lane change.
  { key: "road", label: "Road, weather or view", bit: 12,
    pattern: /PAVEMENT|VIEW OBSTRUCTED|GLARE|OBSTRUCTION|DEBRIS|LANE MARKING|SHOULDERS|TRAFFIC CONTROL DEVICE|ANIMALS|BUS STOP/ },
  { key: "red-light", label: "Ran a red light or stop sign", bit: 4, pattern: /TRAFFIC CONTROL DISREGARDED/ },
  { key: "lane", label: "Unsafe passing or lane change", bit: 5, pattern: /PASSING|LANE|FAILURE TO KEEP RIGHT/ },
  { key: "turning", label: "Turning improperly", bit: 6, pattern: /TURNING IMPROPERLY/ },
  { key: "backing", label: "Backing unsafely", bit: 7, pattern: /BACKING UNSAFELY/ },
  { key: "impaired", label: "Alcohol or drugs", bit: 8, pattern: /ALCOHOL|DRUG|CANNABIS|PRESCRIPTION/ },
  { key: "aggressive", label: "Aggressive driving or road rage", bit: 9, pattern: /AGGRESSIVE|ROAD RAGE/ },
  { key: "inexperience", label: "Driver inexperience", bit: 10, pattern: /INEXPERIENCE/ },
  { key: "drowsy-ill", label: "Drowsy, ill or passed out", bit: 11, pattern: /FELL ASLEEP|FATIGUE|DROWSY|LOST CONSCIOUSNESS|ILLNES|PHYSICAL DISABILITY/ },
  { key: "ped-error", label: "Pedestrian or cyclist error", bit: 13, pattern: /PEDESTRIAN\/BICYCLIST/ },
  { key: "defect", label: "Vehicle defect", bit: 14,
    pattern: /DEFECTIVE|TIRE|STEERING FAILURE|WINDSHIELD|TINTED WINDOWS|TOW HITCH|VANDALISM|LIGHTING DEFECTS/ }
];

// What a vehicle was doing just before the crash (vehicles.pre_crash).
export const MANEUVERS = [
  { key: "left-turn", label: "Turning left", bit: 0, pattern: /LEFT TURN/ },
  { key: "right-turn", label: "Turning right", bit: 1, pattern: /RIGHT TURN/ },
  { key: "u-turn", label: "Making a U-turn", bit: 2, pattern: /U[- ]?TURN/ },
  { key: "lane-change", label: "Changing lanes, merging or passing", bit: 3, pattern: /CHANGING LANES|MERGING|PASSING/ },
  { key: "backing", label: "Backing up", bit: 4, pattern: /BACKING/ },
  { key: "stop-go", label: "Stopping, starting or stopped in traffic", bit: 5, pattern: /STOPPED IN TRAFFIC|SLOWING OR STOPPING|STARTING IN TRAFFIC/ },
  { key: "parking", label: "Parked, parking or a car door", bit: 6, pattern: /^PARKED$|PARKING|PARKED POSITION|VEHICLE DOOR/ },
  { key: "wrong-way", label: "Wrong way, fleeing or chased", bit: 7, pattern: /WRONG WAY|FLEEING|PURSUIT|CROSSED OVER MEDIAN/ },
  { key: "straight", label: "Going straight", bit: 8, pattern: /GOING STRAIGHT/ }
];


// vehicle-types.js keys, with short labels for the filter pills.
export const VEHICLES = [
  { key: "sedan", label: "Car", bit: 0 },
  { key: "suv", label: "SUV", bit: 1 },
  { key: "pickup", label: "Pickup", bit: 2 },
  { key: "van", label: "Van", bit: 3 },
  { key: "truck", label: "Truck", bit: 4 },
  { key: "bus", label: "Bus", bit: 5 },
  { key: "taxi", label: "Taxi or for-hire", bit: 6 },
  { key: "emergency", label: "Emergency vehicle", bit: 7 },
  { key: "motorcycle", label: "Motorcycle", bit: 8 },
  { key: "moped", label: "Moped", bit: 9 },
  { key: "e-bike", label: "E-bike", bit: 10 },
  { key: "e-scooter", label: "E-scooter", bit: 11 },
  { key: "bike", label: "Bicycle", bit: 12 }
];

// The four masks, by the column that holds each.
export const DIMENSIONS = [
  { column: "who", param: "who", title: "Who was hurt", groups: WHO },
  { column: "causes", param: "cause", title: "Cause", groups: CAUSES },
  { column: "maneuvers", param: "move", title: "What the driver was doing", groups: MANEUVERS },
  { column: "vehicles", param: "veh", title: "Vehicle", groups: VEHICLES }
];

const ruleKey = (groups, text) => {
  const s = String(text ?? "").toUpperCase().trim();
  return s ? groups.find((g) => g.pattern.test(s))?.key ?? null : null;
};
export const causeKey = (text) => ruleKey(CAUSES, text);
export const maneuverKey = (text) => ruleKey(MANEUVERS, text);

const bitOf = (groups, key) => groups.find((g) => g.key === key)?.bit;
// [key] → mask; unknown keys are skipped.
export function maskOf(groups, keys) {
  let mask = 0;
  for (const k of keys) {
    const bit = bitOf(groups, k);
    if (bit != null) mask |= 1 << bit;
  }
  return mask;
}
export const keysOf = (groups, mask) => groups.filter((g) => mask & (1 << g.bit)).map((g) => g.key);

// ---------- Severity ----------

// The worst that happened to anyone in a crash: 0 nobody hurt, 1 someone hurt, 2 someone killed.
export const SEVERITY = { none: 0, injured: 1, killed: 2 };

// ---------- Places ----------

// About 165 m a side: fine enough to pick out a corner, coarse enough to keep the citywide map small.
export const CELL_LAT = 0.0015;
export const CELL_LON = 0.002;
export const cellOf = (lat, lon) =>
  lat == null || lon == null ? null : `${Math.floor(lat / CELL_LAT)}:${Math.floor(lon / CELL_LON)}`;

/*
 * The intersection a crash names (on and cross street), as one key whichever
 * street came first, and a label in the same order. null without both.
 */
export function cornerOf(on, cross) {
  const a = streetMatchKey(on), b = streetMatchKey(cross);
  if (!a || !b || a === b) return { key: null, label: null };
  const [first, second] = a < b ? [[a, on], [b, cross]] : [[b, cross], [a, on]];
  return { key: `${first[0]}&${second[0]}`, label: `${prettyStreet(first[1])} & ${prettyStreet(second[1])}` };
}

// ---------- The row ----------

const parse = (json) => {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
};

/*
 * Who was hurt or killed comes from the crash's own counts (the persons table
 * isn't fetched). The report counts pedestrians, cyclists and motorists;
 * people on e-bikes, e-scooters and mopeds ("Other Motorized" in the persons
 * table) are in none of the three, only in the total, so the rest of the
 * total is them (on September 2025 this matched the persons table for every
 * crash). Hurt motorists are motorcyclists when a motorcycle was in the
 * crash, and people in cars, trucks and buses when more motorists were hurt
 * than there were motorcycles.
 */
export function factsRow(crash, vehicles = []) {
  const n = (v) => v ?? 0;
  const killed = n(crash.persons_killed);
  const injured = n(crash.persons_injured);
  const severity = killed > 0 ? SEVERITY.killed : injured > 0 ? SEVERITY.injured : SEVERITY.none;
  // The people counts for each of KIND_COLUMNS.
  const kinds = {
    ped: { killed: n(crash.pedestrians_killed), injured: n(crash.pedestrians_injured) },
    cyc: { killed: n(crash.cyclists_killed), injured: n(crash.cyclists_injured) },
    erider: {
      killed: Math.max(0, killed - n(crash.pedestrians_killed) - n(crash.cyclists_killed) - n(crash.motorists_killed)),
      injured: Math.max(0, injured - n(crash.pedestrians_injured) - n(crash.cyclists_injured) - n(crash.motorists_injured))
    }
  };

  // The crash's vehicle codes are vehicles 1–5's types (config.js SOURCE_COLUMNS).
  const vehicleKeys = parse(crash.vehicle_codes).map(vehicleTypeKey);
  const vehicleMask = maskOf(VEHICLES, vehicleKeys.filter(Boolean));
  const motorcycles = vehicleKeys.filter((k) => k === "motorcycle").length;
  const motorists = n(crash.motorists_killed) + n(crash.motorists_injured);
  const hurt = (c) => c.killed + c.injured > 0;
  const who = maskOf(WHO, [
    hurt(kinds.ped) && "pedestrian",
    hurt(kinds.cyc) && "cyclist",
    hurt(kinds.erider) && "e-rider",
    motorists > 0 && motorcycles > 0 && "motorcyclist",
    motorists > motorcycles && "occupant"
  ].filter(Boolean));

  const factors = [...parse(crash.factors), ...vehicles.flatMap((v) => parse(v.factors))];
  const causes = maskOf(CAUSES, factors.map(causeKey).filter(Boolean));
  const maneuvers = maskOf(MANEUVERS, vehicles.map((v) => maneuverKey(v.pre_crash)).filter(Boolean));

  const corner = cornerOf(crash.on_street, crash.cross_street);
  return {
    collision_id: crash.collision_id,
    crash_date: crash.crash_date,
    borough: crash.borough,
    zip_code: crash.zip_code,
    lat: crash.latitude,
    lon: crash.longitude,
    cell: cellOf(crash.latitude, crash.longitude),
    corner: corner.key,
    corner_label: corner.label,
    severity,
    killed,
    injured,
    ...Object.fromEntries(Object.entries(kinds).flatMap(([prefix, c]) => Object.entries(c).map(([k, n]) => [`${prefix}_${k}`, n]))),
    who,
    causes,
    maneuvers,
    vehicles: vehicleMask
  };
}

// collision_id → [rows], for factsRow()'s vehicles.
export function byCrash(rows) {
  const out = new Map();
  for (const r of rows) {
    const list = out.get(r.collision_id);
    if (list) list.push(r); else out.set(r.collision_id, [r]);
  }
  return out;
}
