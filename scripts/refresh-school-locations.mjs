/*
 * Builds src/data/school-locations.json: an address, ZIP, neighborhood and
 * point for every school in "School Quality Reports Data" (dnpx-dfnc), keyed
 * by DBN. The quality reports have no address, so the NYC School Quality
 * Explorer joins this snapshot by DBN.
 *
 *   npm run data:school-locations
 *
 * Sources, in order:
 *   1. "2019 - 2020 School Locations" (wg9x-4ke6), DOE's LCGMS extract. The
 *      newest location file keyed by DBN (system_code), with address,
 *      lat/long, NTA and BBL, but no ZIP.
 *   2. "Facilities Database" (ji82-xba5), DCP, rows from doe_lcgms. Current,
 *      with ZIP, but no DBN. Used for the ZIP (matched by BBL, then by
 *      address in the same borough) and, for schools that opened after
 *      2019-20, the whole location (matched by name in the same borough;
 *      only when exactly one facility has that name).
 *
 * Prints how many schools matched each way and lists the ones that didn't.
 * Schools without a match are left out of the file; the page shows
 * "Address not available" for them.
 */
import { writeFile } from "node:fs/promises";
import { boroughFromDbn } from "../src/lib/schools/config.js";

const DOMAIN = "https://data.cityofnewyork.us";
const SQR_ID = "dnpx-dfnc";
const LOCATIONS_ID = "wg9x-4ke6";
const FACDB_ID = "ji82-xba5";
const OUT_FILE = new URL("../src/data/school-locations.json", import.meta.url);

async function soql(id, params) {
  const url = new URL(`/resource/${id}.json`, DOMAIN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = process.env.SOCRATA_APP_TOKEN ? { "X-App-Token": process.env.SOCRATA_APP_TOKEN } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// "309 47 STREET" → "309 47 Street"; keeps hyphenated Queens numbers.
const titleCase = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase()
  .replace(/(^|[\s\-/(])([a-z])/g, (_, p, c) => p + c.toUpperCase());

const FACDB_BOROS = { MANHATTAN: "Manhattan", BRONX: "Bronx", BROOKLYN: "Brooklyn", QUEENS: "Queens", "STATEN ISLAND": "Staten Island" };

const normAddress = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9 -]/g, " ").replace(/\s+/g, " ").trim();
// Name key for matching: punctuation, filler words and leading zeros go ("P.S. 015" → "PS 15").
const normName = (s) => String(s ?? "").toUpperCase()
  .replace(/[^A-Z0-9 ]/g, " ")
  .replace(/\b(THE|OF|AND|FOR|AT|SCHOOL|ACADEMY|HIGH)\b/g, " ")
  .replace(/\b0+(\d)/g, "$1")
  .replace(/\s+/g, " ").trim();
const bbl = (v) => (v ? String(Math.trunc(Number(v))) : "");
const coord = (v) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? Math.round(Number(v) * 1e6) / 1e6 : null);

const [schools, lcgms, facdb] = await Promise.all([
  soql(SQR_ID, { $select: "dbn, max(school_name) AS name", $group: "dbn", $limit: "10000" }),
  soql(LOCATIONS_ID, { $limit: "10000" }),
  soql(FACDB_ID, {
    $select: "facname, address, zipcode, boro, bbl, latitude, longitude, nta2020",
    $where: "datasource = 'doe_lcgms'",
    $limit: "10000"
  })
]);
console.log(`${schools.length} schools in ${SQR_ID}, ${lcgms.length} locations in ${LOCATIONS_ID}, ${facdb.length} DOE facilities in ${FACDB_ID}`);

const byDbn = new Map(lcgms.map((r) => [String(r.system_code ?? "").trim(), r]));
const facByBbl = new Map();
const facByAddress = new Map();
const facByName = new Map();
const push = (map, key, row) => { if (key) map.set(key, [...(map.get(key) ?? []), row]); };
for (const f of facdb) {
  const boro = FACDB_BOROS[f.boro];
  push(facByBbl, bbl(f.bbl), f);
  push(facByAddress, `${boro}|${normAddress(f.address)}`, f);
  push(facByName, `${boro}|${normName(f.facname)}`, f);
}
// One answer or none: a key shared by two different ZIPs (or facilities) is ambiguous.
const zipOf = (rows) => {
  const zips = new Set((rows ?? []).map((f) => f.zipcode).filter(Boolean));
  return zips.size === 1 ? [...zips][0] : null;
};

const out = {};
const counts = { lcgms: 0, zipByBbl: 0, zipByAddress: 0, noZip: 0, facdbByName: 0, missing: [] };
for (const s of schools) {
  const dbn = s.dbn.trim();
  const boro = boroughFromDbn(dbn);
  const loc = byDbn.get(dbn);
  if (loc) {
    counts.lcgms++;
    let zip = zipOf(facByBbl.get(bbl(loc.borough_block_lot)));
    if (zip) counts.zipByBbl++;
    else {
      zip = zipOf(facByAddress.get(`${boro}|${normAddress(loc.primary_address_line_1)}`));
      if (zip) counts.zipByAddress++; else counts.noZip++;
    }
    out[dbn] = {
      address: titleCase(loc.primary_address_line_1),
      zip,
      neighborhood: loc.nta_name ? loc.nta_name.trim() : null,
      lat: coord(loc.latitude),
      lon: coord(loc.longitude),
      source: LOCATIONS_ID
    };
    continue;
  }
  const named = facByName.get(`${boro}|${normName(s.name)}`) ?? [];
  if (named.length === 1) {
    const f = named[0];
    counts.facdbByName++;
    out[dbn] = {
      address: titleCase(f.address),
      zip: f.zipcode || null,
      neighborhood: null,
      lat: coord(f.latitude),
      lon: coord(f.longitude),
      source: FACDB_ID
    };
    continue;
  }
  counts.missing.push(`${dbn} ${s.name}${named.length > 1 ? ` (${named.length} facilities share the name)` : ""}`);
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(OUT_FILE, `${JSON.stringify(sorted, null, 0).replace(/},"/g, '},\n"')}\n`);

console.log(`Matched by DBN in ${LOCATIONS_ID}: ${counts.lcgms} (ZIP by BBL ${counts.zipByBbl}, by address ${counts.zipByAddress}, none ${counts.noZip})`);
console.log(`Matched by name in ${FACDB_ID}: ${counts.facdbByName}`);
console.log(`No location: ${counts.missing.length}`);
for (const m of counts.missing) console.log(`  ${m}`);
console.log(`Wrote ${Object.keys(sorted).length} schools to ${OUT_FILE.pathname}`);
