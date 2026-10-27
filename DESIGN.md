# DESIGN.md — NYC Civic Data Site

> Reference for Claude Code. Read this before building or changing any page, component, or piece of copy. When a decision isn't covered here, choose the option that is **more trustworthy first, more fun second**.

Product name is a placeholder: `[SiteName]`. Replace it everywhere once chosen.

---

## 1. What we're building

A website that makes NYC Open Data (Socrata datasets) easy to explore and understand. People come to look at real city data — restaurant inspections, 311 complaints, housing, transit, permits, and so on — and leave knowing something true about their city.

**First draft scope:** static/data-driven pages only. **No chatbot, no AI chat UI, no prompt box.** Do not add chat bubbles, "Ask AI" buttons, or sparkle icons. Leave layout room so a conversational interface can be added later (see §14), but build nothing for it now.

### Audience
- Curious New Yorkers (renters, commuters, parents, restaurant-goers)
- Small business owners and journalists who need quick, credible numbers
- Civic-minded people who aren't data people

### The feeling
**A sharp, friendly neighbor who works at City Hall and actually reads the spreadsheets.** Knows the city, tells it straight, has a sense of humor, never overstates what the data says.

---

## 2. Brand personality

| We are | We are not |
|---|---|
| Friendly, direct, a little wry | Snarky, mean, or cynical about city workers |
| Fun in the details | Gimmicky or cluttered |
| Plain-spoken | Jargon-heavy or bureaucratic |
| Careful with claims | Sensational, clickbaity, or alarmist |
| Proudly local | Tourist-cliché NYC (no "I ♥ NY" knockoffs, no "Big Apple" every sentence) |

**Personality dial:** 70% trustworthy, 30% fun. Fun lives in microcopy, empty states, loading text, illustrations, and section intros. Fun never appears in numbers, methodology, warnings, or error explanations.

---

## 3. Voice and copywriting

### Principles
1. **Lead with the answer.** Number first, joke second (if at all).
2. **Short sentences.** Plain words. Say "complaints," not "service request volume."
3. **Name the source and date.** Every stat shows where it came from and when it was last updated.
4. **Say what we don't know.** Data gaps, lags, and caveats are stated plainly, not hidden.
5. **Local flavor, lightly.** Borough names, subway lines, bodega/stoop/deli references — one touch per screen at most.
6. **Never blame or shame** individuals, businesses, or neighborhoods. Data describes; it doesn't accuse.

### Tone by context
| Context | Tone | Example |
|---|---|---|
| Hero / landing | Warm, confident, playful | "Your city keeps receipts. We read them." |
| Section intros | Friendly, light humor OK | "311 got 2.3 million calls last year. Here's what New Yorkers were mad about." *(only if verified)* |
| Data labels, tooltips | Neutral, precise | "Complaints per 1,000 residents, 2025" |
| Methodology / caveats | Calm, serious, no jokes | "Inspection grades reflect a single visit and may not represent typical conditions." |
| Empty state | Fun | "Nothing here. Even the pigeons are quiet." |
| Loading | Fun, short | "Counting the cabs…" |
| Errors | Helpful first, mild humor second | "Couldn't reach NYC Open Data. Their servers might be stuck behind a double-parked truck. Try again in a minute." |

### Copy rules
- Use contractions. Use "you" and "we."
- Sentence case for headings and buttons ("Explore the data," not "Explore The Data").
- Numbers: use numerals, thousands separators, and units. Round sensibly; show exact value on hover or in a table.
- Dates: "Oct 27, 2026" in UI; ISO format in data downloads.
- Never write a claim about cause. "Complaints rose 12%" is fine. "Because of the new law, complaints rose" is not, unless the source says so.
- No all-caps shouting, no more than one exclamation mark per page, no emoji in headings or data. Emoji may appear sparingly in empty states or footers only.
- Avoid: "Big Apple," "concrete jungle," "city that never sleeps," "fuhgeddaboudit," or any accent-mocking spelling.

