/*
 * NYC Crash Lookup: the datasets, the date range the site covers, and the
 * refresh window. Browser-safe.
 *
 * The three NYPD tables on NYC Open Data:
 *   crashes   h9gi-nx95  one row per crash, key collision_id
 *   vehicles  bm4k-52h4  one row per vehicle, key unique_id, collision_id → crashes
 *   persons   f55k-p6yu  one row per person, key unique_id, collision_id → crashes,
 *                        vehicle_id → vehicles.unique_id (not vehicles.vehicle_id)
 */

/*
 * The crash dates the site covers, inclusive. `to: null` means "through the
 * latest crash in the data". To widen or narrow the range, change this, then
 * run a full rebuild (npm run data:crashes -- --refetch, then
 * npm run data:crashes:push); the daily sync only looks at recent weeks.
 */
export const DATE_RANGE = { from: "2024-01-01", to: null };

export const DATASETS = {
  crashes: { id: "h9gi-nx95", key: "collision_id", name: "Motor Vehicle Collisions - Crashes" },
  vehicles: { id: "bm4k-52h4", key: "unique_id", name: "Motor Vehicle Collisions - Vehicles" },
  persons: { id: "f55k-p6yu", key: "unique_id", name: "Motor Vehicle Collisions - Person" }
};

export const sourceUrl = (table) => `https://data.cityofnewyork.us/d/${DATASETS[table].id}`;

/*
 * The city republishes every row each day (":updated_at" moves on all of
 * them), so the daily sync can't ask what changed. It re-reads the crashes
 * of the last SYNC_DAYS days instead and writes only rows that differ.
 * Reports are amended later than that too; the monthly full rebuild picks
 * those up, and the ingest log warns when one is due.
 */
export const SYNC_DAYS = 45;
export const REBUILD_DUE_DAYS = 35;

// SoQL condition for the date range, for any of the three tables (each has crash_date).
export function dateWhere({ from, to } = DATE_RANGE) {
  const parts = [`crash_date >= '${from}T00:00:00'`];
  if (to) parts.push(`crash_date <= '${to}T23:59:59'`);
  return parts.join(" AND ");
}
