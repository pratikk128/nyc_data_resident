/*
 * The SQL that picks candidate crashes for a search: every crash in the
 * date range that matches at least one criterion, ranked by roughly the
 * score score.js gives (same WEIGHTS; distance and the finer points are
 * left to score.js, which re-ranks the top CANDIDATES). Runs on D1 and on
 * the local SQLite build alike.
 *
 * Candidates come from indexed lookups (a make, a type, a street, a ZIP, a
 * borough, a box around a spot) unioned together, so a search reads the
 * rows it might return rather than every crash. A search with only a time
 * of day or person details has nothing to index on and reads the date
 * range.
 *
 * Every value is a bound, numbered parameter. D1 allows 100 per statement;
 * the most a search can use is about 70 (a test checks the cap).
 */
import { WEIGHTS as W, NEAR_MINUTES, AGE_NEAR, AGE_FAR } from "./score.js";

export const CANDIDATES = 400;

// Degrees of latitude / longitude per meter at NYC's latitude, for the box around a spot.
const LAT_PER_M = 1 / 111320;
const LON_PER_M = 1 / (111320 * Math.cos((40.7 * Math.PI) / 180));

export function candidateQuery(c, limit = CANDIDATES) {
  const params = [];
  // Numbered (?1, ?2 …), so the pieces can be built in any order and still bind right.
  const p = (v) => { params.push(v); return `?${params.length}`; };
  const dates = () => `crash_date BETWEEN ${p(c.dateFrom)} AND ${p(c.dateTo)}`;
  const ctes = [];
  const sources = []; // SELECT collision_id … for the candidate union
  const scoreParts = [];

  // ---- Vehicles: the best vehicle's points ----
  const v = c.vehicle;
  if (v) {
    const any = [], parts = [];
    // Each call adds its own parameters (they're positional), so a test can appear twice.
    const makeSql = () => (v.make.key
      ? `make_key = ${p(v.make.key)}`
      : `replace(replace(upper(make_raw), ' ', ''), '-', '') LIKE ${p(`${v.make.text.replace(/[^A-Z0-9]/g, "").slice(0, 4)}%`)}`);
    const yearSql = (slack) => `vehicle_year BETWEEN ${p(v.yearFrom - slack)} AND ${p(v.yearTo + slack)}`;
    if (v.make) {
      any.push(makeSql());
      parts.push(`(CASE WHEN ${makeSql()} THEN ${v.make.key ? W.make : W.makePartial} ELSE 0 END)`);
    }
    if (v.yearFrom != null) {
      any.push(yearSql(1));
      parts.push(`(CASE WHEN ${yearSql(0)} THEN ${W.year} WHEN ${yearSql(1)} THEN ${W.yearNear} ELSE 0 END)`);
    }
    if (v.make && v.yearFrom != null) {
      parts.push(`(CASE WHEN ${makeSql()} AND ${yearSql(1)} THEN ${W.makeAndYear} ELSE 0 END)`);
    }
    if (v.type) {
      any.push(`type_key = ${p(v.type)}`);
      parts.push(`(CASE WHEN type_key = ${p(v.type)} THEN ${W.type} ELSE 0 END)`);
    }
    if (v.state) {
      any.push(`state_registration = ${p(v.state)}`);
      parts.push(`(CASE WHEN state_registration = ${p(v.state)} THEN ${v.state === "NY" ? W.stateNY : W.stateOther} ELSE 0 END)`);
    }
    if (v.direction) {
      any.push(`travel_direction = ${p(v.direction)}`);
      parts.push(`(CASE WHEN travel_direction = ${p(v.direction)} THEN ${W.direction} ELSE 0 END)`);
    }
    ctes.push(`vs AS (SELECT collision_id, MAX(${parts.join(" + ")}) AS s FROM vehicles
      WHERE ${dates()} AND (${any.join(" OR ")}) GROUP BY collision_id)`);
    sources.push("SELECT collision_id FROM vs");
    scoreParts.push("COALESCE(vs.s, 0)");
  }

  // ---- People in the crash: the best person's points ----
  const per = c.person;
  if (per) {
    const any = [], parts = [];
    if (per.role) {
      any.push(`role = ${p(per.role)}`);
      parts.push(`(CASE WHEN role = ${p(per.role)} THEN ${W.role} ELSE 0 END)`);
    }
    if (per.ageFrom != null) {
      const lo = per.ageFrom, hi = per.ageTo;
      any.push(`age BETWEEN ${p(lo - AGE_FAR)} AND ${p(hi + AGE_FAR)}`);
      parts.push(`(CASE WHEN age BETWEEN ${p(lo)} AND ${p(hi)} THEN ${W.age}
        WHEN age BETWEEN ${p(lo - AGE_NEAR)} AND ${p(hi + AGE_NEAR)} THEN ${W.ageNear}
        WHEN age BETWEEN ${p(lo - AGE_FAR)} AND ${p(hi + AGE_FAR)} THEN ${W.ageFar} ELSE 0 END)`);
    }
    if (per.injured != null) {
      const hurt = "injury IN ('Injured', 'Killed')";
      const test = per.injured ? hurt : `NOT (${hurt}) OR injury IS NULL`;
      any.push(`(${test})`);
      parts.push(`(CASE WHEN ${test} THEN ${W.injured} ELSE 0 END)`);
    }
    if (per.position) {
      if (per.position === "rear") {
        any.push("position_key LIKE 'rear-%'");
        parts.push(`(CASE WHEN position_key LIKE 'rear-%' THEN ${W.position} ELSE 0 END)`);
      } else {
        const near = per.position.startsWith("rear-") ? `WHEN position_key LIKE 'rear-%' THEN ${W.positionNear}` : "";
        any.push(per.position.startsWith("rear-") ? "position_key LIKE 'rear-%'" : `position_key = ${p(per.position)}`);
        parts.push(`(CASE WHEN position_key = ${p(per.position)} THEN ${W.position} ${near} ELSE 0 END)`);
      }
    }
    if (per.sex) {
      any.push(`sex = ${p(per.sex)}`);
      parts.push(`(CASE WHEN sex = ${p(per.sex)} THEN ${W.sex} ELSE 0 END)`);
    }
    ctes.push(`ps AS (SELECT collision_id, MAX(${parts.join(" + ")}) AS s FROM persons
      WHERE ${dates()} AND involved = 1 AND (${any.join(" OR ")}) GROUP BY collision_id)`);
    sources.push("SELECT collision_id FROM ps");
    scoreParts.push("COALESCE(ps.s, 0)");
  }

  // ---- Streets: each street asked for, exact or close, anywhere on the crash ----
  if (c.streets.length) {
    const per = c.streets.map((s) =>
      `MAX(CASE WHEN street = ${p(s.key)} THEN 1 WHEN street_base = ${p(s.base)} THEN ${W.closeStreet} ELSE 0 END)`);
    const total = c.streets.length > 1 ? `(${per.join(" + ")}) * ${W.bothStreets / 2}` : `${per[0]} * ${W.oneStreet}`;
    const match = c.streets.map((s) => `street = ${p(s.key)} OR street_base = ${p(s.base)}`).join(" OR ");
    ctes.push(`ss AS (SELECT collision_id, ${total} AS s FROM crash_streets
      WHERE ${dates()} AND (${match}) GROUP BY collision_id)`);
    sources.push("SELECT collision_id FROM ss");
    scoreParts.push("COALESCE(ss.s, 0)");
  }

  // ---- The crash itself: ZIP, borough, near a spot, time of day ----
  const crashAny = [];
  if (c.zip) {
    crashAny.push(`zip_code = ${p(c.zip)}`);
    scoreParts.push(`(CASE WHEN c.zip_code = ${p(c.zip)} THEN ${W.zip} ELSE 0 END)`);
  }
  if (c.borough) {
    crashAny.push(`borough = ${p(c.borough)}`);
    scoreParts.push(`(CASE WHEN c.borough = ${p(c.borough)} THEN ${W.borough} ELSE 0 END)`);
  }
  if (c.point) {
    const dLat = c.point.radius * LAT_PER_M, dLon = c.point.radius * LON_PER_M;
    const box = (t) => `${t}latitude BETWEEN ${p(c.point.lat - dLat)} AND ${p(c.point.lat + dLat)} AND ${t}longitude BETWEEN ${p(c.point.lon - dLon)} AND ${p(c.point.lon + dLon)}`;
    crashAny.push(`(${box("")})`);
    // Closer is better; score.js uses the true distance.
    scoreParts.push(`(CASE WHEN ${box("c.")} THEN ${W.nearMax} ELSE 0 END)`);
  }
  if (c.time) {
    const { from, to } = c.time;
    const inWindow = (t, lo, hi) => (lo <= hi
      ? `${t}crash_minute BETWEEN ${p(lo)} AND ${p(hi)}`
      : `(${t}crash_minute >= ${p(lo)} OR ${t}crash_minute <= ${p(hi)})`);
    const wide = [(from - NEAR_MINUTES + 1440) % 1440, (to + NEAR_MINUTES) % 1440];
    crashAny.push(inWindow("", wide[0], wide[1]));
    scoreParts.push(`(CASE WHEN ${inWindow("c.", from, to)} THEN ${W.time} WHEN ${inWindow("c.", wide[0], wide[1])} THEN ${W.timeNear} ELSE 0 END)`);
  }
  if (crashAny.length) sources.push(`SELECT collision_id FROM crashes WHERE ${dates()} AND (${crashAny.join(" OR ")})`);
  // Only dates: every crash in the range is a candidate, newest first.
  if (!sources.length) sources.push(`SELECT collision_id FROM crashes WHERE ${dates()}`);

  ctes.push(`cand AS (${sources.join("\n    UNION\n    ")})`);
  const joins = [
    v && "LEFT JOIN vs ON vs.collision_id = c.collision_id",
    per && "LEFT JOIN ps ON ps.collision_id = c.collision_id",
    c.streets.length && "LEFT JOIN ss ON ss.collision_id = c.collision_id"
  ].filter(Boolean);
  const score = scoreParts.length ? scoreParts.join(" + ") : "0";
  const sql = `WITH ${ctes.join(",\n  ")}
SELECT c.collision_id, ${score} AS score, count(*) OVER () AS total
FROM cand JOIN crashes c ON c.collision_id = cand.collision_id
  ${joins.join("\n  ")}
WHERE c.${dates()}
ORDER BY score DESC, c.crash_date DESC, c.crash_minute DESC, c.collision_id
LIMIT ${p(limit)}`;
  return { sql, params };
}
