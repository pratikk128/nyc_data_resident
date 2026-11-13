/*
 * The data refresh pipeline: every dataset whose aggregates live in KV, and
 * the scheduled refresh that keeps them current. It runs in Node, not in the
 * Worker (scripts/run-etl.mjs, every 3 hours from .github/workflows/etl.yml),
 * with KV and D1 reached through wrangler (scripts/lib/workers-env.mjs). When to rebuild is decided in
 * src/lib/etl/cadence.js; each dataset's module says how often the city
 * publishes it.
 *
 * Each run, for every dataset in parallel:
 *   1. read its metadata from NYC Open Data (one small request),
 *   2. rebuild the jobs that are due (never built, source changed, or past
 *      the cadence's rebuild interval), in parallel except a job's `after`,
 *   3. record what each job was built from in the "etl:state" KV entry.
 * A job that fails keeps its last good value in KV and is retried the next
 * run; the run then throws, so the failure shows in the workflow's logs.
 * The same run checks the build-time snapshots (src/lib/etl/snapshots.js)
 * against their sources and logs the ones to refresh.
 *
 * To add a dataset, export a definition from its server module and add it
 * to DATASETS:
 *   { id, dashboard, datasetId, cadence, rolling?, snapshots?, dependsOn?, metadataJob, jobs }
 *     cadence    a key of CADENCES in cadence.js
 *     rolling    true when a job's window ends "today", so it rebuilds daily
 *     snapshots  ids of bundled snapshots a job joins in (snapshots.js)
 *     dependsOn  keys of other datasets' jobs its jobs read; it rebuilds the run after one does
 *     jobs       [{ key, maxAgeHours, run, after? }], read with dailyValue()
 *     attention  optional async (now) → [sentence], upkeep for the status page
 */
import { env } from "cloudflare:workers";
import { refreshDaily } from "./cache.js";
import { datasetMetadata, SocrataError } from "./socrata.js";
import { cadenceOf, refreshReason, sourceVersion, isOverdue, snapshotChanges, cronProblem } from "../etl/cadence.js";
import { SNAPSHOTS, snapshotSourceIds } from "../etl/snapshots.js";
import snapshotManifest from "../../data/snapshots.json";
import { restaurantsDataset } from "./restaurants.js";
import { complaints311Dataset } from "./complaints311.js";
import { schoolsDataset } from "./schools.js";
import { payrollDataset } from "./payroll.js";
import { streetClosuresDataset } from "./street-closures.js";
import { helpNearMeDatasets } from "./help-near-me.js";
import { crashesDataset } from "./crashes.js";
import { buildingReportDatasets } from "./building-report.js";
import { parkAmenitiesDatasets } from "./park-amenities.js";

export const DATASETS = [restaurantsDataset, complaints311Dataset, schoolsDataset, payrollDataset, streetClosuresDataset, ...helpNearMeDatasets, crashesDataset, ...buildingReportDatasets, ...parkAmenitiesDatasets];

const STATE_KEY = "etl:state";
const iso = (ms) => new Date(ms).toISOString();
const snapshotBuiltAt = Object.fromEntries(Object.entries(snapshotManifest).map(([id, s]) => [id, s.builtAt]));

// What /api/etl/status shows for a failure. The status route is public, so
// it gets a short, fixed summary; the full message goes to the refresh's logs.
const publicError = (err) => {
  if (!(err instanceof SocrataError)) return "build failed (see the refresh's logs)";
  return err.status ? `NYC Open Data returned ${err.status}` : "couldn't reach NYC Open Data";
};

const readState = async () => (await env.DATA_CACHE?.get(STATE_KEY, "json")) ?? { datasets: {}, snapshots: {} };

// { [job key]: builtAt } from a run's state, for dependsOn.
const jobBuiltTimes = (state) => Object.fromEntries(
  Object.values(state.datasets ?? {}).flatMap((d) => Object.entries(d.jobs ?? {}).map(([key, j]) => [key, j?.builtAt ?? null])));

