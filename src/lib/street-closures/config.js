/*
 * Settings for "Street Closures Near You" (NYC DOT's Street Closures due to
 * Construction Activities by Block, dataset i6b5-j7bu). Everything tunable
 * lives here. Safe to import from the browser (no secrets).
 *
 * Checked against the API (Oct 2026): ~4,500 rows, one per permit per block;
 * work_start_date / work_end_date are calendar dates at midnight
 * ("2026-10-27T00:00:00.000"); the_geom is a MultiLineString with one line;
 * borough_code is M, X, B, Q or S (Brooklyn is B, not K); 58 purpose values,
 * some truncated at 40 characters.
 */
import { dashboards } from "../../data/dashboards.js";

export const DATASET_ID = "i6b5-j7bu";
export const DATASET_URL = `https://data.cityofnewyork.us/d/${DATASET_ID}`;
export const DATASET_NAME = "Street Closures due to Construction Activities by Block";

export const BOROUGHS = [
  { value: "M", label: "Manhattan" },
  { value: "X", label: "Bronx" },
  { value: "B", label: "Brooklyn" },
  { value: "Q", label: "Queens" },
  { value: "S", label: "Staten Island" }
];
export const boroughLabel = (code) => BOROUGHS.find((b) => b.value === code)?.label ?? null;

// "Near me" radii in miles; the URL keeps the number (?r=0.25).
export const RADII = [0.25, 0.5, 1];
export const DEFAULT_RADIUS = 0.5;
export const METERS_PER_MILE = 1609.344;

// Time windows. A closure counts in a window when it's active on any day of it.
export const WINDOWS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "90d", label: "Next 90 days" },
  { key: "all", label: "All upcoming" }
];
export const DEFAULT_WINDOW = "today";

export const SOON_DAYS = 3;       // "Starts soon" / "Ending soon": within this many days
export const LONG_DAYS = 90;      // "Long-running": more than this many days in total
export const STRIP_DAYS = 60;     // the closures-per-day strip
export const TOP_STREETS = 8;     // "Most affected streets"
export const PAGE_SIZE = 25;      // cards shown before "Show more"

// The Film Permits dashboard, once it's in the registry. Cards link to it
// filtered to the same street; until it exists the link is left out.
const film = dashboards.find((d) => d.id === "film-permits");
export const FILM_PERMITS_URL = film && film.url !== "#" ? film.url : null;

export const ERROR_TEXT = "Couldn’t reach NYC Open Data. Their servers might be stuck behind a double-parked truck. Try again in a minute.";
