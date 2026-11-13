/*
 * Source rows (Socrata JSON) → rows in the shape of schema.js's tables, for
 * the hotspots build (src/lib/server/crash-hotspots.js factsFromSource())
 * and the tests' reference database.
 */
import { streetMatchKey, streetBaseKey, minuteOf, personRole, positionKey, isInvolved, ageOf, sexOf, yearOf, textOf, numberOf, rowHash } from "./normalize.js";
import { makeOf } from "./makes.js";
import { vehicleTypeKey } from "./vehicle-types.js";
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
    crash_minute: minuteOf(r.crash_time),
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
    vehicle_codes: list(r.vehicle_type_code1, r.vehicle_type_code2, r.vehicle_type_code_3, r.vehicle_type_code_4, r.vehicle_type_code_5),
    h: rowHash(r)
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

export function vehicleRow(r) {
  const make = makeOf(r.vehicle_make);
  return {
    unique_id: r.unique_id,
    collision_id: r.collision_id,
    crash_date: day(r.crash_date),
    vehicle_uuid: r.vehicle_id ?? null,
    state_registration: textOf(r.state_registration)?.toUpperCase() ?? null,
    type_raw: textOf(r.vehicle_type),
    type_key: vehicleTypeKey(r.vehicle_type),
    make_raw: textOf(r.vehicle_make),
    make_key: make.key,
    make_class: make.class,
    vehicle_year: yearOf(r.vehicle_year),
    travel_direction: textOf(r.travel_direction),
    occupants: int(r.vehicle_occupants),
    driver_sex: sexOf(r.driver_sex),
    license_status: textOf(r.driver_license_status),
    license_jurisdiction: textOf(r.driver_license_jurisdiction)?.toUpperCase() ?? null,
    pre_crash: textOf(r.pre_crash),
    point_of_impact: textOf(r.point_of_impact),
    damage: list(r.vehicle_damage, r.vehicle_damage_1, r.vehicle_damage_2, r.vehicle_damage_3),
    public_property_damage: textOf(r.public_property_damage),
    public_property_damage_type: textOf(r.public_property_damage_type),
    factors: list(r.contributing_factor_1, r.contributing_factor_2),
    h: rowHash(r)
  };
}

export function personRow(r) {
  const role = personRole(r.person_type, r.ped_role);
  return {
    unique_id: r.unique_id,
    collision_id: r.collision_id,
    crash_date: day(r.crash_date),
    person_id: r.person_id ?? null,
    vehicle_ref: r.vehicle_id ?? null,
    person_type: textOf(r.person_type),
    ped_role: textOf(r.ped_role),
    role,
    involved: isInvolved(role) ? 1 : 0,
    age: ageOf(r.person_age),
    sex: sexOf(r.person_sex),
    injury: textOf(r.person_injury),
    position: textOf(r.position_in_vehicle),
    position_key: positionKey(r.position_in_vehicle),
    safety_equipment: textOf(r.safety_equipment),
    ejection: textOf(r.ejection),
    emotional_status: textOf(r.emotional_status),
    bodily_injury: textOf(r.bodily_injury),
    complaint: textOf(r.complaint),
    ped_location: textOf(r.ped_location),
    ped_action: textOf(r.ped_action),
    factors: list(r.contributing_factor_1, r.contributing_factor_2),
    h: rowHash(r)
  };
}
