/*
 * A lookup, start to finish: candidates from the database (search-sql.js),
 * each re-scored with its vehicles and people (score.js), the best
 * MAX_RESULTS described for the results list. No Worker imports, so tests
 * run it against the local SQLite build.
 *
 *   db  { all(sql, params) → Promise<rows> }: D1 in the Worker
 *       (src/lib/server/crashes.js), node:sqlite in tests
 */
import { candidateQuery, CANDIDATES } from "./search-sql.js";
import { scoreCrash } from "./score.js";
import { onlyDates } from "./query.js";
import { vehiclesLine, locationLine, areaLine, whenLine, roleCounts, roleCountsLine } from "./present.js";

export const MAX_RESULTS = 50;
// More candidates than this and the lookup asks for more details.
export const BROAD_TOTAL = 300;

// Rows for a list of crashes, one query per table; a JSON array keeps it to one parameter.
const IN_IDS = "collision_id IN (SELECT value FROM json_each(?))";

export async function crashRows(db, ids) {
  const list = JSON.stringify(ids);
  const [crashes, streets, vehicles, persons] = await Promise.all([
    db.all(`SELECT * FROM crashes WHERE ${IN_IDS}`, [list]),
    db.all(`SELECT collision_id, street, street_base, field FROM crash_streets WHERE ${IN_IDS}`, [list]),
    db.all(`SELECT * FROM vehicles WHERE ${IN_IDS} ORDER BY unique_id`, [list]),
    db.all(`SELECT * FROM persons WHERE ${IN_IDS} ORDER BY unique_id`, [list])
  ]);
  const by = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.collision_id, [...(m.get(r.collision_id) ?? []), r]);
    return m;
  };
  const s = by(streets), v = by(vehicles), p = by(persons);
  return new Map(crashes.map((c) => [c.collision_id, {
    crash: { ...c, street_keys: s.get(c.collision_id) ?? [] },
    vehicles: v.get(c.collision_id) ?? [],
    persons: p.get(c.collision_id) ?? []
  }]));
}

function card(record, fit) {
  const { crash, vehicles, persons } = record;
  const counts = roleCounts(persons);
  return {
    collisionId: crash.collision_id,
    ...whenLine(crash),
    location: locationLine(crash),
    area: areaLine(crash),
    vehicles: vehiclesLine(vehicles),
    people: roleCountsLine(counts),
    roleCounts: counts,
    injured: crash.persons_injured ?? 0,
    killed: crash.persons_killed ?? 0,
    score: fit.score,
    percent: fit.percent,
    chips: fit.chips,
    missed: fit.missed,
    vehicleRef: fit.vehicleRef,
    personRef: fit.personRef
  };
}

/*
 * → { total, results: [card], broad, dateOnly }
 *   total    crashes in the range matching at least one criterion
 *   broad    true when that's too many to look through: ask for more details
 */
export async function searchCrashes(db, criteria) {
  const { sql, params } = candidateQuery(criteria, CANDIDATES);
  const ranked = await db.all(sql, params);
  const total = ranked[0]?.total ?? 0;
  if (!ranked.length) return { total: 0, results: [], broad: false, dateOnly: onlyDates(criteria) };

  const records = await crashRows(db, ranked.map((r) => r.collision_id));
  const scored = ranked
    .map((r) => records.get(r.collision_id))
    .filter(Boolean)
    .map((rec) => ({ rec, fit: scoreCrash(criteria, rec) }));
  scored.sort((a, b) => b.fit.score - a.fit.score ||
    (b.rec.crash.crash_date < a.rec.crash.crash_date ? -1 : b.rec.crash.crash_date > a.rec.crash.crash_date ? 1 : 0) ||
    (b.rec.crash.crash_minute ?? -1) - (a.rec.crash.crash_minute ?? -1));

  return {
    total,
    results: scored.slice(0, MAX_RESULTS).map(({ rec, fit }) => card(rec, fit)),
    broad: total > BROAD_TOTAL,
    dateOnly: onlyDates(criteria)
  };
}