export async function runEtl(now = Date.now()) {
  const state = await readState();
  const failures = [];
  const metadata = new Map(); // datasetId → metadata, shared with the snapshot check
  // The last run's, so a job rebuilt in this run reaches the jobs that read it on the next.
  const jobBuiltAt = jobBuiltTimes(state);

  const datasets = {};
  await Promise.all(DATASETS.map(async (ds) => {
    const prev = state.datasets?.[ds.id] ?? {};
    const s = { ...prev, checkedAt: iso(now), jobs: {} };
    datasets[ds.id] = s;

    let meta = null;
    try {
      meta = await datasetMetadata(ds.datasetId);
      metadata.set(ds.datasetId, meta);
      s.source = { name: meta.name, rowsUpdatedAt: meta.rowsUpdatedTime };
      delete s.sourceError;
    } catch (err) {
      s.sourceError = publicError(err);
      failures.push(`${ds.id} metadata: ${err.message}`);
    }
    if (isOverdue(ds.cadence, s.source?.rowsUpdatedAt, now)) {
      console.warn(`${ds.id}: ${ds.datasetId} last updated ${s.source.rowsUpdatedAt}, late for a ${cadenceOf(ds.cadence).label.toLowerCase()} dataset`);
    }

    const version = sourceVersion(ds, s.source?.rowsUpdatedAt, snapshotBuiltAt, jobBuiltAt);
    // The metadata job shows the "Data updated" date, so it follows the source at once.
    const due = [];
    if (meta) due.push([{ ...ds.metadataJob, run: () => meta }, { ...ds, minGapHours: 0 }]);
    else s.jobs[ds.metadataJob.key] = prev.jobs?.[ds.metadataJob.key];
    for (const job of ds.jobs) due.push([job, ds]);

    const running = new Map();
    for (const [job, policy] of due) {
      const built = prev.jobs?.[job.key];
      const reason = refreshReason(policy, built, version, now);
      if (!reason) {
        s.jobs[job.key] = built;
        continue;
      }
      running.set(job.key, (async () => {
        if (job.after) await running.get(job.after.key)?.catch(() => {});
        const started = Date.now();
        try {
          await refreshDaily(job);
          s.jobs[job.key] = { builtAt: iso(started), sourceVersion: version, reason, ms: Date.now() - started };
          console.log(`Refreshed ${job.key} (${reason}, ${Date.now() - started} ms)`);
        } catch (err) {
          s.jobs[job.key] = { ...built, error: publicError(err), failedAt: iso(Date.now()) };
          failures.push(`${job.key}: ${err.message}`);
        }
      })());
    }
    await Promise.all(running.values());
  }));

  const snapshots = await checkSnapshots(metadata, state.snapshots ?? {}, now);
  await env.DATA_CACHE?.put(STATE_KEY, JSON.stringify({ updatedAt: iso(now), datasets, snapshots }));

  for (const f of failures) console.error(`ETL: ${f}`);
  if (failures.length) throw new Error(`${failures.length} ETL step(s) failed`);
}

async function checkSnapshots(metadata, prev, now) {
  const sources = {};
  await Promise.all(snapshotSourceIds().map(async (id) => {
    try {
      const meta = metadata.get(id) ?? await datasetMetadata(id);
      sources[id] = { rowsUpdatedAt: meta.rowsUpdatedTime, attachments: meta.attachments };
    } catch (err) {
      console.warn(`Snapshot source ${id}: ${err.message}`); // keeps the last check's result
    }
  }));
  const out = {};
  for (const snap of SNAPSHOTS) {
    const reachable = snap.sources.every((src) => sources[src.datasetId]);
    if (!reachable && prev[snap.id]) { out[snap.id] = prev[snap.id]; continue; }
    const changes = snapshotChanges(snap, snapshotBuiltAt[snap.id], sources);
    out[snap.id] = { checkedAt: iso(now), changes };
    if (changes.length) {
      console.warn(`Snapshot ${snap.id} is stale (${changes.map((c) => `${c.datasetId}: ${c.why}`).join("; ")}): run ${snap.command}, then deploy`);
    }
  }
  return out;
}

/*
 * For /api/etl/status: each dataset's source, schedule and jobs, each
 * snapshot's state, and `attention`, plain sentences for anything that needs
 * a look (empty when all is well).
 */
export async function etlStatus(now = Date.now()) {
  const state = await readState();
  const attention = [];
  const jobBuiltAt = jobBuiltTimes(state);
  const cron = cronProblem(state.updatedAt, now);
  if (cron) attention.push(cron);
  const datasets = DATASETS.map((ds) => {
    const s = state.datasets?.[ds.id] ?? {};
    const updated = s.source?.rowsUpdatedAt ?? null;
    const version = sourceVersion(ds, updated, snapshotBuiltAt, jobBuiltAt);
    const overdue = isOverdue(ds.cadence, updated, now);
    if (s.sourceError) attention.push(`${ds.id}: couldn't read the source's metadata (${s.sourceError})`);
    if (overdue) attention.push(`${ds.id}: the source hasn't updated since ${updated.slice(0, 10)}, late for its schedule`);
    const jobs = [ds.metadataJob, ...ds.jobs].map((job) => {
      const j = s.jobs?.[job.key] ?? {};
      if (j.error) attention.push(`${job.key}: last build failed at ${j.failedAt} (${j.error})`);
      return {
        key: job.key,
        builtAt: j.builtAt ?? null,
        reason: j.reason ?? null,
        ms: j.ms ?? null,
        upToDate: Boolean(j.builtAt) && j.sourceVersion === version,
        error: j.error ?? null,
        failedAt: j.failedAt ?? null
      };
    });
    return {
      id: ds.id,
      dashboard: ds.dashboard,
      datasetId: ds.datasetId,
      name: s.source?.name ?? null,
      cadence: cadenceOf(ds.cadence).label,
      rolling: Boolean(ds.rolling),
      sourceUpdatedAt: updated,
      overdue,
      checkedAt: s.checkedAt ?? null,
      jobs
    };
  });
  // Datasets with upkeep the refresh can't do say so themselves (crashes: the monthly full rebuild).
  for (const ds of DATASETS) if (ds.attention) attention.push(...await ds.attention(now));
  const snapshots = SNAPSHOTS.map((snap) => {
    const s = state.snapshots?.[snap.id] ?? {};
    const changes = s.changes ?? [];
    if (changes.length) attention.push(`${snap.id} snapshot is stale: run ${snap.command}, then deploy`);
    return {
      id: snap.id,
      dashboard: snap.dashboard,
      files: snap.files,
      builtAt: snapshotBuiltAt[snap.id] ?? null,
      checkedAt: s.checkedAt ?? null,
      stale: changes.length > 0,
      changes,
      command: snap.command
    };
  });
  return { updatedAt: state.updatedAt ?? null, ok: attention.length === 0, attention, datasets, snapshots };
}