### Microcopy bank (use as models)
- Search placeholder: "Try a zip code, street, or topic"
- No results: "No matches. Try a nearby zip code or fewer words."
- Last updated: "Fresh from NYC Open Data · Updated Oct 26, 2026"
- Footer line: "Built with public data. Not affiliated with the City of New York."
- Data caveat label: "Heads up"
- Source label: "Where this comes from"

---

## 4. Visual identity

**Concept:** *Subway signage meets a sunny pastel zine.* Clean wayfinding, bold route-bullet circles, confident type, generous whitespace, and a bright pastel blue + yellow palette that makes civic data feel friendly.

### 4.1 Color

Soft pastel blue and pastel yellow on a warm cream page: bright, calm, and friendly. Text stays dark navy so it's always readable. Define as CSS custom properties. Use semantic names in code, not raw hex.

```css
:root {
  /* Neutrals */
  --ink:            #1C2A44; /* primary text (deep navy, not black) */
  --ink-soft:       #4F5D78; /* secondary text */
  --ink-faint:      #7A869C; /* captions, axis labels (check contrast) */
  --paper:          #FFFCF2; /* page background (soft butter cream) */
  --card:           #FFFFFF; /* card / panel background */
  --line:           #E3EAF5; /* borders, dividers */
  --line-strong:    #CBD7EA;

  /* Brand: pastel blue + pastel yellow */
  --blue:           #A9CBFF; /* header, icon fills, chart areas */
  --blue-tint:      #E7F0FF; /* active nav, chips, footer, "Good to know" */
  --blue-deep:      #1F4FB8; /* links, focus, primary data color */
  --yellow:         #FFE27A; /* signature accent: stripes, active markers, key CTA */
  --yellow-tint:    #FFF7D1; /* hovers, "Fun fact" */
  --yellow-deep:    #7A5C00; /* text on yellow tint */
  --yellow-hover:   #FFD23F; /* hover / pressed for yellow */
}
```

**Category tones** (supporting colors, used only for category icons and tags). Each tone has a pastel fill (with `--ink` icon on top), a tint (chip background) and a deep shade (chip text, sidebar icon stroke):

| Category | Tone | Fill | Tint | Deep |
|---|---|---|---|---|
| All Categories, City Government | blue | `#A9CBFF` | `#E7F0FF` | `#1F4FB8` |
| Business, Transportation | yellow | `#FFE27A` | `#FFF7D1` | `#7A5C00` |
| Health | green | `#A8E6B8` | `#E5F7EA` | `#1E7A3C` |
| Environment | teal | `#9EE3DC` | `#E2F7F4` | `#0F6E66` |
| Housing & Development | orange | `#FFC79A` | `#FFEEDF` | `#A14A0C` |
| Public Safety | red | `#FFB3AE` | `#FFE8E6` | `#B3261E` |
| Education | purple | `#CDBDFF` | `#F0EBFF` | `#5B3FC4` |
| Recreation | lime | `#D4EE9A` | `#F3FADF` | `#4D6B0A` |
| Social Services | pink | `#FFBADB` | `#FFEAF4` | `#B0306E` |

The mapping lives in `TONES` in `public/js/app.js`; a new category needs a tone there (default: blue).

**Usage rules**
- Page background is `--paper`, not pure white. Cards are `--card`.
- **Blue + yellow** are the brand. Everything outside category icons/tags uses only these two pastels plus neutrals.
- **Yellow** is the single "look here" accent: hero stripe, active-nav marker, the "NYC" highlight in the wordmark, primary CTA. Text on yellow is always `--ink`.
- **Blue** fills the header; a soft blue → yellow gradient is allowed on the header and hero only.
- **Blue-deep** for links, focus rings, primary chart series, and secondary buttons. Never use a pastel for text.
- Category tones color the icon and tag for that category, so Health always reads green, Public Safety red, and so on.
- Status colors (green/orange/red deep shades) always paired with an icon or text label, never color alone.
- Max **three** non-neutral colors visible in a single chart.
- Shadows are tinted navy/blue (`rgba(28,42,68,…)`), never gray-black.
- Dark mode: optional for v1. If built, use a deep navy page (`--paper: #121A2B`, `--card: #1A2438`, `--ink: #F2F5FB`), keep pastels as fills, and lighten deep shades for contrast.

