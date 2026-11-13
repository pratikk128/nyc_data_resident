/*
 * NYC crash data (read by NYC Crash Hotspots): the datasets, the date range the site covers, and the
 * refresh window. Browser-safe.
 *
 * The three NYPD tables on NYC Open Data:
 *   crashes   h9gi-nx95  one row per crash, key collision_id
 *   vehicles  bm4k-52h4  one row per vehicle, key unique_id, collision_id → crashes
 *   persons   f55k-p6yu  one row per person, key unique_id, collision_id → crashes,
 *                        vehicle_id → vehicles.unique_id (not vehicles.vehicle_id)
 */

import { nycToday } from "../format.js";

/*
 * The crash dates the site covers: a rolling window of the last RANGE_YEARS
 * years, from the same day RANGE_YEARS years before today (New York) through
 * the latest crash in the data. Each daily build fetches the whole window
 * again, so older crashes drop off on their own. To widen or narrow it,
 * change RANGE_YEARS (a wider window means a longer fetch and a bigger
 * download for the page).
 */
export const RANGE_YEARS = 1;

// → { from: YYYY-MM-DD, to: null }; `to: null` means "through the latest crash".
export function dateRange(today = nycToday()) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - RANGE_YEARS); // Feb 29 → Mar 1
  return { from: d.toISOString().slice(0, 10), to: null };
}

export const DATASETS = {
  crashes: { id: "h9gi-nx95", key: "collision_id", name: "Motor Vehicle Collisions - Crashes" },
  vehicles: { id: "bm4k-52h4", key: "unique_id", name: "Motor Vehicle Collisions - Vehicles" },
  persons: { id: "f55k-p6yu", key: "unique_id", name: "Motor Vehicle Collisions - Person" }
};

export const sourceUrl = (table) => `https://data.cityofnewyork.us/d/${DATASETS[table].id}`;

/*
 * The source columns the facts need (rows.js, facts.js), per table: asking
 * for only these keeps a year's fetch small. Add a column here before
 * reading it in rows.js or facts.js, or it arrives empty.
 */
export const SOURCE_COLUMNS = {
  crashes: [
    "collision_id", "crash_date", "crash_time", "borough", "zip_code", "latitude", "longitude",
    "on_street_name", "cross_street_name", "off_street_name",
    "number_of_persons_injured", "number_of_persons_killed", "number_of_pedestrians_injured", "number_of_pedestrians_killed",
    "number_of_cyclist_injured", "number_of_cyclist_killed", "number_of_motorist_injured", "number_of_motorist_killed",
    "contributing_factor_vehicle_1", "contributing_factor_vehicle_2", "contributing_factor_vehicle_3",
    "contributing_factor_vehicle_4", "contributing_factor_vehicle_5",
    "vehicle_type_code1", "vehicle_type_code2", "vehicle_type_code_3", "vehicle_type_code_4", "vehicle_type_code_5"
  ],
  vehicles: ["unique_id", "collision_id", "crash_date", "vehicle_type", "pre_crash", "contributing_factor_1", "contributing_factor_2"],
  persons: ["unique_id", "collision_id", "crash_date", "vehicle_id", "person_type", "ped_role", "person_injury",
    "complaint", "emotional_status", "contributing_factor_1", "contributing_factor_2"]
};

// SoQL condition for the date range, for any of the three tables (each has crash_date).
export function dateWhere({ from, to } = dateRange()) {
  const parts = [`crash_date >= '${from}T00:00:00'`];
  if (to) parts.push(`crash_date <= '${to}T23:59:59'`);
  return parts.join(" AND ");
}
