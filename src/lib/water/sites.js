/*
 * DEP's sampling site list (src/data/water-sites.json) by site code, for the
 * server-rendered E. coli tables. Not for the browser: it inlines the whole file.
 */
import { plainDescription } from "./stats.js";
import sitesFile from "../../data/water-sites.json" with { type: "json" };

export const SITES = new Map(sitesFile.sites.map((s) => [s.site, s]));

// "Grand St & Lorimer St" for a site code, or a note that DEP doesn't list it.
export function siteDescription(code) {
  const s = SITES.get(code);
  return s ? plainDescription(s.description) : "Location not in DEP’s site list";
}
