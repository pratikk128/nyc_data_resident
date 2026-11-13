/*
 * NYC crash data (read by NYC Crash Hotspots): the datasets, the date range the site covers, and the
 * refresh window. Browser-safe.
 *
 * Two of the three NYPD tables on NYC Open Data:
 *   crashes   h9gi-nx95  one row per crash, key collision_id
 *   vehicles  bm4k-52h4  one row per vehicle, key unique_id, collision_id → crashes
 * The third, persons (f55k-p6yu), isn't fetched: the crash's own counts say
 * who was hurt or killed (facts.js factsRow()), and it's the biggest table.
 */

import { nycToday } from "../format.js";

/*
 * How often the data refresh rebuilds the hotspots (src/lib/server/crashes.js):
 * every 3 days. Each build fetches the whole year, the refresh's biggest job,
 * and a year's counts barely move in a few days.
 */
export const REBUILD_HOURS = 72;

/*
 * The crash dates the site covers: a rolling window of the last RANGE_YEARS
 * years, from the same day RANGE_YEARS years before today (New York) through
 * the latest crash in the data. Each build fetches the whole window
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
  vehicles: { id: "bm4k-52h4", key: "unique_id", name: "Motor Vehicle Collisions - Vehicles" }
};

export const sourceUrl = (table) => `https://data.cityofnewyork.us/d/${DATASETS[table].id}`;

/*
 * The source columns the facts need (rows.js, facts.js), per table: asking
 * for only these keeps a year's fetch small. Add a column here before
 * reading it in rows.js or facts.js, or it arrives empty.
 *
 * From vehicles, only what the crash row doesn't already have: the crash's
 * vehicle_type_code1..5 and contributing_factor_vehicle_1..5 are vehicles
 * 1–5's vehicle_type and contributing_factor_1, so the vehicles table adds
 * just pre_crash and contributing_factor_2 (and unique_id, to keep a row
 * repeated mid-pull once). Vehicles past the fifth, which are rare, aren't
 * in the vehicle filter.
 */
export const SOURCE_COLUMNS = {
  crashes: [
    "collision_id", "crash_date", "borough", "zip_code", "latitude", "longitude",
    "on_street_name", "cross_street_name", "off_street_name",
    "number_of_persons_injured", "number_of_persons_killed", "number_of_pedestrians_injured", "number_of_pedestrians_killed",
    "number_of_cyclist_injured", "number_of_cyclist_killed", "number_of_motorist_injured", "number_of_motorist_killed",
    "contributing_factor_vehicle_1", "contributing_factor_vehicle_2", "contributing_factor_vehicle_3",
    "contributing_factor_vehicle_4", "contributing_factor_vehicle_5",
    "vehicle_type_code1", "vehicle_type_code2", "vehicle_type_code_3", "vehicle_type_code_4", "vehicle_type_code_5"
  ],
  vehicles: ["unique_id", "collision_id", "pre_crash", "contributing_factor_2"]
};
