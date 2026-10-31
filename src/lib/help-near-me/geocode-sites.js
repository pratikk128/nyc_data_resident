/*
 * Finding a point for help sites with NYC GeoSearch
 * (src/lib/complaints311/geocode.js). Runs in the ETL job
 * (src/lib/server/help-near-me.js), never on a request. Kept apart from the
 * server module so the tests can pass a fake lookup.
 *
 * Two kinds of site get looked up by address:
 *   - no lat/lon in the directory (a few NYCHA, DYCD and NYC Aging rows)
 *   - a lat/lon far from the site's own ZIP code (Oct 2026: Homebase's
 *     "2322 3rd Ave" in East Harlem sits at East 17th Street). The row's ZIP
 *     can be the typo instead, so these are looked up in their borough only,
 *     and keep their point when the lookup finds nothing.
 */
import { parseLocationInput } from "../complaints311/location-input.js";
import { resolveLocation } from "../complaints311/geocode.js";
import { haversineMiles } from "./distance.js";

const MAX_GEOCODES = 80;   // per directory per build; each is one GeoSearch request
export const SUSPECT_MILES = 3; // farther than this from its ZIP's middle, a point gets checked

/*
 * The part of an address GeoSearch can match: "1910 Monterey Avenue, 5th Fl." →
 * "1910 Monterey Avenue"; "2972 / 2968 Bronx Park East" → "2972 Bronx Park East";
 * "80 Avenue D / 807 East 6th Street" → "80 Avenue D";
 * "temp. site- 30-14 Crescent street" → "30-14 Crescent street".
 */
export function lookupText(address) {
  const first = String(address ?? "").split(/[,;]/)[0].trim().replace(/^[^\d]*[:-]\s*(?=\d)/, "");
  const range = first.match(/^(\d[\w-]*)\s*\/\s*\d[\w-]*\s+(.+)$/);
  return range ? `${range[1]} ${range[2]}` : first.split(/\s+\/\s+/)[0];
}

/*
 * What to try for a site, in order, until one is an exact match:
 *   1. its address in its borough;
 *   2. without a letter on the house number ("34-35A 12th Street" is 34-35 to GeoSearch);
 *   3. for a site with no point, in any borough: the directory can name the wrong one
 *      (Oct 2026: NYCHA's "1131 Findlay Avenue", Bronx, listed in Manhattan). It only
 *      counts when one borough has that exact address.
 */
function lookups(s, suspect) {
  const text = lookupText(s.address);
  const zip = suspect ? "" : s.zip ?? "";
  const borough = s.borough?.toUpperCase() ?? "";
  const out = [{ text, borough, zip }];
  const plain = text.replace(/^(\d[\d-]*)[a-z]\b/i, "$1");
  if (plain !== text) out.push({ text: plain, borough, zip });
  if (borough && s.lat == null) out.push(...out.map((a) => ({ ...a, borough: "" })));
  return out;
}

/*
 * Sites with no point, or a point far from their ZIP (zips: { "10457": [lat, lon] }),
 * looked up by address. Only an exact match counts (same house number and
 * street, in the site's borough); a site with no point that doesn't match is
 * logged and left out. → { sites, failed: [{ name, address, why }], moved: [{ name, address, miles }] }
 */
export async function geocodeMissing(sites, { resolve = resolveLocation, zips = {}, label = "", log = console.warn } = {}) {
  const out = [], failed = [], moved = [];
  let tried = 0;
  for (const s of sites) {
    const hasPoint = s.lat != null && s.lon != null;
    const zipMiddle = hasPoint && zips[s.zip];
    const suspect = Boolean(zipMiddle) && haversineMiles(s, { lat: zipMiddle[0], lon: zipMiddle[1] }) > SUSPECT_MILES;
    if (hasPoint && !suspect) { out.push(s); continue; }
    if (tried >= MAX_GEOCODES) {
      if (hasPoint) out.push(s); else failed.push({ name: s.name, address: s.address, why: "geocode limit" });
      continue;
    }
    tried++;
    let result = { status: "not-found" };
    try {
      for (const attempt of lookups(s, suspect)) {
        const parsed = parseLocationInput(attempt);
        if (parsed.kind !== "address") continue;
        const r = await resolve(parsed);
        if (r.status === "resolved" || result.status === "not-found") result = r;
        if (result.status === "resolved") break;
      }
    } catch (err) {
      result = { status: err.message };
    }
    if (result.status === "resolved" && result.location.kind === "point") {
      const point = { lat: result.location.lat, lon: result.location.lon };
      if (suspect) moved.push({ name: s.name, address: s.address, miles: Math.round(haversineMiles(s, point) * 10) / 10 });
      out.push({ ...s, ...point, geocoded: true });
    } else if (hasPoint) {
      out.push(s); // a suspect point the lookup couldn't place stays where the city put it
    } else {
      failed.push({ name: s.name, address: s.address, why: result.status });
    }
  }
  if (failed.length) {
    log(`help-near-me ${label}: ${failed.length} site(s) not geocoded: ${failed.map((f) => `${f.name} (${f.address}): ${f.why}`).join("; ")}`);
  }
  if (moved.length) {
    log(`help-near-me ${label}: ${moved.length} site(s) moved to their address: ${moved.map((m) => `${m.name} (${m.address}): ${m.miles} mi`).join("; ")}`);
  }
  return { sites: out, failed, moved };
}
