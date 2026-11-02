# Ask NYC Data

**asknycdata.com** · NYC's public data, made easy to understand.

Interactive dashboards for NYC residents and businesses, built on public [NYC Open Data](https://opendata.cityofnewyork.us/): a landing page plus fourteen dashboards (restaurant inspections, restaurant leads, 311 complaints, city payroll spending, what city jobs pay, drinking water, certified M/WBE firms, school quality, street closures, help near me, crash lookup, crash hotspots, building report card, park amenities near me).

Built with [Astro](https://docs.astro.build) and deployed to Cloudflare Workers. The page's interactivity is plain vanilla JavaScript. Most pages are prerendered; pages and API routes that read live NYC Open Data run in the Worker (`export const prerender = false`).

```
src/pages/index.astro     Landing page markup
src/styles/landing.css    Landing page styles (theme tokens at the top in :root)
src/pages/city-payroll/        City Payroll Spending (rendered on demand)
src/components/city-payroll/   WorkforceSection.astro
src/pages/city-jobs/           What NYC City Jobs Pay, from the same payroll data (rendered on demand)
src/components/city-jobs/      JobsSection.astro
src/layouts/DashboardLayout.astro   Shared shell for dashboard pages
src/lib/                  Formatting helpers, payroll stats, chart code
src/lib/payroll/build.js  Payroll queries and checks, shared by the cron and npm run data:payroll
src/pages/restaurant-inspections/   NYC Restaurant Inspections (rendered on demand)
src/pages/restaurant-leads/   Restaurant Leads by Service Type, from the same inspection data (rendered on demand)
src/pages/311-complaints/  311 Complaints in My Neighborhood (rendered on demand)
src/pages/drinking-water/  NYC Drinking Water Quality, one page per section (rendered on demand)
src/components/drinking-water/  WaterPage.astro (heading, section nav, context box, method notes) and the sections
src/pages/shop-diverse/    Find Certified Women- and Minority-Owned Firms (rendered on demand)
src/pages/school-quality/  NYC School Quality Explorer: browse page and /school-quality/<DBN>/ (rendered on demand)
src/components/school-quality/  Finder, the school page's "now" and "over time" sections, method notes
src/components/shop-diverse/  The finder (filters, results, detail panel, shortlist) and method notes
src/pages/street-closures/  Street Closures Near You (rendered on demand)
src/components/street-closures/  The finder (search, window tabs, map + cards, breakdown) and method notes
src/pages/crash-lookup/    NYC Crash Lookup (rendered on demand)
src/components/crash-lookup/  The lookup form, results and deep dive; method notes
src/pages/crash-hotspots/  NYC Crash Hotspots (rendered on demand)
src/components/crash-hotspots/  Place and how you get around, stat cards, what to watch for, dangerous intersections and map; method notes
src/lib/crashes/          Crash lookup logic: config (date range), schema, normalizing, form, scoring, search SQL, deep dive, rendering; crash hotspots' facts (facts.js) and hotspot-*.js
src/pages/building-report/  Building Report Card: /building-report/?bbl=<BBL> (key takeaways), plus repairs/, pests/, legal/ and all/ per tax lot (rendered on demand)
src/components/building-report/  Page shell, address search, header and map, part cards, key takeaways, the nine sections; terms and sources
src/lib/building-report/  Building report logic: datasets and labels (config.js), SoQL per section, summaries, rendering, address lookup
src/pages/api/            API routes (Worker): /api/restaurants/search, /api/restaurants/:camis, /api/311/*, /api/water/stations, /api/shop-diverse/*, /api/schools/search, /api/street-closures/search, /api/building-report/:section
src/lib/restaurants/      Restaurant logic: SoQL builders, inspection rules, violation categories, rendering
src/lib/complaints311/    311 logic: config, SoQL, share math, labels, input parsing, geocoding, rendering
src/lib/shop-diverse/     Certified women- and minority-owned firms logic: cleaning, ranking, filters, rendering, CSV export
src/lib/schools/          School Quality Explorer logic: curated metrics (metrics.js), values, search, charts, maps
src/lib/street-closures/  Street closures logic: street names, purposes, blocks, windows and status, URL state, rendering, map
src/lib/water/            Drinking water logic: reference values (config.js), lab value parser, SoQL, stats, charts, map
src/lib/server/           Server-only: Socrata client (holds the token), caches, the data refresh pipeline (etl.js)
src/lib/etl/              Refresh policy: cadences and when to rebuild (cadence.js), build-time snapshots (snapshots.js)
src/worker.js             Worker entry: Astro for requests, hourly cron for the data refresh
src/middleware.js         Security headers on Worker responses (public/_headers for static files)
src/pages/sitemap.xml.js  Sitemap from the dashboard registry; public/robots.txt points to it
wrangler.jsonc            Worker config: KV namespace, cron trigger
tests/                    `npm test` (node:test, no extra dependencies)
src/data/                 Precomputed data snapshots (generated, committed)
scripts/                  Data refresh scripts
src/data/dashboards.js    Dashboard registry: the cards, plus sidebar categories (icons, tones)
public/js/app.js          Landing page: category filter (?category=<slug>), sidebar collapse
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
npm test             # restaurant, 311, drinking water, certified M/WBE firms, school quality and street closures logic tests
```

## Deploy (Cloudflare Workers)

```sh
npx wrangler login
npx wrangler secret put SOCRATA_APP_TOKEN   # once
npm run deploy                              # tests, astro check, astro build, wrangler deploy
```

The first deploy creates the `DATA_CACHE` KV namespace and the hourly cron trigger (`15 * * * *`). `npm run deploy` first checks the build-time snapshots against NYC Open Data and warns about stale ones (it never blocks the deploy). The search cache (Workers Cache API) only works on a custom domain, so add asknycdata.com as a custom domain on the Worker; on `*.workers.dev` every search goes straight to Socrata.

To test the cron locally: `npm run build && npx wrangler dev -c dist/server/wrangler.json --test-scheduled`, then open `http://localhost:8787/cdn-cgi/handler/scheduled`.

### Live data and caching

All Socrata calls go through `src/lib/server/socrata.js`, which adds the `X-App-Token` header from the Worker secret. The token never reaches the browser.

| What | Where it's cached | How long |
|---|---|---|
| Search results | Workers Cache API, keyed by the normalized query | 1 hour |
| One restaurant | Workers Cache API | 1 hour |
| Benchmarks (category averages), 311 borough and city baselines and citywide distributions, drinking water monthly/detections/station aggregates, Shop Diverse and School Quality indexes, dataset metadata | KV `DATA_CACHE`, rebuilt by the hourly cron when the source changes (see [Data refresh pipeline](#data-refresh-pipeline)) | Until the source changes, or the cadence's safety rebuild (a request recomputes only if the cron is 2 h past due; if Socrata is down the last value is served, kept up to 90 days) |
| 311 areas (¼ and 1 mile) and ZIPs | Workers Cache API, keyed by lat/lon rounded to 3 decimals + radius + window | 6 hours |

## Data refresh pipeline

Each dashboard's data reaches the site one of two ways, and both are tracked in one place.

**1. KV aggregates (most dashboards), refreshed automatically.** Each dataset's server module declares how often the city publishes it. An hourly cron (`src/lib/server/etl.js`) reads every dataset's `rowsUpdatedAt` from NYC Open Data (one small request each) and rebuilds only the jobs that are due (`src/lib/etl/cadence.js`):

- **never built**: a new dataset, or a job whose key changed with the code,
- **source updated**: the dataset's rows changed since the job was built, at most once every `minGapHours` (6 h for daily data, 12 h otherwise), so a source touched every hour doesn't rebuild every hour,
- **scheduled rebuild**: a safety net after `rebuildHours`, in case a change was missed,
- **new day**: `rolling` jobs, whose windows end "today", rebuild at least every 24 h whatever the source does.

| Dashboard | Dataset | Cadence | Rolling | Safety rebuild |
|---|---|---|---|---|
| Restaurant Inspections | `43nn-pn8j` | daily | yes | 24 h |
| 311 Complaints | `erm2-nwe9` | daily | yes | 24 h |
| Drinking Water | `bkwf-xfky` | monthly | no | 7 days |
| Shop Diverse | `ci93-uc8s` | biweekly | no | 7 days |
| School Quality | `dnpx-dfnc` (+ `school-locations.json`) | yearly | no | 30 days |
| City Payroll | `k397-673e` | yearly | no | 30 days |
| Street Closures | `i6b5-j7bu` | weekly | no | 7 days |
| Crash Lookup (D1, not KV: see below) | `h9gi-nx95` (+ `bm4k-52h4`, `f55k-p6yu`) | daily | yes | 24 h |

Cadences are `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`, `yearly` and `as-needed`. Each also sets when the source counts as **late** (`overdueDays`: 3 days for daily data, 45 for monthly, 400 for yearly, never for as-needed), which is logged and reported. Every source is checked hourly whatever its cadence, so an off-schedule or as-needed update is picked up within the hour.

A job that fails keeps its last good value in KV and is retried the next hour; the run throws so the failure shows in the Worker's cron events. Within a dataset jobs run in parallel, except a job with `after` (water stations waits for the monthly aggregate). What each job was built from is kept in the `etl:state` KV entry. A job that joins a bundled snapshot (`snapshots: ["school-locations"]`) also rebuilds after a deploy that refreshed that snapshot. Each isolate checks a small `<key>:at` KV entry every 5 minutes, so a rebuilt value reaches every request within minutes.

**2. Build-time snapshots, checked automatically and refreshed by command.** School addresses and water station locations join several datasets, so they're committed JSON in `src/data/`. The Worker can't rewrite them. `src/lib/etl/snapshots.js` lists each snapshot, its sources and its refresh command. Each script records when it ran in `src/data/snapshots.json`, and the hourly cron flags a snapshot as stale when a source's rows (or, for the water sites, the attached spreadsheet) changed after that.

```sh
npm run data:check                # which snapshots are stale; exits 1 if any
npm run data:check -- --refresh   # also runs each stale snapshot's script
npm run deploy                    # after reviewing the diff in src/data/
```

**Is everything current?** `GET /api/etl/status` returns every dataset's last source update, cadence, whether it's late, and each job's last build, reason, duration, whether it's current and its last error, plus each snapshot's state. `ok` is `false` and `attention` lists plain sentences when something needs a look, including when the hourly cron hasn't run for over 2 hours. To run the cron locally: `npm run build && npx wrangler dev -c dist/server/wrangler.json --test-scheduled`, then open `http://localhost:8787/cdn-cgi/handler/scheduled` (the first run builds everything, a few minutes for 311; a second run rebuilds nothing).

**Adding a dataset.** In its server module, define jobs (`{ key, maxAgeHours: requestMaxAgeHours(CADENCE), run }`) and export a dataset (`{ id, dashboard, datasetId, cadence, rolling?, snapshots?, metadataJob, jobs }`). Add it to `DATASETS` in `src/lib/server/etl.js`, and read the jobs with `dailyValue(job)`. Change a job's key when its output shape changes, so the next run rebuilds it. **Adding a snapshot:** add it to `SNAPSHOTS` in `src/lib/etl/snapshots.js`, and have its script call `recordSnapshot(id, startedAt)` from `scripts/lib/snapshot-manifest.mjs` after it writes its files.

## Add a new dashboard

Open `src/data/dashboards.js` and append one object to the `dashboards` array:

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
- The card, sidebar counts, and filter update automatically. Cards are rendered at build time, so they show without JavaScript; `public/js/app.js` only filters them.
- Each category has a shareable URL, `/?category=<slug>` (e.g. `/?category=city-government`); the dashboard breadcrumb links there.

To add a new category, add an entry (name, tone, SVG icon paths) to `CATEGORIES` in `src/data/dashboards.js`; sidebar order follows that array's order.

## City Payroll Spending and What NYC City Jobs Pay

Two dashboards built on the same payroll data (`src/lib/server/payroll.js`), each with its own landing-page card:

| Route | Question | Component |
|---|---|---|
| `/city-payroll/` | How much does NYC spend on its workforce? | `city-payroll/WorkforceSection.astro` |
| `/city-payroll/spending/` | Redirects to `/city-payroll/` (set in `astro.config.mjs`) | |
| `/city-jobs/` | What do city jobs actually pay? | `city-jobs/JobsSection.astro` |
| `/city-payroll/jobs/` | Redirects to `/city-jobs/`, keeping the query string | |

`/city-jobs/` keeps its state in the URL so views can be shared: `?chip=firefighter`, `?q=nurse`, `?sort=base-desc` (sort keys: `label`, `employees`, `base`, `extra`, `change`; direction `asc` or `desc`).

## NYC Restaurant Inspections

`/restaurant-leads/` (Restaurant Leads by Service Type, for businesses) is a separate dashboard on the same dataset; `/restaurant-inspections/leads/` redirects there with its query string.

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

## 311 Complaints in My Neighborhood

`/311-complaints/` shows what people near a spot asked 311 for, from NYC Open Data's [311 Service Requests from 2020 to Present](https://data.cityofnewyork.us/d/erm2-nwe9) (`erm2-nwe9`), live. The place and view are in the URL so links can be shared:

| Param | Meaning |
|---|---|
| `lat`, `lon`, `place` | A spot (from the address lookup) and its label; `boro`, `zip` ride along when known |
| `zip` | A ZIP on its own: centered on the average location of requests that name it |
| `boro` | A borough on its own (`QUEENS`): the borough against the city, no radius |
| `window` | `3m`, `12m` (default) or `all` (since Jan 1, 2020), by `created_date` |
| `area` | `immediate` to compare the ¼ mile instead of the 1 mile |
| `vs` | `city` to compare with NYC instead of the borough |

All tunables are in `src/lib/complaints311/config.js`: `RADII` (402 m and 1,609 m), `MIN_IMMEDIATE_REQUESTS` (100: below this the ¼ mile is shown but comparisons use the 1 mile), `MIN_LOCAL_COUNT` (20), `ABOVE_RATIO` (1.25), `BELOW_RATIO` (0.75), `TOP_LOCATION_TYPES` (8). All SoQL lives in `soql.js`; every query aggregates server-side (`count(*)` with `$group`), and radius queries use `within_circle(location, lat, lon, meters)`, which skips rows without coordinates.

**Comparisons are shares, not counts:** a type's share of requests here ÷ its share in the borough (or city). Borough baselines leave out `borough = 'Unspecified'`; the city baseline includes it.

**Addresses** are looked up in the browser with NYC Planning Labs [GeoSearch](https://geosearch.planninglabs.nyc/) (free, no key). ZIPs and borough names are recognized before GeoSearch (it reads "11211" as a house number). A typed address only resolves when GeoSearch's house number and street match it, otherwise the reader picks from suggestions; a street with no borough is searched in each borough and the reader picks one.

**Data quirks** (handled in `labels.js` and `stats.js`):

- `complaint_type` casing varies (`HEAT/HOT WATER`, `Noise`); counts merge on the upper-cased name and show plain labels (`TYPE_LABELS`).
- `location_type` has ~150 spellings for a few kinds of place (`RESIDENTIAL BUILDING`, `3+ Family Apt. Building`, `Comercial`); `LOCATION_GROUPS` folds them, and blanks (~12%) go to "Other / Not specified".
- `status`: only `Closed` counts as closed; Open, In Progress, Assigned, Pending, Started and Unspecified count as still open.
- About 2% of requests have no coordinates and so aren't in any radius.

**Timing.** The ¼ mile takes Socrata ~2 s, the 1 mile ~3–12 s (4–5 queries each, in parallel; each is logged as `311 radius ...`). The borough and city baselines group the whole window by borough and take about a minute per query, so they're jobs (`311:baseline:v2:<window>`) that the cron rebuilds daily. The "more requests than 72% of NYC blocks with any 311 requests" line under each radius comes from `311:distribution:v1:<window>`: requests counted on a ~100 m grid (`gridCountParams`, run in 3 month pieces at once since the 12 month grid in one query takes Socrata over 4 minutes), then summed within ¼ and 1 mile of every cell with a request (`circleDistributions` in `stats.js`) and kept as 1,001 quantiles per radius. The page fetches it from `/api/311/distribution`. Before the first cron run (fresh deploy, local dev) the first request for each window waits for them, a few minutes without an app token.

The map section is a placeholder; its props and the plan for it are at the top of `src/lib/complaints311/heatmap.js`.

## Refresh the payroll data

Both sections are built from NYC Open Data's [Citywide Payroll Data (Fiscal Year)](https://data.cityofnewyork.us/City-Government/Citywide-Payroll-Data-Fiscal-Year-/k397-673e) (`k397-673e`), which updates about once a year. **It refreshes itself:** when the source changes, the hourly cron runs the queries below (about 30 seconds) and saves the results in one KV entry, `payroll:data:v1` (`src/lib/server/payroll.js`). The pages render on demand from it, and the agency picker loads every agency's rows from `GET /api/payroll/agencies`. Requests never query Socrata.

The queries and checks live in `src/lib/payroll/build.js`, shared by the cron and a script that writes the same data to `src/data/payroll-by-year.json`, `payroll-by-agency.json` and `payroll-jobs.json`. The pages show that bundled copy only while KV has none (local dev, or a new deployment before its first cron run), so refreshing it is optional; it's also a handy way to review a change as a diff:

```sh
npm run data:payroll   # rewrites the bundled copy in src/data/
```

Set `SOCRATA_APP_TOKEN` to avoid anonymous rate limits (optional). New fiscal years are picked up automatically. A build warns (in the cron's logs, or the script's output) if a total looks implausible, a year is missing, or the latest year looks like a partial load (people paid or total pay under 85% of the prior 3-year median). A partial load also shows a "Heads up" note on the page. A build that fails or returns nothing keeps the last good copy.

The dataset has millions of rows (one per employee per fiscal year), so the queries ask Socrata to aggregate server-side:

```
GET https://data.cityofnewyork.us/resource/k397-673e.json
  $select = fiscal_year, count(*) AS employees, sum(regular_gross_paid) AS regular,
            sum(total_ot_paid) AS overtime, sum(total_other_pay) AS other
  $group  = fiscal_year
  $order  = fiscal_year
```

A second query groups by `agency_name, payroll_number, fiscal_year` for the agency picker (`byAgency`; one line per agency in `src/data/payroll-by-agency.json`). The page loads it only when someone picks an agency. A few agencies are spelled differently in FY2014 (e.g. `Police Department`, `Bronx DA`); `AGENCY_ALIASES` in `build.js` folds them into the later name, and `AGENCY_LABELS` gives readable names for truncated ones (everything else is title-cased). A year published without agency names (FY2026 at first) takes each `payroll_number`'s name from the latest year that has one, with a warning. The build warns if the agency totals for the latest year don't add up to the citywide total.

Total pay = regular + overtime + other. Negative amounts (refunds, retro adjustments) stay in the sums. "People paid" is the row count per year, not headcount. Dollars are nominal.

### Job titles ("What do city jobs actually pay?")

The same build makes the job title data (`jobs`; one line per title in `src/data/payroll-jobs.json`). Socrata computes the medians server-side with SoQL `median()` (checked against medians computed from raw rows), so no rows are downloaded. This query is the slow one, about a minute or two:

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
- Titles are normalized with `upper(trim(title_description))` and shown in Title Case (`titleLabel()` in `build.js`).
- Only titles with 25 or more employees in the latest fiscal year are kept (`MIN_EMPLOYEES`).

Before querying, the build checks that `per Annum` and `ACTIVE` still exist as values and stops if they don't.

For each title, the snapshot stores the latest year's employee count (everyone active in the title) and full-year employee count, median base salary, extra (the median of each person's own overtime plus other pay), the 5-year change in median base salary (`null` if the title had fewer than 25 full-year employees five years earlier), and `series`: `[fiscal year, median base, full-year employees]` for every year the title appears. The build warns if a chip matches no titles or if Teacher, Firefighter or Police Officer medians fall outside $50K–$200K.

Quick-filter chips (`JOB_CHIPS` in `build.js`). A chip with no matching title in the latest year is left out of the snapshot and isn't shown.

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

## NYC Drinking Water Quality

`/drinking-water/` explains DEP's street-side water samples from [Drinking Water Quality Distribution Monitoring Data](https://data.cityofnewyork.us/d/bkwf-xfky) (`bkwf-xfky`). Two sections, each its own page (`SECTIONS` in `WaterPage.astro`):

| URL | Question | Section |
|---|---|---|
| `/drinking-water/` | Is my water safe right now? (report card for the latest full month, then "Has it always been this good?": one takeaway line and, behind a toggle, coliform % and median chlorine for every month) | `ReportCardSection.astro`, `HistorySection.astro` |
| `/drinking-water/near-me/` | What about near me? (3 nearest stations, 12-month sparklines) | `NearMeSection.astro` |

The old `/drinking-water/history/` URL redirects to `/drinking-water/#history` (`astro.config.mjs`), which opens the history toggle.

**Data.** Every measurement column is text (chlorine included). `parseMeasurement()` in `src/lib/water/parse.js` reads `<X` and `ND` as not detected (0 for bacteria), `>X` as at least X, and blanks and negative placeholders (`-9`, `-9.99`) as missing; `soql.js` applies the same rules inside SoQL so all aggregation happens on Socrata. Shares and medians use routine samples (Compliance, Operational); detections list every class. Four jobs in `src/lib/server/water.js`, rebuilt when the dataset changes, (`water:*` in KV) hold everything the pages read, so readers don't wait on Socrata.

**Reference values** (with sources, checked Oct 2026) and the tile color cutoffs are in `src/lib/water/config.js`. They're labeled as reference values, not a compliance determination.

**Station locations** come from DEP's 2021 sampling site spreadsheet, converted to `src/data/water-sites.json` (State Plane EPSG:2263 → lat/lon, borough by point-in-polygon), with ZIP points in `src/data/zip-centroids.json`. Rebuild both with `npm run data:water-sites`; it also lists dataset site codes missing from the spreadsheet.

## Find Certified Women- and Minority-Owned Firms

`/shop-diverse/` helps contractors and agency buyers find certified Women-owned (WBE) and Minority-owned (MBE) firms to meet M/WBE goals, from NYC Small Business Services' [SBS Certified Business List](https://data.cityofnewyork.us/d/ci93-uc8s) (`ci93-uc8s`, ~11,850 rows, updated about every two weeks). About 55% of firms with a sector are in professional services or construction, and about 5% in retail or food, so the page is a procurement directory: filters for NAICS/NIGP code, bonding limit, largest past contract and union status, and a shortlist to download as CSV. The header links residents to the retail and food sectors (`CONSUMER_SECTORS` in `config.js`).

**Architecture.** A job (`shop-diverse:vendors:v4`, rebuilt when the list changes, in `src/lib/server/shop-diverse.js`) pages through the dataset with SoQL, cleans every row (`src/lib/shop-diverse/clean.js`) and keeps a slim index in KV (about 7 MB): the fields search, ranking and cards use, each industry name once in a shared table, and each description reduced to its card excerpt plus, for keyword search, the other words it holds (each once, without filler words or words the name and industry already hold). The index also keeps each firm's NAICS code, NIGP codes (one space-separated string), bonding limit, largest contract and whether it names a union. The job also stores the share of businesses outside NYC and how many firms give each capacity field, for the About section. `/api/shop-diverse/search` filters, ranks and pages that index in the Worker and caches each view at the edge for an hour (keyed by query, NYC date, data version and deploy version), with `SHOP_SEARCH_RATE_LIMITER` on misses. It never calls Socrata per request. Ranking has to run over every match before a page is cut, which SoQL can't do here: renewal dates are text, and ties use a seeded hash. `/api/shop-diverse/business/:id` reads one vendor live by `account_number` (edge-cached 6 h per deploy, `SHOP_DETAIL_RATE_LIMITER` on misses). Shop Diverse has its own rate limiters, so busy use doesn't block the other dashboards. `/api/shop-diverse/export` returns a CSV (`src/lib/shop-diverse/export.js`) for `?ids=` (the shortlist, up to 100, in order) or for a search's query (its first 100 results); it reads those vendors live by `account_number` in chunks of 50, uncached, on `SHOP_DETAIL_RATE_LIMITER`. Fields starting with `= + - @` get a leading apostrophe so spreadsheets don't run them as formulas. The shortlist itself is `[{ id, name }]` in the visitor's `localStorage` (`shop-diverse:shortlist`) and appears only with JavaScript. The page script's URL, form, history and shortlist decisions are in `src/lib/shop-diverse/page-state.js`, with tests. The page renders the first view on the server, so shared links and the form work without JavaScript; it's cached for an hour only when that view (and any `?biz=` business) loaded.

**URL state** (`src/lib/shop-diverse/filter.js`): `who=wbe,mbe`, `match=all` (both, default either), `eth=black,asian` (narrows the MBE side), `cat`/`sub` (NAICS sector/subsector as spelled in the data), `q`, `code=238210,914` (NAICS or NIGP codes, any of, each matching the start of the firm's NAICS code or any of its NIGP codes), `bond`/`contract` (a minimum: `100k`, `500k`, `1m`, `5m`, `10m`, `25m`; firms that give none drop out), `union=1`, `boro` (`manhattan` … `staten-island`, `outside`), `zip`, `sort` (`recommended`, `az`, `newest`, `oldest`, `bonding`, `contract`; blanks sort last), `lapsed=1`, `page`, and `biz=<account>` for the open business.

**Fields used.** `account_number`, `vendor_formal_name`, `vendor_dba`, `certification`, `cert_renewal_date`, `ethnicity`, `naics_sector`/`naics_subsector`/`naics_title`/`id6_digit_naics_code`, `nigp_codes`, `business_description`, `first_name`/`last_name`, `telephone`, `website`, address fields, `borough`, `date_of_establishment`, `aggregate_bonding_limit`, `signatory_to_union_contracts`, `largest_value_of_contract`, the three past-job blocks, `enrolled_in_passport`.

**Recommended order** (`src/lib/shop-diverse/ranking.js`, tested in `tests/shop-diverse.test.js`). Points are summed, highest first:

| Rule | Points |
|---|---|
| Subcategory picked / category picked (the same for every result) | +30 / +20 |
| Keyword in the industry title / only its sector or subsector / business name / only the description | +25 / +20 / +15 / +8 |
| Valid website, description of 40+ characters, usable phone | +6, +5, +2 |
| Holds both MBE and WBE, only when the visitor picked both | +3 |
| Years in business | +0.5 per year, max +5 |
| In one of the five boroughs | +10 |
| Same ZIP as the one entered / else same borough | +12 / +6 |
| Ties | FNV-1a hash of id + NYC date (stable all day, reshuffled daily) |

A firm whose renewal dates have all passed is hidden unless `lapsed=1`, and then sorts last in every order; it isn't scored.

Ethnicity and gender never score. **No renewal date scores the same as a current one**, because every WBE-only firm has no renewal date; penalizing that would bury women-owned businesses. The MBE+WBE bonus is limited to visitors who asked for both because most firms max out the other points, so an always-on bonus decided nearly every tie. The NYC bonus exists because about a third of the list is outside the five boroughs and, with no keyword, the order is mostly the daily tie shuffle; it's kept below the 12-point gap between an industry and a description keyword match. The industry title outscores the sector and subsector so `plumber` puts plumbing contractors (title) above hardware and HVAC wholesalers (whose subsector mentions plumbing); that 5-point gap is under the NYC bonus, so it orders firms within NYC and outside it, not across. Keywords of one or two letters (`it`, `av`) must match a whole word, since a word-start match finds nearly everything.

**Data quirks found (Oct 2026).** One row per vendor, so no dedupe was needed, and each vendor has exactly one NAICS code. There's **no email column**. `cert_renewal_date` is text (`M/D/YYYY`), sometimes doubled (`11/30/2026;11/30/2026`), and blank for all WBE-only firms. ZIPs are numeric, so NJ/New England ZIPs lose their leading zero. Names have junk prefixes (`=---`) and ~700 are all caps. Websites include `N/A`, `http://Under Construction` and company names. Phones come in mixed formats. Some establishment dates are in the future (up to 2996). `borough` is blank for ~4,700 rows: mostly outside NYC (NJ alone is ~1,000), but some NYC addresses failed to geocode and get a borough from their ZIP. `types_of_construction_projects_performed` and `capacity_building_programs` are always empty.

## NYC School Quality Explorer

`/school-quality/` helps parents find any NYC public school and see how it's doing now and over time, from NYC DOE's [School Quality Reports Data](https://data.cityofnewyork.us/d/dnpx-dfnc) (`dnpx-dfnc`, ~1.5 million rows, school years 2015–16 to 2024–25, updated about once a year).

**Data shape.** Long format: one row per `dbn` × `school_year` × `metric_variable_name`, with `metric_value`, `comparison_group_average` (DOE's similar-schools average), `metric_score` (DOE's 1.00–4.99 rating against targets) and `number_of_students`. `school_year` is the fall year (2024 = 2024–25). A school has one report per `report_type` (EMS, HS, HST, EC, D75, YABC); 6–12 schools have two. There's no value-type column and no citywide value.

**Architecture.** A job (`schools:index:v3`, rebuilt when the reports or the bundled locations change, in `src/lib/server/schools.js`) keeps an index in KV: each school's name (its newest), report types, location, card and sort values for its newest year, and the NYC average of every curated metric for every year, `sum(metric_value * number_of_students) / sum(number_of_students)` per report type, computed by Socrata. `/api/schools/search` filters, sorts and pages it in the Worker (edge-cached 1 h, `SCHOOL_SEARCH_RATE_LIMITER` on misses; `view=map` returns every match as points). `/school-quality/<DBN>/` reads that school's curated metrics for every year live (one query by DBN, edge-cached 6 h, `DETAIL_RATE_LIMITER` on misses); lower-case DBNs redirect, unknown ones 404.

**Curated metrics** are all in `src/lib/schools/metrics.js` (label, description, format, scale/invert, report types, higher-is-better, card order, sort key, series break, trend threshold). Pages and cards read only that file.

| Report | Metrics |
|---|---|
| Elementary/middle (EMS) | ELA and math proficiency, chronic absenteeism (cards), attendance, former 5th graders' middle school pass rate, former 8th graders on track in 9th grade, 8th graders earning HS credit, students (context) |
| High school (HS) | 4-year graduation, college and career readiness, college/training enrollment within 18 months (cards), 6-year graduation, college prep course index, 9th graders on track, chronic absenteeism, attendance, students (context) |
| Transfer (HST) / YABC | Graduation rate, college/training within 6 months / stayed in school (cards), college prep course index, college and career readiness (HST, 2024–25 only), Regents completion, change in attendance |
| Early childhood (EC) | Chronic absenteeism, attendance (cards), ELA and math proficiency where tested, students (context) |
| District 75 | NYSAA ELA and math Level 3–4 (cards), moved to less restrictive settings, moved to a non-D75 school, change in attendance |

**Rules** (`src/lib/schools/values.js`, tested in `tests/schools.test.js`): blanks are "Not reported", never 0. Trend = least-squares change over the last 3 years with a value (from the metric's series break on), improving/declining at ±3 points by default. DOE bands: 4+ Exceeding, 3+ Meeting, 2+ Approaching, else Not meeting target. Years missing inside a series are shaded on the chart, with the COVID-19 reason for 2019–20 and 2020–21.

**URL state** (`src/lib/schools/filter.js`): `q` (name, typo-tolerant, or DBN like `02M475`/`M475`), `type` (`elementary`, `k-8`, `middle`, `high-school`, `transfer`, `early-childhood`, `d75`, `yabc`), `boro`, `where` (street, ZIP, neighborhood), `all=1` (include schools with no report for the newest year), `sort` (`district`, `ela`, `math`, `grad`, `absent`), `page`, `view=map`.

**Locations.** The reports have no address. `npm run data:school-locations` rebuilds `src/data/school-locations.json` by DBN from DOE's [2019 - 2020 School Locations](https://data.cityofnewyork.us/d/wg9x-4ke6) (newest file keyed by DBN, no ZIP), with ZIPs from DCP's [Facilities Database](https://data.cityofnewyork.us/d/ji82-xba5) by BBL, then address. Schools opened since 2019–20 are matched to the Facilities Database by name within the borough, only when one facility has that name. Oct 2026: 1,978 of 2,006 schools located (all but 5 of the 1,874 with a 2024–25 report); the rest are YABCs (evening programs in host buildings) and a few new schools. 70 located schools have no ZIP.

**Data quirks found (Oct 2026).** `chronic_absent_*` is the share of students with **90%+ attendance**, despite the name; we show 1 − value. `ccr_*` is 0–100 while every other percent is 0–1. State tests are missing for 2019–20 and 2020–21, and new tests started in 2022–23 (trends start there). College and career readiness exists only from 2023–24 (HS) and 2024–25 (HST). YABC reports stop after 2018–19. EC and D75 have no similar-schools averages. 315 DBNs changed names over the years. The dataset has no framework ratings, Quality Review ratings, enrollment or Economic Need Index; NYC Open Data has those only in single-year files through 2019–20, so they're left out (the page says so).

## Street Closures Near You

`/street-closures/` shows blocks closed for construction from NYC DOT's [Street Closures due to Construction Activities by Block](https://data.cityofnewyork.us/d/i6b5-j7bu) (`i6b5-j7bu`, ~4,500 rows, updated about weekly).

**Architecture.** The dataset is small, so a job (`street-closures:blocks:v4`, rebuilt when the hourly check finds the source changed, in `src/lib/server/street-closures.js`) keeps every block in KV (about 1 MB). `/api/street-closures/search` filters it in the Worker by street, borough or radius, keeps permits that haven't ended, and is edge-cached for an hour (keyed by place, NYC date, data version and deploy version; `CLOSURES_RATE_LIMITER` on misses). The browser gets every upcoming permit for the place and applies the time window and purpose itself (`src/lib/street-closures/closures.js`), so the tabs and filters switch without a request. The page inlines the street list for the autocomplete, built per request from the blocks with a permit that hasn't ended, so its counts don't go stale between DOT updates.

**URL state** (`src/lib/street-closures/filter.js`): `street` (the matching spelling, e.g. `WEST 8 STREET`) with optional `boro`; `boro` alone; or `lat`, `lon` (3 decimals) and `r` (`0.25`, `0.5` default, `1` mile). No place means all five boroughs. Plus `when` (`today` default, `week`, `month`, `90d`, `all`) and `purpose` (a group key from `purposes.js`). A typed address never goes in the URL.

**Data rules** (tested in `tests/street-closures.test.js`):

- `borough_code` is `M`, `X`, `B`, `Q`, `S`: Brooklyn is `B`, not `K`.
- Dates are midnight floating timestamps; both ends count, so a permit is active on day D when `start <= D <= end` (New York date). Ended permits stay in the dataset a few days and are dropped.
- About 4% of rows repeat word for word under the same `uniqueid`; they're dropped.
- A block is street + cross streets (either order) + borough. DOT's street map splits some blocks into several `segmentid`s, each with its own copy of the permit; segments with the same names that touch (within `MERGE_METERS`, 60 m) are merged into one block (lines combined) and the same work (dates and purpose) counts once, unless one segment has it twice (then they're two permits). Same names alone aren't enough: DOT writes `BEND`, `DEAD END` or `PEDESTRIAN OVERPASS` for cross streets that aren't streets, and a few segments carry the wrong borough. Counts are blocks.
- DOT posts permits only shortly before work starts, so the index keeps `postedThrough` (the latest start date). The page notes it under the window tabs when a window runs past it, and hatches those days on the per-day strip.
- Windows: "This week" ends Sunday, "This month" the month's last day, "Next 90 days" today + 89. Chips: Starts soon / Ending soon within 3 days (no chip for an ordinary active closure, which is nearly all of them); Long-running over 90 days (back-to-back permits merged).
- Street names are matched in one spelling (`streetKey()` in `streets.js`): padding collapsed, `W 8th St` → `WEST 8 STREET`, ordinals dropped, Saint as `ST`. A street search matches the closed street or either cross street, so the autocomplete lists both (minus DOT's stand-ins such as `BEND` and cemetery boundaries).
- Purposes (58 DOT permit types, some cut at 40 characters, some with a `-PROTECTED` suffix) get a plain label and one of 10 groups in `purposes.js`.
- Radius search uses the distance from the spot to the nearest point of the block's line (`geo.js`); checked against SoQL `intersects()` with a buffer polygon.

## Park Amenities Near Me

`/park-amenities/` finds the nearest NYC Parks playgrounds, dog runs, drinking fountains and pools to an address, a ZIP or "Use my location", on a map and a list kept in sync. It's built like Help Near Me (same address box, map, pins and card styles).

**Datasets** (the tabular versions, not their "Map" views; checked Nov 2026): [Playgrounds with Dedicated Children's Areas](https://data.cityofnewyork.us/d/j55h-3upk) (`j55h-3upk`, ~1,000 MultiPolygons), [Dog Runs](https://data.cityofnewyork.us/d/hxx3-bwgv) (`hxx3-bwgv`, ~95 MultiPolygons), [NYC Parks Drinking Fountains](https://data.cityofnewyork.us/d/qnv7-p7a2) (`qnv7-p7a2`, ~3,800 Points), [NYC Parks Pools](https://data.cityofnewyork.us/d/y5rm-wagw) (`y5rm-wagw`, ~90 Polygons, `location` Indoor/Outdoor), plus [Parks Properties](https://data.cityofnewyork.us/d/enfh-gkve) (`enfh-gkve`) for park names: only the fountains name their park, the rest give its `gispropnum`.

**Adding an amenity.** Add one entry to `CATEGORIES` in `src/lib/park-amenities/config.js`: dataset id and name, cadence, label, tone, pin color, icon, the columns to `select`, and `map(row)` (row → `{ id, name, parkName?, parkId?, borough, geometry, details }`), `lines(details)` and `seasonal(details)`, plus `address(details)` when a row says where in its park it is (the card's place line), `season` (its usual months and the note for in, around and out of season) for a seasonal one, `withPark` when every row has the same name, and `together` to merge rows a few metres apart in one park. The ETL job, search API, chips, "nearest of each" cards, map and list pick it up. Add real sample rows to `tests/fixtures/park-amenities.json` and a test.

**Architecture.** One ETL dataset per amenity (`park-amenities:amenities:<id>:v3`, in `src/lib/server/park-amenities.js`) fetches its rows, turns each into one point (polygons at their area-weighted centroid, `normalize.js`) and keeps the normalized amenities in KV; park names are their own job (`park-amenities:park-names:enfh-gkve:v1`). The hourly check rebuilds a job when its source changes, so geometry is fetched once per change, never per search; each amenity dataset lists the park names job in `dependsOn`, so new park names rebuild them on the next run. `/api/park-amenities/search?lat=&lon=` reads all four (building one only when KV has none yet, as in local dev: a few seconds), returns everything within 1 mile (plus 0.05 mi, `SPOT_SLACK`) plus the nearest one of any kind with none that close, and is edge-cached for an hour per rounded spot and deploy version, so a hit reads nothing from KV (a rebuilt dataset shows once that hour is up; an answer missing a dataset isn't cached; `PARKS_RATE_LIMITER` on misses). On a fresh deploy, one search (`curl "https://<site>/api/park-amenities/search?lat=40.757&lon=-73.986"`) builds all four into KV, so visitors don't wait for the first cron run to do it. The browser measures again from the exact address or GPS fix (kept in `history.state`, never sent), and applies the radius (½ mi default, or 1 mi), categories and paging itself (`nearby.js`), so they switch without a request. The list shows the nearest 8 of each kind (`PER_CATEGORY`), and "Show more" adds 8 more of each, so fountains (the most numerous) don't push the rest out of view. A "nearest of each" card outside the radius puts that amenity on the map, fitted with the spot.

**URL state** (`src/lib/park-amenities/page-state.js`): `lat`, `lon` (3 decimals), `r` (`0.5` default, `1`), `cat` (comma-separated keys; absent means all, empty means none). A typed address never goes in the URL.

**Data rules** (tested in `tests/park-amenities.test.js`):

- Borough is a letter in every dataset: `M`, `X` (Bronx), `B` (Brooklyn), `Q`, `R` (Staten Island).
- The fountain list includes food prep, slop and bathroom sinks (~160 rows); they're left out. `fountainty` is often a model letter (`A`, `D`, `E`), so cards only say what a resident can use: bottle filler, two heights (`High Low`), dog bowl, indoors, and where it is (`position`).
- `featurestatus` / `featuresta` are `Active` on every row: in the inventory, not switched on. No dataset says whether a pool is open or a fountain is on, so outdoor pools and outdoor fountains get a note from their usual season (`season` in `config.js`; the pool dates are one `year`'s: after it the page uses `usual` dates and `/api/etl/status` asks for the new ones) and "check NYC Parks for current status"; indoor pools and indoor fountains don't.
- Many fountains are several rows at nearly one point (~280 of ~3,700). Rows within 5 m in the same park, both indoor or both outdoor, are one card with their count summed ("2 fountains together").
- Only sites run by NYC Parks are listed: places like Bryant Park aren't in its inventory, and the empty list says so.
- A few dog runs have no `system` id or `gispropnum`; they get an id from their point and no park name. Park names are Parks Properties' `signname` as published.
- Distances are straight-line from the searched spot; Directions opens Google Maps at the amenity's point.

## NYC Crash Lookup

`/crash-lookup/`: for someone checking whether a person or vehicle they know may have been in a police-reported crash. Enter any mix of place, date and time, vehicle and person details; get crashes ranked by how well they fit, each with chips for what matched; open one for a deep dive (what helps recognize it first, what happened behind "Show crash details").

**Data.** The three NYPD tables on NYC Open Data: crashes (`h9gi-nx95`, key `collision_id`), vehicles (`bm4k-52h4`, key `unique_id`) and persons (`f55k-p6yu`, key `unique_id`). Things the column names don't tell you:

- `persons.vehicle_id` points at **`vehicles.unique_id`**, not `vehicles.vehicle_id` (a UUID nothing joins on).
- About 4 in 10 person rows aren't people in the crash: registered owners, witnesses, people notified. They're stored with `involved = 0`, left out of matching and counts, and listed apart in the deep dive.
- `vehicle_model` is empty or junk ("-", "0") from 2024 on, so the form has no model field.
- Makes are NCIC codes with a body class (`TOYT -CAR/SUV`, `FORD-TRUCK/BUS`); `src/lib/crashes/makes.js` maps them. Vehicle types are free text (`Sedan`, `4 dr sedan`, `PK`, `subn`); `vehicle-types.js` groups them.
- `person_injury` is only Injured / Killed / Unspecified, so "not hurt" is "No injury recorded".
- The city republishes every row daily (`:updated_at` moves on all of them), so it can't drive an incremental sync.

**Why D1.** Ranking fuzzy matches across three tables is much easier in SQL over a local copy than through SoQL, and the site already runs on Cloudflare Workers, so the copy lives in D1 (SQLite) and the lookup is one more dashboard here rather than a separate server. The same SQL runs on the local SQLite build in tests. Searches pick candidates with indexed SQL (`src/lib/crashes/search-sql.js`), then re-rank the top 400 in JavaScript (`score.js`), which also decides the chips.

**Set up and load the data** (Node 22.5+ for `node:sqlite`):

```sh
npm run data:crashes                       # fetch from NYC Open Data, build .data/crashes/crashes.sqlite
npm run data:crashes:push -- --local       # load it into the local D1 that `npm run dev` reads
npm run dev                                # http://localhost:4321/crash-lookup/
```

`SOCRATA_APP_TOKEN` (optional, in `.dev.vars` or the environment) raises Socrata's rate limits; without one the first fetch (about 600,000 rows for a year) can take an hour or so. A stopped fetch picks up after the tables it finished; `-- --refetch` starts over. The fetch is kept in `.data/crashes/raw/` (gitignored), so changing a normalizer only needs `npm run data:crashes` again, not a new fetch. The build prints rows per table, orphans (vehicles or persons whose crash isn't in the crash table, persons whose vehicle is missing; kept, not dropped) and the most common makes and vehicle types the maps don't know yet.

**Production.** After the first deploy creates the D1 database (`asknycdata-crashes`, binding `CRASHES_DB`): `npm run data:crashes:push -- --remote`. A push replaces the tables in one go (built as `*_next`, then swapped in) and keeps `ingest_log`.

**Keeping it current.** The hourly cron (as dataset `crashes` in `etl.js`) runs `src/lib/server/crashes-sync.js` when the crash table changes: it re-reads the last 45 days (`SYNC_DAYS`) of all three tables, writes only rows whose hash changed, and deletes rows the city dropped from that window, plus crashes (and their vehicles, persons and street rows) that have aged out of the one-year range. It refuses to delete anything if the source suddenly has far fewer crashes than the database. Older amendments need a full rebuild, about monthly (`npm run data:crashes -- --refetch`, then `push -- --remote`); `/api/etl/status` says when one is due (`REBUILD_DUE_DAYS`).

**Change the date range.** The lookup covers a rolling window: `dateRange()` in `src/lib/crashes/config.js` returns the last `RANGE_YEARS` (1) years before today in New York, through the latest data. Change `RANGE_YEARS`, then do a full rebuild and push. The form's date limits, the page copy and every query follow it; the build drops fetched rows older than the window on the day it runs.

**API.**
- `POST /api/crashes/search` with `{ location, date, time, vehicle, person }` (all optional; `src/lib/crashes/query.js`) → `{ dataThrough, total, broad, dateOnly, results }`, the best 50; `400 { problems }` for input it can't use.
- `GET /api/crashes/:collision_id` → the deep dive (`src/lib/crashes/detail.js`).

Both read D1 only, are cached at the edge for an hour per query and data version, and are rate limited per client (`CRASHES_RATE_LIMITER`, 60 a minute).

**Tests.** `tests/crashes.test.js` (normalizers, form, scoring, the search on a small in-memory database, the sync diff, rendering) runs with `npm test`. `tests/crashes-e2e.test.js` searches the real build in `.data/crashes/` with partial details of known crashes and checks each ranks at or near the top; it skips when there's no build.

**Privacy.** The data has no names, plates or license numbers. Don't add anything that joins it to other sources to identify people.

## NYC Crash Hotspots

`/crash-hotspots/`: for residents asking which corners near them are dangerous and what to do about it. Pick all of NYC, a borough, ZIP, street, intersection or address (a 250 or 500 m circle), and optionally how you get around (`mode`: walk counts crashes that hurt a pedestrian, bike a cyclist or e-rider, drive every crash; it also picks who the tips talk to). The page shows three stat cards (crashes that hurt someone, people killed or seriously hurt, and for an intersection its rank in its borough), "What to watch for here" (kinds of crash clearly more common than in the borough, tip first), and the intersections where crashes hurt people most, each with what goes wrong there against its borough and a tip, next to a map of the same numbered corners and a dot per serious or fatal crash. Picking an intersection shows "What goes wrong here" and the map. The view lives in the URL.

Deliberately left out: time of day, trends by month and full breakdowns. They're interesting but don't change what anyone does at a given corner; the time and day columns are still in `crash_facts`.

**Data.** The same D1 database as the crash lookup, through one extra table, `crash_facts`: a row per crash with each filter group stored as a bitmask (`src/lib/crashes/facts.js`), so any mix of filters is one scan of a narrow table with no joins. The full build writes it from the three tables; the daily sync rewrites a crash's row when it or any of its vehicles or persons changed (the row's hash covers all of them, plus `FACTS_VERSION`). A database built before this dashboard has no `crash_facts` until its next full build: run `npm run data:crashes` and `push` again; the page says the data isn't loaded until then.

- Bits are stored, so a group's `bit` never changes; add groups with the next free one. Changing a mapping rule: bump `FACTS_VERSION` and rebuild.
- "Seriously hurt" isn't on the report; `personSeverity()` reads it from the injury type (fracture, internal, concussion, crush, severe bleeding…) and emotional status (unconscious, semiconscious, apparent death). The page says it's a stand-in for the city's KSI count.
- The build prints contributing factors and pre-crash actions no group takes, like it does for makes.

**API.** `GET /api/crash-hotspots/summary` and `GET /api/crash-hotspots/map` (serious and fatal crashes), both taking the page's URL parameters (`src/lib/crashes/hotspot-query.js`). SQL is in `hotspot-sql.js`; the summary carries every borough's totals for the mode, so an area and each of its corners are compared with their own borough (a borough with NYC). Both are cached at the edge for an hour per view and data version and rate limited per client (`HOTSPOTS_RATE_LIMITER`, 60 a minute); the four citywide views (no mode, and each mode) are also kept in KV per data version.

**Tests.** `tests/crash-hotspots.test.js`: the groups and severity, bit stability, `factsRow()`, the URL round trip, the SQL on an in-memory database (totals, borough totals, ranked corners, an intersection's rank), the sync diff, "What to watch for", corner findings and tips.

## Theme

Colors, spacing, radius, and layout sizes are CSS variables at the top of `src/styles/landing.css`.
