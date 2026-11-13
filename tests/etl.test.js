/*
 * The data refresh policy (src/lib/etl/cadence.js): when the scheduled refresh
 * rebuilds a job, when a source counts as late, and when a build-time
 * snapshot is stale.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CADENCES, refreshReason, sourceVersion, isOverdue, snapshotChanges, rebuildHours, requestMaxAgeHours, cronProblem
} from "../src/lib/etl/cadence.js";
import { SNAPSHOTS } from "../src/lib/etl/snapshots.js";

const H = 3600e3;
const NOW = Date.parse("2026-10-29T12:15:00Z");
const ago = (hours) => new Date(NOW - hours * H).toISOString();
const built = (hours, sourceVersion = "v1") => ({ builtAt: ago(hours), sourceVersion });

test("a job that was never built (new, or a new key) is built", () => {
  assert.equal(refreshReason({ cadence: "yearly" }, undefined, "v1", NOW), "never built");
  assert.equal(refreshReason({ cadence: "yearly" }, {}, null, NOW), "never built");
});

test("an unchanged source doesn't rebuild until the cadence's safety rebuild", () => {
  const yearly = { cadence: "yearly" };
  assert.equal(refreshReason(yearly, built(24), "v1", NOW), null);
  assert.equal(refreshReason(yearly, built(29 * 24), "v1", NOW), null);
  assert.equal(refreshReason(yearly, built(30 * 24), "v1", NOW), "scheduled rebuild");
  assert.equal(refreshReason({ cadence: "monthly" }, built(6 * 24), "v1", NOW), null);
  assert.equal(refreshReason({ cadence: "monthly" }, built(7 * 24), "v1", NOW), "scheduled rebuild");
});

test("a changed source rebuilds, but not more often than minGapHours", () => {
  const monthly = { cadence: "monthly" };
  assert.equal(refreshReason(monthly, built(13), "v2", NOW), "source updated");
  assert.equal(refreshReason(monthly, built(2), "v2", NOW), null);
  assert.equal(refreshReason({ ...monthly, minGapHours: 0 }, built(0.1), "v2", NOW), "source updated");
});

test("an unreadable source falls back to the age rule", () => {
  assert.equal(refreshReason({ cadence: "daily" }, built(3), null, NOW), null);
  assert.equal(refreshReason({ cadence: "daily" }, built(25), null, NOW), "scheduled rebuild");
});

test("rolling jobs rebuild daily whatever their cadence, with slack for cron timing", () => {
  const rolling = { cadence: "monthly", rolling: true };
  assert.equal(refreshReason(rolling, built(20), "v1", NOW), null);
  assert.equal(refreshReason(rolling, built(22.5), "v1", NOW), "new day"); // last run started late
  assert.equal(rebuildHours("yearly", true), 24);
});

test("a dataset's own rebuildHours and minGapHours override rolling's day (crash hotspots: every 3 days)", async () => {
  const { crashesDataset } = await import("./support/workers.js").then(() => import("../src/lib/server/crashes.js"));
  assert.equal(refreshReason(crashesDataset, built(22.5), "v2", NOW), null, "a new day and a changed source aren't enough");
  assert.equal(refreshReason(crashesDataset, built(60), "v2", NOW), null);
  assert.equal(refreshReason(crashesDataset, built(69.5), "v1", NOW), "new day", "a late run is still in time");
  assert.equal(refreshReason(crashesDataset, built(72), "v2", NOW), "source updated");
});

test("outside production, requests only recompute once the refresh is clearly behind", () => {
  assert.equal(requestMaxAgeHours("daily", true), 26);
  assert.equal(requestMaxAgeHours("yearly"), 30 * 24 + 2);
  for (const name of Object.keys(CADENCES)) assert.ok(requestMaxAgeHours(name) > rebuildHours(name));
});

test("unknown cadences fail loudly", () => {
  assert.throws(() => refreshReason({ cadence: "fortnightly" }, built(1), "v1", NOW), /Unknown cadence/);
});

test("the source version includes the bundled snapshots a job joins", () => {
  assert.equal(sourceVersion({}, "2026-04-09T00:20:00.000Z"), "2026-04-09T00:20:00.000Z");
  assert.equal(
    sourceVersion({ snapshots: ["school-locations"] }, "2026-04-09T00:20:00.000Z", { "school-locations": "2026-10-29T13:50:02.000Z" }),
    "2026-04-09T00:20:00.000Z school-locations@2026-10-29T13:50:02.000Z"
  );
  assert.equal(sourceVersion({ snapshots: ["school-locations"] }, null), null);
});

test("a source is late after its cadence's overdueDays; as-needed never is", () => {
  assert.equal(isOverdue("daily", ago(2 * 24), NOW), false);
  assert.equal(isOverdue("daily", ago(4 * 24), NOW), true);
  assert.equal(isOverdue("yearly", ago(300 * 24), NOW), false);
  assert.equal(isOverdue("as-needed", ago(5000 * 24), NOW), false);
  assert.equal(isOverdue("daily", null, NOW), false);
});

test("a snapshot is stale when a source's rows changed after it was built", () => {
  const snap = { sources: [{ datasetId: "aaaa-1111" }, { datasetId: "bbbb-2222" }] };
  const builtAt = "2026-10-28T19:52:48.000Z";
  assert.deepEqual(snapshotChanges(snap, builtAt, {
    "aaaa-1111": { rowsUpdatedAt: "2026-04-16T10:00:00.000Z" },
    "bbbb-2222": { rowsUpdatedAt: "2026-10-28T19:00:00.000Z" }
  }), []);
  assert.deepEqual(snapshotChanges(snap, builtAt, {
    "aaaa-1111": { rowsUpdatedAt: "2026-10-29T13:51:00.000Z" }
  }), [{ datasetId: "aaaa-1111", why: "rows updated 2026-10-29" }]);
  // never recorded: stale, so the first refresh records it
  assert.equal(snapshotChanges(snap, undefined, { "aaaa-1111": { rowsUpdatedAt: "2020-01-01T00:00:00.000Z" } }).length, 1);
});

test("an attachment source only changes when the file is replaced, not when rows update", () => {
  const snap = { sources: [{ datasetId: "cccc-3333", attachment: { match: "Sites", assetId: "old" } }] };
  const rows = { rowsUpdatedAt: "2026-10-29T18:56:00.000Z" };
  assert.deepEqual(snapshotChanges(snap, "2026-10-28T00:00:00.000Z", {
    "cccc-3333": { ...rows, attachments: [{ name: "Sites_2021.xlsx", assetId: "old" }, { name: "Dictionary.xlsx", assetId: "x" }] }
  }), []);
  assert.deepEqual(snapshotChanges(snap, "2026-10-28T00:00:00.000Z", {
    "cccc-3333": { ...rows, attachments: [{ name: "Sites_2026.xlsx", assetId: "new" }] }
  }), [{ datasetId: "cccc-3333", why: "attachment replaced (Sites_2026.xlsx)" }]);
});

test("every snapshot names its files, its refresh command and its sources", () => {
  const ids = new Set();
  for (const s of SNAPSHOTS) {
    assert.ok(!ids.has(s.id), `duplicate snapshot ${s.id}`);
    ids.add(s.id);
    assert.ok(s.files.length && s.command.startsWith("npm run data:") && s.sources.length, s.id);
  }
});

test("the status flags a cron that never ran or has stopped", () => {
  assert.equal(cronProblem(null, NOW), "the scheduled refresh has never run");
  assert.equal(cronProblem(ago(1), NOW), null);
  assert.equal(cronProblem(ago(25), NOW), null);
  assert.match(cronProblem(ago(27), NOW), /hasn't run since .* \(27 h ago\)/);
});
