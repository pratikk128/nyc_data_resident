// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Pages are prerendered unless they opt out with `export const prerender = false`
  // (API routes and the restaurant lookup, which read live NYC Open Data).
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false, // not used; otherwise the adapter provisions a SESSION KV namespace
  // Section 1 of City Payroll Spending is the dashboard's default page;
  // the drinking water history now sits under its report card
  redirects: {
    '/city-payroll/spending': '/city-payroll/',
    '/drinking-water/history': '/drinking-water/#history'
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
