/*
 * GET /sitemap.xml, prerendered: the landing page, every dashboard in
 * src/data/dashboards.js, their other section pages and the address report.
 */
import { dashboards } from "../data/dashboards.js";

const SITE = "https://asknycdata.com";
// Section pages beyond each dashboard's url
const EXTRA_PAGES = ["/address/", "/drinking-water/near-me", "/city-payroll/overtime"];

export function GET() {
  const paths = ["/", ...dashboards.map((d) => d.url), ...EXTRA_PAGES];
  const urls = paths.map((p) => `  <url><loc>${new URL(p, SITE).href}</loc></url>`).join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
}
