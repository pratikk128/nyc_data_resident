# Ask NYC Data

**asknycdata.com** · NYC's public data, made easy to understand.

Interactive dashboards for NYC residents, built on public [NYC Open Data](https://opendata.cityofnewyork.us/). This repo currently holds the landing page; the dashboards themselves come later.

Built with [Astro](https://docs.astro.build) and deployed to Cloudflare Workers. The page's interactivity is plain vanilla JavaScript. Most pages are prerendered; pages and API routes that read live NYC Open Data run in the Worker (`export const prerender = false`).

```
src/pages/index.astro     Landing page markup
src/styles/landing.css    Landing page styles (theme tokens at the top in :root)
src/pages/city-payroll/        City Payroll Spending dashboard, one page per section
src/components/city-payroll/   PayrollPage.astro (shared heading + section nav) and the sections
src/layouts/DashboardLayout.astro   Shared shell for dashboard pages
src/lib/                  Formatting helpers, payroll stats, chart code
src/pages/restaurant-inspections/   NYC Restaurant Inspections (rendered on demand)
src/pages/api/            API routes (Worker): /api/restaurants/search, /api/restaurants/:camis
src/lib/restaurants/      Restaurant logic: SoQL builders, inspection rules, violation categories, rendering
src/lib/server/           Server-only: Socrata client (holds the token), caches, daily jobs
src/worker.js             Worker entry: Astro for requests, cron for daily jobs
wrangler.jsonc            Worker config: KV namespace, cron trigger
tests/                    `npm test` (node:test, no extra dependencies)
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

Live data needs no setup locally (Socrata allows anonymous requests at low volume). To use a token, copy `.dev.vars.example` to `.dev.vars` and fill in `SOCRATA_APP_TOKEN`.

```sh
npm test             # restaurant logic tests
```

## Deploy (Cloudflare Workers)

```sh
npx wrangler login
npx wrangler secret put SOCRATA_APP_TOKEN   # once
npm run deploy                              # astro build && wrangler deploy
```

The first deploy creates the `DATA_CACHE` KV namespace and the daily cron trigger (`0 11 * * *`, 11:00 UTC). The search cache (Workers Cache API) only works on a custom domain, so add asknycdata.com as a custom domain on the Worker; on `*.workers.dev` every search goes straight to Socrata.

To test the cron locally: `npm run build && npx wrangler dev -c dist/server/wrangler.json --test-scheduled`, then open `http://localhost:8787/cdn-cgi/handler/scheduled`.

### Live data and caching

All Socrata calls go through `src/lib/server/socrata.js`, which adds the `X-App-Token` header from the Worker secret. The token never reaches the browser.

| What | Where it's cached | How long |
|---|---|---|
| Search results | Workers Cache API, keyed by the normalized query | 1 hour |
| One restaurant | Workers Cache API | 1 hour |
| Benchmarks (category averages), dataset metadata | KV `DATA_CACHE`, refreshed by the cron | 24 hours (a request recomputes only if KV has nothing newer than 26 h; if Socrata is down the last value is served, kept up to 7 days) |

**Adding another dataset's daily aggregate:** write a server module like `src/lib/server/restaurants.js` that exports jobs (`{ key, maxAgeHours, run }`), add them to `DAILY_JOBS` in `src/lib/server/daily-jobs.js`, and read them with `dailyValue(job)`. The one cron run refreshes every job in parallel.

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

## NYC Restaurant Inspections

`/restaurant-inspections/` looks up a restaurant from NYC Open Data's [DOHMH New York City Restaurant Inspection Results](https://data.cityofnewyork.us/d/43nn-pn8j) (`43nn-pn8j`), live. `?camis=50066715` opens a restaurant directly (rendered on the server, so shared links work); `?name=&boro=&place=` restores a search; `&compare=similar` picks the "Similar restaurants" benchmark.

Data rules (all in `src/lib/restaurants/inspections.js`, covered by tests):

- One row per violation. An inspection is `camis` + `inspection_date`; restaurants are keyed by `camis`, never by name.
- `inspection_date` 1900-01-01 means not yet inspected: excluded from every count, shown as "Not yet inspected".
- Latest grade = newest row with a grade, by `grade_date`. Grade `N` almost never has a `grade_date`; where one exists it always equals `inspection_date`, so the inspection date stands in. It can come from an earlier visit than the latest inspection; the page then gives the grade's date as well.
- N / Z / P are shown as "Not yet graded" / "Grade pending" / "Grade pending (reopened)".
- `boro = '0'` (about 300 rows) shows as "Borough unknown".

Search (`src/lib/restaurants/soql.js`): `upper(dba) like '%WORD%WORD%'` (each typed word, in order), optional borough, and one "Street or ZIP" box: 5 digits = ZIP; a leading number = `building` exact + street like; otherwise street like. "Near me" adds a ~0.5 mile lat/long box. Results are grouped by camis and its name/address, deduped by camis, and capped at 25; a second `camis in (...)` query gets each one's latest grade.

**Violation categories** are defined in `src/lib/restaurants/violation-categories.js`, the only place the mapping lives. Codes are grouped by their first two characters (`02G` → 02, `15-27` → 15):

| Family | Category |
|---|---|
| 02 | Food temperature |
| 03 | Food source |
| 04 | Contamination and pests |
| 05 | Facility design and equipment |
| 06 | Hygiene and cross-contamination |
| 08 | Pest prevention and facility |
| 09 | Food protection |
| 10 | Facility maintenance |
| 15, 16, 18, 19, 20 | Signs, permits and local laws |
| 07, 22, 28, 99, anything new | Other |

The lookback window (`LOOKBACK_YEARS`, default 3) and the minimum group size for "Similar restaurants" (`MIN_SIMILAR_RESTAURANTS`, 20) are set in the same file. Benchmarks are computed server-side by Socrata once a day:

```
count(distinct camis) AS restaurants           WHERE inspection_date >= <cutoff>     [GROUP BY cuisine_description, boro]
substring(violation_code, 1, 2) AS fam, count(*) WHERE ... AND violation_code IS NOT NULL GROUP BY [cuisine_description, boro,] fam
```

Mean per category = cited violations ÷ every restaurant inspected in the window (restaurants with zero still count).

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