**Contrast:** all text/background pairs must meet **WCAG AA** (4.5:1 body, 3:1 large text and UI). Verified: ink on every pastel fill ≥ 8.4:1; blue-deep on white 7.3:1; each deep shade on its tint ≥ 4.8:1; ink-soft on the header gradient ≥ 5.2:1. `--ink-faint` is only for non-essential captions; verify.

### 4.2 Typography

| Role | Font | Fallback | Notes |
|---|---|---|---|
| Display / headings | **Bricolage Grotesque** (or **Space Grotesk**) | system-ui, sans-serif | Characterful, bold, slightly quirky |
| Body / UI | **Inter** | system-ui, -apple-system, sans-serif | Highly legible |
| Numbers / tables / code | **JetBrains Mono** or Inter with `font-variant-numeric: tabular-nums` | ui-monospace | Use tabular numerals for all data |

Load via Google Fonts or `next/font`/`@fontsource`. Use `font-display: swap`. Limit to 2–3 weights per family.

**Scale** (fluid with `clamp`, base 16px):
```css
--text-xs:   0.75rem;   /* 12 — legal, axis ticks only */
--text-sm:   0.875rem;  /* 14 — captions, metadata */
--text-base: 1rem;      /* 16 — body */
--text-lg:   1.125rem;  /* 18 — lead paragraphs */
--text-xl:   1.375rem;  /* 22 — card titles */
--text-2xl:  clamp(1.75rem, 1.4rem + 1.5vw, 2.25rem);  /* h2 */
--text-3xl:  clamp(2.25rem, 1.6rem + 2.8vw, 3.5rem);   /* h1 */
--text-hero: clamp(2.75rem, 1.8rem + 4.5vw, 5rem);     /* landing hero */
```
- Body line-height 1.6; headings 1.1–1.2; tight letter-spacing (-0.01 to -0.02em) on display sizes.
- Max line length: 65–75 characters for prose.
- **Big numbers** ("stat heroes") use display font, `--text-3xl` or larger, tabular nums.

### 4.3 Spacing, layout, shape

- 4px base unit. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Content max width: **1200px**; prose max width: **720px**.
- 12-column grid desktop, 4-column mobile. 24px gutters desktop, 16px mobile.
- Section vertical padding: 64–96px desktop, 40–56px mobile.
- Radius: `--radius-sm: 6px`, `--radius-md: 12px`, `--radius-lg: 20px`, pills `999px`.
- Borders: 1px `--line`. Shadows are subtle: `0 1px 2px rgba(20,24,31,.06), 0 4px 16px rgba(20,24,31,.06)`. No heavy drop shadows.
- Signature detail: **route bullets** — solid colored circles with a bold letter/number inside (like subway line markers) — used as category tags, section markers, and bullet decoration. Keep them 24–32px.

### 4.4 Iconography and illustration
- Icon set: **Lucide** (or Phosphor) — 1.5–2px stroke, rounded. One icon family only.
- Illustration style: flat, geometric, pastel palette (pastel blue, pastel yellow, one category tone + navy ink outlines on cream paper). Subjects: skyline silhouettes, fire escapes, water towers, bodega awnings, subway signage, pigeons, street grates, hydrants. Keep it charming, not cartoonish.
- **Do not use** copyrighted logos or marks: no MTA logos, official subway bullets' trademarked lettering systems beyond generic colored circles, no NYC government seal, no NYC Open Data logo as our own branding. We may *credit* "NYC Open Data" in text.
- Photography: avoid stock photos of generic skylines. If used, prefer real street-level scenes, with alt text.

---

## 5. Components

Build as reusable components with props, not one-off markup.

### Navigation
- Sticky top bar, `--blue` (or the blue → yellow gradient) with `--ink` text. Logo left, 4–5 links, one CTA right.
- Mobile: hamburger → full-screen sheet. Tap targets ≥ 44px.
- Active link: blue-deep text + 2px yellow underline.

