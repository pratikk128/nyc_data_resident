/*
 * The crash lookup's tables, as SQLite (the local build in .data/crashes/
 * and Cloudflare D1 run the same SQL). Rows come from rows.js.
 *
 * Raw values are kept as the city wrote them for display; the *_key columns
 * are the normalized forms the search matches on. Every table carries
 * crash_date so a search can narrow each one to its date range without a
 * join, and `h`, a hash of the source row, so the daily sync only writes
 * rows that changed.
 *
 * Lists that are only ever shown (contributing factors, vehicle damage,
 * the crash's vehicle type codes) are JSON arrays.
 */

export const TABLES = {
  crashes: `CREATE TABLE crashes (
    collision_id TEXT PRIMARY KEY,
    crash_date TEXT NOT NULL,          -- YYYY-MM-DD
    crash_minute INTEGER,              -- minutes after midnight, null when not recorded
    borough TEXT,
    zip_code TEXT,
    latitude REAL,
    longitude REAL,
    on_street TEXT,
    cross_street TEXT,
    off_street TEXT,
    persons_injured INTEGER, persons_killed INTEGER,
    pedestrians_injured INTEGER, pedestrians_killed INTEGER,
    cyclists_injured INTEGER, cyclists_killed INTEGER,
    motorists_injured INTEGER, motorists_killed INTEGER,
    factors TEXT,                      -- JSON: contributing_factor_vehicle_1..5
    vehicle_codes TEXT,                -- JSON: vehicle_type_code1..5
    h TEXT NOT NULL
  )`,

  // One row per street a crash names, so "Broadway & W 72 St" finds either
  // street in on/cross/off with one index lookup each.
  crash_streets: `CREATE TABLE crash_streets (
    street TEXT NOT NULL,              -- streetMatchKey()
    street_base TEXT NOT NULL,         -- streetBaseKey(): without East/West/North/South, for "72 St"
    collision_id TEXT NOT NULL,
    crash_date TEXT NOT NULL,
    field TEXT NOT NULL,               -- on | cross | off
    PRIMARY KEY (street, collision_id, field)
  ) WITHOUT ROWID`,

  vehicles: `CREATE TABLE vehicles (
    unique_id TEXT PRIMARY KEY,        -- persons.vehicle_ref points here
    collision_id TEXT NOT NULL,
    crash_date TEXT NOT NULL,
    vehicle_uuid TEXT,                 -- the source's vehicle_id; nothing joins on it
    state_registration TEXT,
    type_raw TEXT,
    type_key TEXT,                     -- vehicle-types.js
    make_raw TEXT,
    make_key TEXT,                     -- makes.js
    make_class TEXT,                   -- car | truck | motorcycle, from the make's suffix
    vehicle_year INTEGER,
    travel_direction TEXT,
    occupants INTEGER,
    driver_sex TEXT,
    license_status TEXT,
    license_jurisdiction TEXT,
    pre_crash TEXT,
    point_of_impact TEXT,
    damage TEXT,                       -- JSON: vehicle_damage, _1, _2, _3
    public_property_damage TEXT,
    public_property_damage_type TEXT,
    factors TEXT,                      -- JSON: contributing_factor_1, _2
    h TEXT NOT NULL
  )`,

  persons: `CREATE TABLE persons (
    unique_id TEXT PRIMARY KEY,
    collision_id TEXT NOT NULL,
    crash_date TEXT NOT NULL,
    person_id TEXT,
    vehicle_ref TEXT,                  -- vehicles.unique_id
    person_type TEXT,
    ped_role TEXT,
    role TEXT,                         -- normalize.js personRole()
    involved INTEGER NOT NULL,         -- 0 for registrants, owners, witnesses, people notified
    age INTEGER,
    sex TEXT,
    injury TEXT,
    position TEXT,
    position_key TEXT,                 -- normalize.js positionKey()
    safety_equipment TEXT,
    ejection TEXT,
    emotional_status TEXT,
    bodily_injury TEXT,
    complaint TEXT,
    ped_location TEXT,
    ped_action TEXT,
    factors TEXT,                      -- JSON: contributing_factor_1, _2
    h TEXT NOT NULL
  )`,

  // NYC Crash Hotspots: one row per crash with its filters worked out (facts.js),
  // so the dashboard's counts read one narrow table with no joins.
  crash_facts: `CREATE TABLE crash_facts (
    collision_id TEXT PRIMARY KEY,
    crash_date TEXT NOT NULL,
    hour INTEGER,                      -- 0–23, null when not recorded
    dow INTEGER NOT NULL,              -- 0 Monday … 6 Sunday
    borough TEXT,
    zip_code TEXT,
    lat REAL,
    lon REAL,
    cell TEXT,                         -- facts.js cellOf(): the map's ~165 m grid square
    corner TEXT,                       -- facts.js cornerOf(): on & cross street, either order
    corner_label TEXT,
    severity INTEGER NOT NULL,         -- 0 none, 1 hurt, 2 seriously hurt, 3 killed (the worst person)
    killed INTEGER NOT NULL,
    injured INTEGER NOT NULL,
    serious INTEGER NOT NULL,          -- people seriously hurt
    ped_killed INTEGER NOT NULL,       -- the same three counts for pedestrians, cyclists and e-riders only
    ped_serious INTEGER NOT NULL,      -- (facts.js KIND_COLUMNS); injured includes the seriously hurt
    ped_injured INTEGER NOT NULL,
    cyc_killed INTEGER NOT NULL,
    cyc_serious INTEGER NOT NULL,
    cyc_injured INTEGER NOT NULL,
    erider_killed INTEGER NOT NULL,
    erider_serious INTEGER NOT NULL,
    erider_injured INTEGER NOT NULL,
    who INTEGER NOT NULL,              -- bitmasks over facts.js WHO, CAUSES, MANEUVERS, VEHICLES
    causes INTEGER NOT NULL,
    maneuvers INTEGER NOT NULL,
    vehicles INTEGER NOT NULL,
    h TEXT NOT NULL                    -- of the crash's, its vehicles' and its persons' hashes
  )`,

  // One row per full build or daily sync.
  ingest_log: `CREATE TABLE ingest_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                -- full | sync
    started_at TEXT NOT NULL,
    finished_at TEXT,
    date_from TEXT,
    date_to TEXT,
    counts TEXT,                       -- JSON: rows per table (full) or rows written/deleted (sync)
    orphans TEXT,                      -- JSON: { vehicles, persons, personVehicles, samples }
    note TEXT
  )`
};

