/*
 * Settings for "Where can I get help near me?", a locator for social-service
 * sites from seven NYC Open Data directories. Everything tunable lives here.
 * Safe to import from the browser (no secrets).
 *
 * Checked against the API (Oct 2026), see normalize.js for each dataset's
 * columns and quirks. Every directory has lat/lon on nearly every row; the
 * few without are geocoded with NYC GeoSearch in the ETL job, never per
 * request (src/lib/server/help-near-me.js).
 */
export const DOMAIN = "https://data.cityofnewyork.us";
export const datasetUrl = (id) => `${DOMAIN}/d/${id}`;

/*
 * The categories, in chip order. label is what residents see (no agency
 * acronyms); tone picks the chip colors ([data-tone] in landing.css); color
 * is the map marker (the basemap is light in both themes, so fixed hex);
 * icon is the inner SVG of a 24×24 stroke icon, used on chips, badges and
 * markers so color is never the only cue.
 *   cadence  how often the city says it publishes (src/lib/etl/cadence.js)
 */
export const CATEGORIES = [
  {
    key: "snap", label: "Food & Cash Benefits (SNAP)", short: "Food & cash benefits",
    datasetId: "tc6u-8rnp", datasetName: "Directory of SNAP Centers", agency: "Human Resources Administration",
    cadence: "yearly", tone: "green", color: "#1E7A3C",
    icon: '<path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7L4 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>'
  },
  {
    key: "homebase", label: "Homelessness Prevention", short: "Homelessness prevention",
    datasetId: "ntcm-2w4k", datasetName: "Directory of Homebase Locations", agency: "Department of Homeless Services",
    cadence: "as-needed", tone: "orange", color: "#A14A0C",
    icon: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'
  },
  {
    key: "dropin", label: "Drop-In Centers", short: "Drop-in centers",
    datasetId: "bmxf-3rd4", datasetName: "Directory of Homeless Drop-In Centers", agency: "Department of Homeless Services",
    cadence: "yearly", tone: "red", color: "#B3261E",
    icon: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/><path d="M12 4v2"/>'
  },
  {
    key: "computers", label: "Free Computers & Internet", short: "Free computers & internet",
    datasetId: "sejx-2gn3", datasetName: "Citywide Public Computer Centers", agency: "Office of Technology and Innovation",
    cadence: "yearly", tone: "blue", color: "#1F4FB8",
    icon: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>'
  },
  {
    key: "youth", label: "Youth Programs", short: "Youth programs",
    datasetId: "ebkm-iyma", datasetName: "DYCD Program Sites", agency: "Department of Youth and Community Development",
    cadence: "yearly", tone: "purple", color: "#5B3FC4",
    icon: '<circle cx="12" cy="6" r="2.5"/><path d="M12 9v6M8 12h8M9 21l3-6 3 6"/>'
  },
  {
    key: "older", label: "Older Adults", short: "Older adults",
    datasetId: "cqc8-am9x", datasetName: "Department for the Aging (NYC Aging) - All Contracted Providers", agency: "NYC Aging",
    cadence: "monthly", tone: "teal", color: "#0F6E66",
    icon: '<circle cx="11" cy="5" r="2.5"/><path d="M11 8v6l-3 7M11 14l3 7M15 11l2 10"/>'
  },
  {
    key: "nycha", label: "Community Centers (NYCHA)", short: "NYCHA community centers",
    datasetId: "crns-fw6u", datasetName: "Directory of NYCHA Community Facilities", agency: "New York City Housing Authority",
    cadence: "quarterly", tone: "pink", color: "#B0306E",
    icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.2"/><path d="M16.5 14a4.5 4.5 0 0 1 4.5 5"/>'
  }
];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const categoryOf = (key) => CATEGORIES.find((c) => c.key === key) ?? null;
export const categoryByDataset = (id) => CATEGORIES.find((c) => c.datasetId === id) ?? null;

// Radius choices in miles; the URL keeps the number (?r=2).
export const RADII = [0.5, 1, 2];
export const DEFAULT_RADIUS = 2;
export const MAX_RADIUS = 2;            // the API sends every site within this
export const FAR_PER_CATEGORY = 3;      // and, for a category with none that close, its nearest few anywhere
export const PER_CATEGORY = 5;          // list: nearest this many per category, then "Show more" adds as many again
export const METERS_PER_MILE = 1609.344;

/*
 * A whole borough instead of a spot: every site in it, no distances. The URL
 * keeps the key (?boro=bronx); label is the sites' borough field; inText goes
 * mid-sentence ("12 places in the Bronx").
 */
export const BOROUGHS = [
  { key: "manhattan", label: "Manhattan", inText: "in Manhattan" },
  { key: "bronx", label: "Bronx", inText: "in the Bronx" },
  { key: "brooklyn", label: "Brooklyn", inText: "in Brooklyn" },
  { key: "queens", label: "Queens", inText: "in Queens" },
  { key: "staten-island", label: "Staten Island", inText: "on Staten Island" }
];
export const boroughOf = (key) => BOROUGHS.find((b) => b.key === key) ?? null;

export const HOURS_MISSING = "Call ahead / hours not listed";
export const PHONE_MISSING = "No phone listed";

// A directory counts as old news after this long without an update (shown next to its date).
export const STALE_DAYS = 365;

export const ERROR_TEXT = "Couldn’t reach NYC Open Data. Try again in a minute, or call 311 for help finding services.";