### Buttons
- **Primary:** `--yellow` background, `--ink` text, bold, radius-md. Hover `--yellow-hover`.
- **Secondary:** white background, 1.5px `--blue-deep` border and text.
- **Tertiary/link:** blue-deep text, underline on hover.
- Focus: 3px `--blue-deep` outline with 2px offset. Never remove focus styles.
- Button text is a verb: "Explore inspections," "Download CSV," "See the methodology."

### Stat card ("Big number")
- Label (small, ink-soft) → big number (display font) → context line (e.g. "vs. 2024: +4%") → source + updated date (small).
- Optional sparkline. Optional route-bullet category tag.
- Delta chips: ▲/▼ with text, color + icon + sign (never color alone). Don't use green=good / red=bad unless direction is unambiguous; for neutral metrics use blue/gray.

### Dataset card
- Title, one-line plain-English description, tags (borough/topic), "Updated" date, row count, link to source on NYC Open Data, "Explore" CTA.

### Charts
- Library: **Observable Plot**, **D3**, **Recharts**, or **Vega-Lite** — pick one and stay consistent.
- Titles state the finding in plain language: "Rat complaints peaked in July" (only if the data supports it). Subtitle states metric, geography, time range, units.
- Direct-label lines/bars when possible; minimize legends.
- Y-axis starts at zero for bars. Lines may truncate but must say so.
- Gridlines light (`--line`), no chart borders, no 3D, no pie charts beyond 4 slices, no dual-axis unless unavoidable.
- Tooltips: exact value, unit, date range.
- Every chart has: alt text/summary, a "View as table" toggle, a "Download CSV" link, and a source line.
- Categorical palette order: blue → yellow → green → orange → purple → teal → gray (use the pastel fills for areas/bars with ink labels; deep tones for lines and small marks). Colorblind-safe: test with a simulator; add patterns or direct labels.

### Maps
- Library: **MapLibre GL** or **Leaflet** with a muted, light basemap (so data colors pop).
- Choropleths: sequential single-hue pastel blue → blue-deep scale (5–7 bins), with a legend and "no data" gray hatch.
- Normalize by population/area when comparing neighborhoods; say so in the legend.
- Always provide a non-map alternative (ranked list or table) and keyboard-accessible controls.
- Boundaries: borough, community district, zip/ZCTA, neighborhood tabulation area (NTA) — state which one in the subtitle.

### Tables
- Sticky header, zebra striping very faint, tabular numerals right-aligned, sortable columns with `aria-sort`.
- Mobile: horizontal scroll with a visible scroll hint, or collapse to stacked rows.
- Pagination or virtualization for > 100 rows.

### Search and filters
- Prominent search on home and explore pages. Typeahead for zip codes, boroughs, neighborhoods, topics.
- Filters as pill toggles (borough, year, category). Show active filters as removable chips.

### Callouts
- **"Heads up"** (orange tone tint): caveats and data limits.
- **"Good to know"** (blue tint): context and definitions.
- **"Fun fact"** (yellow tint): light trivia, always sourced. Max one per page.

