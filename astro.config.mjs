// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Section 1 of City Payroll Spending is the dashboard's default page
  redirects: {
    '/city-payroll/spending': '/city-payroll/'
  },
  vite: {
    plugins: [tailwindcss()]
  }
});