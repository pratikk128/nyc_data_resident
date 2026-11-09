/*
 * GET /sitemap.xml, prerendered: the landing page, every dashboard in
 * src/data/dashboards.js, their other section pages and a page per
 * school. Paths end in "/" to match each page's canonical URL.
 */
import { dashboards } from "../data/dashboards.js";
import schoolLocations from "../data/school-locations.json";
import { schoolPath } from "../lib/schools/config.js";

const SITE = "https://asknycdata.com";
// Section pages beyond each dashboard's url
const EXTRA_PAGES = ["/city-payroll/overtime/"];
// Every school in the quality reports that has a location (the snapshot
// scripts/refresh-school-locations.mjs builds); each has a page.
const SCHOOL_PAGES = Object.keys(schoolLocations).sort().map(schoolPath);

export function GET() {
  const paths = ["/", ...dashboards.map((d) => d.url), ...EXTRA_PAGES, ...SCHOOL_PAGES];
  const urls = paths.map((p) => `  <url><loc>${new URL(p, SITE).href}</loc></url>`).join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
}