export const INDEXES = [
  "CREATE INDEX crashes_date ON crashes (crash_date)",
  "CREATE INDEX crashes_zip ON crashes (zip_code, crash_date)",
  "CREATE INDEX crashes_borough ON crashes (borough, crash_date)",
  "CREATE INDEX crashes_lat ON crashes (latitude)",
  "CREATE INDEX crash_streets_collision ON crash_streets (collision_id)",
  "CREATE INDEX crash_streets_base ON crash_streets (street_base, crash_date)",
  "CREATE INDEX vehicles_collision ON vehicles (collision_id)",
  "CREATE INDEX vehicles_make ON vehicles (make_key, crash_date)",
  "CREATE INDEX vehicles_type ON vehicles (type_key, crash_date)",
  "CREATE INDEX vehicles_date ON vehicles (crash_date)",
  "CREATE INDEX persons_collision ON persons (collision_id)",
  "CREATE INDEX persons_vehicle ON persons (vehicle_ref)",
  "CREATE INDEX persons_date ON persons (crash_date)",
  "CREATE INDEX crash_facts_date ON crash_facts (crash_date)",
  "CREATE INDEX crash_facts_zip ON crash_facts (zip_code)",
  "CREATE INDEX crash_facts_borough ON crash_facts (borough)",
  "CREATE INDEX crash_facts_corner ON crash_facts (corner)",
  "CREATE INDEX crash_facts_lat ON crash_facts (lat)"
];

// Columns per table, in CREATE order, for INSERTs (rows.js builds objects with these keys).
export const COLUMNS = Object.fromEntries(Object.entries(TABLES).map(([name, sql]) => [
  name,
  [...sql.replace(/--.*$/gm, "").matchAll(/\b(\w+) (?:TEXT|INTEGER|REAL)\b/g)].map((m) => m[1])
]));
