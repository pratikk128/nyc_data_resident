/*
 * How a crash, a vehicle and the people in it are described, the same way
 * in the results list and the deep dive. Browser-safe.
 */
import { makeLabel } from "./makes.js";
import { vehicleTypeLabel } from "./vehicle-types.js";
import { ROLE_LABELS, INVOLVED_ROLES, timeLabel } from "./normalize.js";
import { prettyStreet } from "../complaints311/location-input.js";
import { boroughLabel } from "../complaints311/config.js";

export const NOT_RECORDED = "Not recorded";

// Short names for the results line ("2019 Toyota SUV (NY) + Bicycle").
const TYPE_SHORT = {
  sedan: "car", suv: "SUV", pickup: "pickup", van: "van", taxi: "taxi", bus: "bus", truck: "truck",
  motorcycle: "motorcycle", moped: "moped", bike: "Bicycle", "e-bike": "E-bike", "e-scooter": "E-scooter",
  emergency: "emergency vehicle"
};

// "HOND -CAR/SUV" → "HOND" when makes.js doesn't know it; "Moped" → null (that's a type).
function rawMakeName(raw) {
  const s = String(raw ?? "").replace(/\s*-\s*(CAR\/SUV|TRUCK\/BUS)\s*$/i, "").trim();
  return s && !/^(moped|bike|e-bike|scooter|unknown)$/i.test(s) ? s : null;
}

export const makeName = (v) => makeLabel(v.make_key) ?? rawMakeName(v.make_raw);

export function vehicleSummary(v) {
  const make = makeName(v);
  const type = TYPE_SHORT[v.type_key] ?? (v.type_raw ? v.type_raw.toLowerCase() : null);
  // Bicycles and scooters read better as the type alone.
  const words = ["bike", "e-bike", "e-scooter"].includes(v.type_key) && !make
    ? [type]
    : [v.vehicle_year, make, type ?? (make ? null : "Vehicle")];
  let text = words.filter(Boolean).join(" ");
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return v.state_registration ? `${text} (${v.state_registration})` : text;
}

export const vehiclesLine = (vehicles) => vehicles.map(vehicleSummary).join(" + ") || "No vehicles recorded";

export const vehicleTypeName = (v) => vehicleTypeLabel(v.type_key) ?? v.type_raw ?? null;

const title = (s) => (s ? prettyStreet(s) : null);

// "Broadway & West 72nd Street" or "Off-street: 200 West 72nd Street"
export function locationLine(crash) {
  const on = title(crash.on_street), cross = title(crash.cross_street), off = title(crash.off_street);
  if (on && cross) return `${on} & ${cross}`;
  if (on) return on;
  if (off) return off;
  if (cross) return cross;
  return null;
}

// "Manhattan 10023"
export const areaLine = (crash) => [boroughLabel(crash.borough), crash.zip_code].filter(Boolean).join(" ") || null;

export const whenLine = (crash) => ({ date: crash.crash_date, time: timeLabel(crash.crash_minute) });

// People in the crash by role, for "2 drivers, 1 pedestrian".
export function roleCounts(persons) {
  const counts = {};
  for (const p of persons) if (p.involved) counts[p.role] = (counts[p.role] ?? 0) + 1;
  return INVOLVED_ROLES.filter((r) => counts[r]).map((role) => ({ role, label: ROLE_LABELS[role], n: counts[role] }));
}

const PLURAL = { driver: "drivers", passenger: "passengers", pedestrian: "pedestrians", cyclist: "cyclists", "other-motorized": "e-scooter, skateboard or similar riders" };
const SINGULAR = { driver: "driver", passenger: "passenger", pedestrian: "pedestrian", cyclist: "cyclist", "other-motorized": "e-scooter, skateboard or similar rider" };
export const roleCountsLine = (counts) =>
  counts.map(({ role, n }) => `${n} ${n === 1 ? SINGULAR[role] : PLURAL[role]}`).join(", ") || "No people recorded";

export const show = (v) => (v == null || v === "" ? NOT_RECORDED : v);
