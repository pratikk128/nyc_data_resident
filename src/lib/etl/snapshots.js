/*
 * Data the site ships with each deploy instead of reading from KV: lookups
 * that join several datasets (school addresses, the NYC outline, bundled
 * from src/data/*.json) and NYC Crash Hotspots (static files under
 * public/data/, too big a build for the scheduled refresh). The Worker can't
 * rewrite them, so their refresh is a script plus a deploy.
 *
 * Each script records when it ran in src/data/snapshots.json
 * (scripts/lib/snapshot-manifest.mjs). The scheduled refresh and
 * `npm run data:check` compare that with each source below, or with
 * maxAgeDays, and say which snapshots are stale and the command that
 * refreshes them.
 *
 *   sources     datasets the snapshot reads. `attachment` watches a file
 *               attached to the dataset (by name) instead of its rows.
 *   maxAgeDays  stale this many days after it was built, whatever its
 *               sources do: for a snapshot of a dataset the city updates
 *               daily, which a source check would always call stale.
 */
export const SNAPSHOTS = [
  {
    id: "school-locations",
    dashboard: "school-quality",
    files: ["src/data/school-locations.json"],
    command: "npm run data:school-locations",
    sources: [
      { datasetId: "dnpx-dfnc" }, // School Quality Reports: which DBNs need an address
      { datasetId: "wg9x-4ke6" }, // 2019-20 School Locations (historical)
      { datasetId: "ji82-xba5" }  // Facilities Database, about every 6 months
    ]
  },
  {
    // A year of crashes, anchored to the latest crash in the data (crashes/config.js
    // dateRange()), so a month-old snapshot is still a consistent year. The crash
    // tables update daily, so it goes by age, not by its sources.
    id: "crash-hotspots",
    dashboard: "crash-hotspots",
    files: ["public/data/crash-hotspots/"],
    command: "npm run data:hotspots",
    maxAgeDays: 35,
    sources: []
  },
  {
    id: "nyc-outline",
    dashboard: "help-near-me",
    files: ["src/data/nyc-outline.json"],
    command: "npm run data:nyc-outline",
    sources: [
      { datasetId: "wh2p-dxnf" } // Borough Boundaries (water areas included), quarterly
    ]
  }
];

export const snapshotSourceIds = () => [...new Set(SNAPSHOTS.flatMap((s) => s.sources.map((src) => src.datasetId)))];
