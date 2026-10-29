/*
 * Data the site bundles at build time (src/data/*.json) instead of reading
 * from KV: pages that are prerendered (City Payroll), and lookups that join
 * several datasets (school addresses, water station locations). The Worker
 * can't rewrite them, so their refresh is a script plus a deploy.
 *
 * Each script records when it ran in src/data/snapshots.json
 * (scripts/lib/snapshot-manifest.mjs). The hourly cron and
 * `npm run data:check` compare that with each source below and say which
 * snapshots are stale and the command that refreshes them.
 *
 *   sources  datasets the snapshot reads. `attachment` watches a file
 *            attached to the dataset (by name) instead of its rows.
 */
export const SNAPSHOTS = [
  {
    id: "payroll",
    dashboard: "city-payroll",
    files: ["src/data/payroll-by-year.json", "src/data/payroll-by-agency.json", "src/data/payroll-jobs.json"],
    command: "npm run data:payroll",
    sources: [{ datasetId: "k397-673e" }]
  },
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
    id: "water-sites",
    dashboard: "drinking-water",
    files: ["src/data/water-sites.json", "src/data/zip-centroids.json"],
    command: "npm run data:water-sites",
    sources: [
      // The sampling site spreadsheet attached to the water quality dataset; the
      // dataset's rows update monthly, which doesn't touch the station list.
      // When DEP replaces it, point XLSX_URL in scripts/refresh-water-sites.mjs
      // and assetId here at the new file.
      { datasetId: "bkwf-xfky", attachment: { match: "Sampling_Sites", assetId: "e93e4856-95f7-48d4-b4c0-fa54989cdbfc" } },
      { datasetId: "wh2p-dxnf" }, // Borough Boundaries, quarterly
      { datasetId: "pri4-ifjk" }  // MODZCTA, as needed
    ]
  }
];

export const snapshotSourceIds = () => [...new Set(SNAPSHOTS.flatMap((s) => s.sources.map((src) => src.datasetId)))];