### Badges / route bullets
- Pastel circle (the category's tone, or blue/yellow) with an `--ink` letter/number, used for boroughs (e.g. **M**, **B**, **Q**, **Bx**, **SI**) and topics. These are our own generic bullets, not official MTA assets.

### Footer
- Links: About, Methodology, Data sources, Accessibility, Contact.
- Required line: "Built with public data from NYC Open Data. Not affiliated with or endorsed by the City of New York."
- Show "Data last refreshed" timestamp.

---

## 6. Page templates

### 6.1 Home
1. **Hero:** big display headline, one-line subhead, search bar, 3 suggested searches as pills ("Restaurant grades near me", "311 noise complaints", "Rent-stabilized buildings"). Subtle skyline illustration in the background. No chat box.
2. **Today's numbers:** 3–4 stat cards from live data.
3. **Explore by topic:** grid of topic cards (Food & inspections, 311, Housing, Transportation, Public safety, Environment, Business & permits) with route-bullet icons.
4. **Featured story/insight:** one data story with a chart.
5. **How it works / Where the data comes from:** 3 short steps, link to methodology.
6. **Footer.**

### 6.2 Explore / Dataset listing
- Left filter rail (collapses to a drawer on mobile), results grid of dataset cards, sort by recently updated / popular / A–Z.

### 6.3 Topic page (e.g., Restaurant Inspections)
- Intro paragraph (plain English, light humor allowed) → key stats → primary chart → map → searchable table → "How to read this data" → caveats → source links.

### 6.4 Neighborhood / location page
- Header with place name and borough bullet → comparable stat cards across topics → mini-maps → "How this compares to the city" chart.

### 6.5 Story / insight page
- Narrow prose column, inline charts, pull-quote-sized stat callouts, sources and method at the end.

### 6.6 Methodology and Data sources
- Plain, calm, no jokes. Explain datasets used, refresh cadence, cleaning steps, known limitations, and how numbers are calculated. Link to each Socrata dataset ID.

### 6.7 About
- Who made this, why, how to give feedback. Friendly voice allowed.

### 6.8 Utility states
- 404: "That page took the wrong train." + search + link home.
- Empty, loading (skeletons, not spinners), error, and offline states all use the voice rules in §3.

---

## 7. Data trust patterns (non-negotiable)

Every number or chart on the site must show:
1. **Source:** dataset name linking to the NYC Open Data page (include dataset ID, e.g. `43nn-pn8j`).
2. **Freshness:** last updated date from the Socrata metadata (`rowsUpdatedAt`).
3. **Scope:** geography, time range, and filters applied.
4. **Method note** if anything was calculated, normalized, deduplicated, or sampled.
5. **Limits:** known caveats (reporting lag, self-reported data, undercounting, changed definitions).

Additional rules:
- Never display a figure that isn't traceable to a dataset query. No placeholder numbers in production; use clearly labeled sample data in development (`SAMPLE DATA` ribbon).
- Per-capita vs. raw counts: always label which one.
- Small counts: suppress or flag very small numbers where they could mislead or identify people.
- Don't rank or "shame" individual businesses or addresses in headlines. Aggregate where possible.
- Restaurant inspection data and similar business data: show violation context and dates; say that conditions change and a single inspection is a snapshot.
- Provide a "Report a data problem" link on topic pages.
- Corrections policy lives on the About page.

---

## 8. Motion and interaction

- Motion is purposeful and brief: 150–250ms ease-out for UI; up to 600ms for chart entrance.
- Fun motion allowed in: hero (slow-drifting clouds/pigeons), hover on route bullets (small bounce), number count-up on first scroll into view (once, skip for exact-value tables).
- **Respect `prefers-reduced-motion`:** disable count-ups, parallax, and decorative loops.
- No auto-playing sound or video. No carousels that auto-advance. No scroll-jacking.
- Skeleton loaders match final layout to prevent layout shift.

---

## 9. Accessibility (required, not optional)

- Target **WCAG 2.2 AA**.
- Semantic HTML: one `h1` per page, ordered headings, landmarks (`header`, `nav`, `main`, `footer`).
- Skip-to-content link.
- Keyboard: all interactive elements reachable and operable; visible focus.
- Charts and maps: text alternative, data table view, no info conveyed by color alone.
- Form fields have visible labels; errors are announced (`aria-live`) and described in text.
- Touch targets ≥ 44×44px.
- Language attribute set; plain-language reading level around grade 8.
- Test with keyboard-only and a screen reader before shipping each template.

---

## 10. Responsive behavior

- Mobile-first. Breakpoints: 480, 768, 1024, 1280.
- Stat cards: 1 column on mobile, 2 on tablet, 3–4 on desktop.
- Charts reflow: simplify labels, reduce ticks, allow horizontal scroll for wide tables, never shrink text below 12px.
- Maps: full-width on mobile with a "Show list" toggle.
- Performance target: LCP < 2.5s on a mid-range phone on 4G; CLS < 0.1.

---

## 11. Technical guidance for Claude Code

**Suggested stack** (adjust if the repo already uses something else — match the existing project first):
- Framework: Next.js (App Router) + TypeScript
- Styling: Tailwind CSS with the tokens above mapped into `tailwind.config` / CSS variables
- Data: Socrata SODA API (`https://data.cityofnewyork.us/resource/<dataset-id>.json`) queried server-side with SoQL; cache with revalidation; use an app token via environment variable (`SOCRATA_APP_TOKEN`), never exposed to the client
- Charts: Observable Plot or Recharts; Maps: MapLibre GL
- Testing: Playwright (smoke + a11y with axe), Vitest for data utilities

**Conventions**
- Components live in `components/` with one folder each (`StatCard/`, `DatasetCard/`, `ChartFrame/`, `Callout/`, `RouteBullet/`).
- A `ChartFrame` wrapper enforces title, subtitle, source, updated date, caveat slot, table toggle, and CSV download for every chart.
- A `lib/socrata.ts` module centralizes queries, dataset IDs, and metadata fetching. No raw fetches scattered through components.
- Design tokens in a single `styles/tokens.css`; no hard-coded hex values in components.
- Copy strings that carry voice (empty states, errors, loading) live in `content/microcopy.ts` so tone can be tuned in one place.
- Handle API failures gracefully: show cached data with a "showing data from [date]" notice, or the friendly error state.
- Environment variables documented in `.env.example`.
- Commit small; keep this file updated when design decisions change.

**Definition of done for any page**
- [ ] Uses tokens, not ad hoc colors/sizes
- [ ] Every stat/chart has source, date, scope (see §7)
- [ ] Voice check: answer first, plain words, humor only where allowed
- [ ] Keyboard and screen-reader pass
- [ ] Mobile layout checked at 375px
- [ ] No chatbot/AI UI present
- [ ] Lighthouse accessibility ≥ 95

---

## 12. Do and don't

**Do**
- Put the number up front and make it huge.
- Use pastel route-bullet circles and pastel blue + yellow as the recognizable signature.
- Explain what a dataset field means in plain English.
- Link out to the original dataset every time.
- Let empty and error states be charming.

**Don't**
- Use official MTA/NYC logos, seals, or trademarked typefaces (e.g., Helvetica-as-signage cloning with MTA branding).
- Make jokes about crime, deaths, evictions, injuries, or other sensitive data.
- Imply causation, predict outcomes, or editorialize on politics.
- Use dark patterns, newsletter popups on load, or cookie walls beyond what's legally required.
- Show unlabeled or untraceable statistics.
- Add AI chat, "Ask Claude," sparkle icons, or any conversational input in v1.

---

## 13. Sample copy (reference)

**Hero**
> **Your city keeps receipts.**
> Real NYC data on restaurants, 311, housing, and more — explained like a person would explain it.
> [Search box: "Try a zip code, street, or topic"]

**Stat card**
> 27,412 *(big)*
> restaurant inspections in the last 12 months
> Source: DOHMH Restaurant Inspection Results · Updated Oct 26, 2026 *(example only — replace with live data)*

**Caveat**
> **Heads up:** A grade reflects one inspection on one day. Restaurants can and do improve (or slip) between visits.

**Empty state**
> No results. Even the pigeons are quiet. Try a nearby zip code.

**404**
> That page took the wrong train. Let's get you back on track — try search or head home.

**Footer**
> Built with public data from NYC Open Data. Not affiliated with or endorsed by the City of New York.

---

## 14. Future: conversational layer (do not build yet)

A natural-language Q&A interface may be added in a later version. For now:
- Keep the header and home hero flexible so a prompt input could replace or sit beside the search bar.
- Keep all data access behind `lib/socrata.ts` and typed query helpers so an agent can call them later.
- Write dataset descriptions and field glossaries in plain language now — they'll double as grounding context later.
- Do **not** add placeholder chat UI, routes, API endpoints, or dependencies for it in this draft.

---

## 15. Open decisions for the owner

- Final product name and logo mark
- Whether to launch with dark mode
- Whether pastel blue + yellow reads too close to existing civic brands
- Which 3–5 topics ship first
- Analytics/monetization approach and the related cookie/consent requirements
