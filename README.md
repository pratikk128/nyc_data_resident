# Ask NYC Data

**asknycdata.com** · NYC's public data, made easy to understand.

Interactive dashboards for NYC residents, built on public [NYC Open Data](https://opendata.cityofnewyork.us/). This repo currently holds the landing page; the dashboards themselves come later.

Built with [Astro](https://docs.astro.build). The page's interactivity is plain vanilla JavaScript.

```
src/pages/index.astro     Landing page markup
src/styles/landing.css    Landing page styles (theme tokens at the top in :root)
src/pages/city-payroll/        City Payroll Spending dashboard, one page per section
src/components/city-payroll/   PayrollPage.astro (shared heading + section nav) and the sections
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

## City Payroll Spending sections

Each section of the dashboard is its own page with its own URL. The section nav (links, with `aria-current="page"` on the current one) lives in `src/components/city-payroll/PayrollPage.astro`; `/city-payroll/` is the default.

| Route | Section | Component |
|---|---|---|
| `/city-payroll/` | How much does NYC spend on its workforce? | `WorkforceSection.astro` |
| `/city-payroll/spending/` | Redirects to `/city-payroll/` (set in `astro.config.mjs`) | |
| `/city-payroll/jobs/` | What do city jobs actually pay? | `JobsSection.astro` |

To add a section, add an entry to `SECTIONS` in `PayrollPage.astro` and a page in `src/pages/city-payroll/`.

The jobs section keeps its state in the URL so views can be shared: `?chip=firefighter`, `?q=nurse`, `?sort=base-desc` (sort keys: `label`, `employees`, `base`, `total`, `extra`, `change`; direction `asc` or `desc`).

## Refresh the payroll data

The "How much does NYC spend on its workforce?" section reads `src/data/payroll-by-year.json`, a small snapshot of yearly totals from NYC Open Data's [Citywide Payroll Data (Fiscal Year)](https://data.cityofnewyork.us/City-Government/Citywide-Payroll-Data-Fiscal-Year-/k397-673e) (`k397-673e`). The source updates about once a year, so the site never queries it live.

```sh
npm run data:payroll   # rewrites src/data/payroll-by-year.json and payroll-by-agency.json
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

A second query groups by `agency_name, fiscal_year` for the agency picker and writes `src/data/payroll-by-agency.json` (one line per agency). The page loads that file only when someone picks an agency. A few agencies are spelled differently in FY2014 (e.g. `Police Department`, `Bronx DA`); `AGENCY_ALIASES` in the script folds them into the later name, and `AGENCY_LABELS` gives readable names for truncated ones (everything else is title-cased). The script warns if the agency totals for the latest year don't add up to the citywide total.

Total pay = regular + overtime + other. Negative amounts (refunds, retro adjustments) stay in the sums. "People paid" is the row count per year, not headcount. Dollars are nominal.

### Job titles ("What do city jobs actually pay?")

The same command writes `src/data/payroll-jobs.json` (one line per job title). Socrata computes the medians server-side with SoQL `median()` (checked against medians computed from raw rows), so no rows are downloaded. This query is the slow one, about a minute or two:

```
GET https://data.cityofnewyork.us/resource/k397-673e.json
  $select = fiscal_year, upper(trim(title_description)) AS title, count(*) AS employees,
            median(base_salary) AS median_base,
            median(coalesce(regular_gross_paid, 0) + coalesce(total_ot_paid, 0)
                   + coalesce(total_other_pay, 0)) AS median_total
  $where  = pay_basis = 'per Annum' AND leave_status_as_of_june_30 = 'ACTIVE'
            AND base_salary > 0 AND title_description IS NOT NULL
  $group  = fiscal_year, title
```

Filters:

- `pay_basis = 'per Annum'`: full-time annual salaries. The other values are `per Day`, `per Hour` and `Prorated Annual`, all excluded.
- `leave_status_as_of_june_30 = 'ACTIVE'`: excludes `CEASED`, `ON LEAVE`, `ON SEPARATION LEAVE` and `SEASONAL`.
- `base_salary > 0`.
- Titles are normalized with `upper(trim(title_description))` and shown in Title Case (`titleLabel()` in the script).
- Only titles with 25 or more employees in the latest fiscal year are kept (`MIN_EMPLOYEES`).

Before querying, the script checks that `per Annum` and `ACTIVE` still exist as values and stops if they don't.

For each title, the snapshot stores the latest year's employee count, median base salary, median total pay, extra (median total − median base, which can be negative), the 5-year change in median base salary (`null` if the title had fewer than 25 employees five years earlier), and `series`: `[fiscal year, median base, employees]` for every year the title appears. The script warns if a chip matches no titles or if Teacher, Firefighter or Police Officer medians fall outside $50K–$200K.

Quick-filter chips (`JOB_CHIPS` in the script). A chip with no matching title in the latest year is left out of the snapshot and isn't shown.

| Chip | `title_description` values |
|---|---|
| Teacher | TEACHER, TEACHER SPECIAL EDUCATION |
| Firefighter | FIREFIGHTER |
| Police Officer | POLICE OFFICER |
| Sanitation Worker | SANITATION WORKER |
| Correction Officer | CORRECTION OFFICER |
| Staff Nurse | STAFF NURSE, STAFF NURSE ASSIGNMENT LEVEL 3 |
| EMT | EMERGENCY MEDICAL SPECIALIST-EMT |
| Traffic Enforcement Agent | TRAFFIC ENFORCEMENT AGENT |
| Bus Operator / Motor Vehicle Operator | BUS OPERATOR (no matches today: MTA bus operators aren't on city payroll), MOTOR VEHICLE OPERATOR |
| Caseworker | CASEWORKER |
| City Planner | CITY PLANNER |
| Civil Engineer | CIVIL ENGINEER, ASSISTANT CIVIL ENGINEER |

## Theme

Colors, spacing, radius, and layout sizes are CSS variables at the top of `src/styles/landing.css`.
