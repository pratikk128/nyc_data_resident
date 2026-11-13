/*
 * When to rebuild a dataset's aggregates, and when to worry about it. Pure
 * (no Worker imports), so the refresh (src/lib/server/etl.js), the status
 * API and scripts/check-snapshots.mjs share it, and tests can import it.
 *
 * Every dataset declares how often the city publishes it (its cadence, from
 * "Update Frequency" on its NYC Open Data page). Each scheduled refresh
 * (scripts/run-etl.mjs, every 12 hours) reads each dataset's rowsUpdatedAt (one small metadata request) and rebuilds a job when:
 *   - it has never been built (new job, or a new key after a code change),
 *   - the source changed since it was built (at most once per minGapHours,
 *     so a source that's touched every hour doesn't rebuild every hour), or
 *   - it's older than rebuildHours, a safety net for a missed change and the
 *     reason values never age out of KV. Rolling jobs (windows that end
 *     "today") rebuild at least daily whatever their source does.
 *
 *   overdueDays  the source counts as late when its last update is older
 *                than this (null: published as needed, never late)
 */
export const CADENCES = {
  daily:       { label: "Daily",         minGapHours: 6,  rebuildHours: 24,      overdueDays: 3 },
  weekly:      { label: "Weekly",        minGapHours: 12, rebuildHours: 7 * 24,  overdueDays: 10 },
  biweekly:    { label: "Every 2 weeks", minGapHours: 12, rebuildHours: 7 * 24,  overdueDays: 21 },
  monthly:     { label: "Monthly",       minGapHours: 12, rebuildHours: 7 * 24,  overdueDays: 45 },
  quarterly:   { label: "Quarterly",     minGapHours: 12, rebuildHours: 30 * 24, overdueDays: 120 },
  yearly:      { label: "Annually",      minGapHours: 12, rebuildHours: 30 * 24, overdueDays: 400 },
  "as-needed": { label: "As needed",     minGapHours: 12, rebuildHours: 30 * 24, overdueDays: null }
};

// GitHub starts scheduled runs late, sometimes by an hour or more; without
// this, a job built by a late run would be "23 hours old" at the next day's
// on-time run and wait another 12 hours. Less than the 12-hour run interval,
// so a job is never rebuilt twice a day for its age.
const SLACK_HOURS = 3;

export function cadenceOf(name) {
  const cadence = CADENCES[name];
  if (!cadence) throw new Error(`Unknown cadence "${name}" (one of ${Object.keys(CADENCES).join(", ")})`);
  return cadence;
}

export const rebuildHours = (cadence, rolling = false) =>
  rolling ? 24 : cadenceOf(cadence).rebuildHours;

// For dailyValue() outside production (astro dev, tests): a value this old is
// rebuilt on the request. Production requests never build (cache.js).
export const requestMaxAgeHours = (cadence, rolling = false) => rebuildHours(cadence, rolling) + 2;

/*
 * What a job was built from: the source's rowsUpdatedAt, plus the build time
 * of any bundled snapshot the job joins in (a deploy with a refreshed
 * snapshot then rebuilds it) and of any other dataset's job it reads
 * (dependsOn: when that one is rebuilt, the next run rebuilds this one). null
 * when the source couldn't be read.
 *   snapshotBuiltAt  { [snapshot id]: builtAt } from src/data/snapshots.json
 *   jobBuiltAt       { [job key]: builtAt } from the last run's ETL state
 */
export function sourceVersion(dataset, rowsUpdatedAt, snapshotBuiltAt = {}, jobBuiltAt = {}) {
  if (!rowsUpdatedAt) return null;
  return [
    rowsUpdatedAt,
    ...(dataset.snapshots ?? []).map((id) => `${id}@${snapshotBuiltAt[id] ?? "?"}`),
    ...(dataset.dependsOn ?? []).map((key) => `${key}@${jobBuiltAt[key] ?? "?"}`)
  ].join(" ");
}

/*
 * Why a job needs rebuilding now, or null if it doesn't.
 *   dataset  { cadence, rolling, minGapHours? } (minGapHours overrides the cadence's)
 *   built    the job's state from its last successful build: { builtAt, sourceVersion }
 *   version  sourceVersion() now, or null if the source couldn't be read
 */
export function refreshReason(dataset, built, version, now = Date.now()) {
  if (!built?.builtAt) return "never built";
  const ageHours = (now - Date.parse(built.builtAt)) / 3600e3;
  const minGapHours = dataset.minGapHours ?? cadenceOf(dataset.cadence).minGapHours;
  if (version && version !== built.sourceVersion && ageHours >= minGapHours) return "source updated";
  if (ageHours >= rebuildHours(dataset.cadence, dataset.rolling) - SLACK_HOURS) {
    return dataset.rolling ? "new day" : "scheduled rebuild";
  }
  return null;
}

// True when the city hasn't published on its usual schedule.
export function isOverdue(cadence, sourceUpdatedAt, now = Date.now()) {
  const { overdueDays } = cadenceOf(cadence);
  if (overdueDays == null || !sourceUpdatedAt) return false;
  return now - Date.parse(sourceUpdatedAt) > overdueDays * 864e5;
}

// The refresh runs every 12 hours (.github/workflows/etl.yml), and GitHub may
// start a scheduled run late or skip one; this long without a run means it has stopped.
export const CRON_LATE_HOURS = 26;

// Why the refresh needs a look, or null: never ran, or hasn't run lately.
export function cronProblem(lastRunAt, now = Date.now()) {
  if (!lastRunAt) return "the scheduled refresh has never run";
  const hours = (now - Date.parse(lastRunAt)) / 3600e3;
  if (hours > CRON_LATE_HOURS) return `the scheduled refresh hasn't run since ${lastRunAt} (${Math.floor(hours)} h ago)`;
  return null;
}

/*
 * A build-time snapshot (src/lib/etl/snapshots.js) is stale when a source
 * changed after it was built: rows updated later, or (for a file attached to
 * a dataset) the attachment replaced. sources: { [datasetId]: { rowsUpdatedAt,
 * attachments: [{ name, assetId }] } }. → [{ datasetId, why }], empty if current.
 */
export function snapshotChanges(snapshot, builtAt, sources) {
  const changes = [];
  for (const src of snapshot.sources) {
    const now = sources[src.datasetId];
    if (!now) continue;
    if (src.attachment) {
      const file = now.attachments?.find((a) => a.name?.includes(src.attachment.match));
      if (file && file.assetId !== src.attachment.assetId) {
        changes.push({ datasetId: src.datasetId, why: `attachment replaced (${file.name})` });
      }
    } else if (!builtAt || (now.rowsUpdatedAt && Date.parse(now.rowsUpdatedAt) > Date.parse(builtAt))) {
      changes.push({ datasetId: src.datasetId, why: `rows updated ${now.rowsUpdatedAt?.slice(0, 10)}` });
    }
  }
  return changes;
}
