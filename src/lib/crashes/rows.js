/*
 * Source rows (Socrata JSON, only config.js SOURCE_COLUMNS) → the rows
 * facts.js factsRow() takes, for the hotspots build
 * (src/lib/server/crash-hotspots.js factsFromSource()); crashRow() and
 * streetRows() are also in the shape of schema.js's tables, for the tests'
 * reference database.
 */
import { streetMatchKey, streetBaseKey, textOf, numberOf } from "./normalize.js";
import { inNyc } from "../complaints311/location-input.js";

const day = (v) => String(v ?? "").slice(0, 10);
const list = (...values) => {
  const kept = values.map(textOf);
  while (kept.length && kept.at(-1) == null) kept.pop();
  return kept.length ? JSON.stringify(kept) : null;
};
const int = (v) => {
  const n = numberOf(v);
  return n == null ? null : Math.trunc(n);
};
// 0,0 and points far outside the city are how the data writes "no location".
const coord = (lat, lon) => {
  const a = numberOf(lat), o = numberOf(lon);
  return a != null && o != null && inNyc(a, o) ? [a, o] : [null, null];
};

export function crashRow(r) {
  const [latitude, longitude] = coord(r.latitude, r.longitude);
  return {
    collision_id: r.collision_id,
    crash_date: day(r.crash_date),
    borough: textOf(r.borough)?.toUpperCase() ?? null,
    zip_code: /^\d{5}$/.test(String(r.zip_code ?? "").trim()) ? String(r.zip_code).trim() : null,
    latitude,
    longitude,
    on_street: textOf(r.on_street_name),
    cross_street: textOf(r.cross_street_name),
    off_street: textOf(r.off_street_name),
    persons_injured: int(r.number_of_persons_injured),
    persons_killed: int(r.number_of_persons_killed),
    pedestrians_injured: int(r.number_of_pedestrians_injured),
    pedestrians_killed: int(r.number_of_pedestrians_killed),
    cyclists_injured: int(r.number_of_cyclist_injured),
    cyclists_killed: int(r.number_of_cyclist_killed),
    motorists_injured: int(r.number_of_motorist_injured),
    motorists_killed: int(r.number_of_motorist_killed),
    factors: list(r.contributing_factor_vehicle_1, r.contributing_factor_vehicle_2, r.contributing_factor_vehicle_3,
      r.contributing_factor_vehicle_4, r.contributing_factor_vehicle_5),
    vehicle_codes: list(r.vehicle_type_code1, r.vehicle_type_code2, r.vehicle_type_code_3, r.vehicle_type_code_4, r.vehicle_type_code_5)
  };
}

// The crash_streets rows for a crash row: each named street once per field.
export function streetRows(crash) {
  const out = [];
  for (const field of ["on", "cross", "off"]) {
    const street = streetMatchKey(crash[`${field}_street`]);
    if (street) out.push({ street, street_base: streetBaseKey(street), collision_id: crash.collision_id, crash_date: crash.crash_date, field });
  }
  return out;
}

// A vehicle's own extras: the crash row already has its type and first factor (config.js SOURCE_COLUMNS).
export function vehicleRow(r) {
  return {
    unique_id: r.unique_id,
    collision_id: r.collision_id,
    pre_crash: textOf(r.pre_crash),
    factors: list(r.contributing_factor_2)
  };
}
