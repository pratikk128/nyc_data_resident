# Ask NYC Data

**asknycdata.com** · NYC's public data, made easy to understand.

Interactive dashboards for NYC residents, built on public [NYC Open Data](https://opendata.cityofnewyork.us/). This repo currently holds the landing page; the dashboards themselves come later.

Built with [Astro](https://docs.astro.build). The page's interactivity is plain vanilla JavaScript.

```
src/pages/index.astro     Landing page markup
src/styles/landing.css    Landing page styles (theme tokens at the top in :root)
src/pages/city-budget.astro   City Budget Spending dashboard (one section per insight)
src/components/city-budget/   Dashboard sections, e.g. WorkforceSection.astro
src/layouts/DashboardLayout.astro   Shared shell for dashboard pages
src/lib/                  Formatting helpers, payroll stats, chart code
src/data/                 Precomputed data snapshots (generated, committed)
scripts/                  Data refresh scripts
public/js/dashboards.js   Dashboard registry: the list of cards
public/js/app.js          Renders the sidebar and cards, filtering, sidebar collapse
public/favicon.svg        Favicon
```

## Run it locally

```sh
npm install
npm run dev          # http://localhost:4321
```

To run the dev server in the background: `npx astro dev --background` (stop with `npx astro dev stop`).

Production build: `npm run build` (output in `dist/`), preview with `npm run preview`.

## Add a new dashboard

Open `public/js/dashboards.js` and append one object to the `dashboards` array:

```js
{
  id: "street-trees",
  title: "Street Trees Near You",
  description: "See what kinds of trees line your block and how healthy they are.",
  category: "Environment",
  url: "#"   // placeholder until the dashboard page exists
}
```

- `category` must exactly match a sidebar category name: Business, City Government, Education, Environment, Health, Housing & Development, Public Safety, Recreation, Social Services, Transportation.
- The card, sidebar counts, and filter update automatically.

To add a new category, add an entry (name → SVG icon paths) to `ICONS` in `public/js/app.js`; sidebar order follows that object's order.

## Refresh the payroll data

The "How much does NYC spend on its workforce?" section reads `src/data/payroll-by-year.json`, a small snapshot of yearly totals from NYC Open Data's [Citywide Payroll Data (Fiscal Year)](https://data.cityofnewyork.us/City-Government/Citywide-Payroll-Data-Fiscal-Year-/k397-673e) (`k397-673e`). The source updates about once a year, so the site never queries it live.

```sh
npm run data:payroll   # rewrites src/data/payroll-by-year.json
npm run build          # rebuild the site with the new numbers
```

Set `SOCRATA_APP_TOKEN` to avoid anonymous rate limits (optional). The script picks up new fiscal years automatically, prints each year's total, and warns if a total looks implausible, a year is missing, or the latest year looks like a partial load (people paid or total pay under 85% of the prior 3-year median). A warning also shows a "Heads up" note on the page.

The dataset has millions of rows (one per employee per fiscal year), so the script asks Socrata to aggregate server-side:

```
GET https://data.cityofnewyork.us/resource/k397-673e.json
  $select = fiscal_year, count(*) AS employees, sum(regular_gross_paid) AS regular,
            sum(total_ot_paid) AS overtime, sum(total_other_pay) AS other
  $group  = fiscal_year
  $order  = fiscal_year
```

Total pay = regular + overtime + other. Negative amounts (refunds, retro adjustments) stay in the sums. "People paid" is the row count per year, not headcount. Dollars are nominal.

## Theme

Colors, spacing, radius, and layout sizes are CSS variables at the top of `src/styles/landing.css`.
