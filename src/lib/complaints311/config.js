/*
 * Settings for "311 Complaints in My Neighborhood" (NYC 311 Service Requests
 * from 2020 to Present, dataset erm2-nwe9). Everything tunable lives here:
 * field names, the two radii, the time windows and the thresholds the
 * comparisons use. Safe to import from the browser (no secrets).
 */

export const DATASET_ID = "erm2-nwe9";
export const DATASET_URL = `https://data.cityofnewyork.us/d/${DATASET_ID}`;
export const DATASET_NAME = "311 Service Requests from 2020 to Present";

// Column names, checked against /api/views/erm2-nwe9.json.
export const FIELDS = {
  created: "created_date",       // calendar_date
  closed: "closed_date",         // calendar_date
  type: "complaint_type",        // text, mixed case ("HEAT/HOT WATER", "Noise")
  descriptor: "descriptor",
  locationType: "location_type", // text, ~150 messy values, ~12% null
  zip: "incident_zip",           // text
  address: "incident_address",
  street: "street_name",
  borough: "borough",            // BRONX, BROOKLYN, MANHATTAN, QUEENS, STATEN ISLAND, Unspecified
  latitude: "latitude",
  longitude: "longitude",
  location: "location",          // point; within_circle() skips rows without one
  status: "status"               // Closed, Open, In Progress, Assigned, Pending, Started, Unspecified
};

// Radius in meters around the chosen spot.
export const RADII = { immediate: 402, neighborhood: 805 };

export const AREAS = {
  immediate: {
    key: "immediate",
    radius: RADII.immediate,
    title: "Immediate area (¼ mile)",
    label: "Your immediate area (about a 5-minute walk)",
    walk: "about a 5-minute walk"
  },
  neighborhood: {
    key: "neighborhood",
    radius: RADII.neighborhood,
    title: "Neighborhood (½ mile)",
    label: "Your neighborhood (about a 10-minute walk)",
    walk: "about a 10-minute walk"
  }
};

// Time windows, by created_date.
export const WINDOWS = {
  "3m": { key: "3m", months: 3, label: "Last 3 months", phrase: "in the last 3 months" },
  "12m": { key: "12m", months: 12, label: "Last 12 months", phrase: "in the last 12 months" }
};
export const DEFAULT_WINDOW = "12m";

// Below this many requests in the ¼ mile, compare using the ½ mile instead.
export const MIN_IMMEDIATE_REQUESTS = 100;
// A complaint type is only called out above/below average with at least this many requests locally.
export const MIN_LOCAL_COUNT = 20;
export const ABOVE_RATIO = 1.25;
export const BELOW_RATIO = 0.75;
// More / less common: the strongest types shown in each column; the rest sit behind "Show N more".
export const MAX_COMPARE_SHOWN = 5;
// Location types: the top N groups by local share are drawn; the rest fold into "Other / Not specified".
// Kept small so each slice of the share bar stays wide enough to see.
export const TOP_LOCATION_TYPES = 6;
export const TOP_COMPLAINT_TYPES = 5;

/*
 * "More than 72% of NYC blocks with any 311 requests": the city is cut into cells of
 * 1/GRID_CELLS_PER_DEGREE degree (about 111 m north–south, 84 m east–west), requests are counted per
 * cell, and the ¼ and ½ mile circles are summed around every cell that has a request. The daily
 * job keeps DISTRIBUTION_QUANTILES evenly spaced values of each sorted distribution.
 */
export const GRID_CELLS_PER_DEGREE = 1000;
export const DISTRIBUTION_QUANTILES = 1001;
// The 12 month grid in one query takes Socrata over 4 minutes; in 3 month pieces run at once, under 1.
export const GRID_CHUNK_MONTHS = 3;

// Heat map: requests counted per 1/HEATMAP_CELLS_PER_DEGREE degree cell (about 55 m × 42 m)
// within the ½ mile circle, so the browser gets a couple of thousand weighted points.
export const HEATMAP_CELLS_PER_DEGREE = 2000;
// The heat map filter: at most this many complaint types at once (the area's top 10 are offered).
export const MAX_HEATMAP_TYPES = 10;

export const STATUS_CLOSED = "Closed";

// Borough values as the dataset spells them, with display names.
export const BOROUGHS = [
  { value: "MANHATTAN", label: "Manhattan" },
  { value: "BRONX", label: "Bronx" },
  { value: "BROOKLYN", label: "Brooklyn" },
  { value: "QUEENS", label: "Queens" },
  { value: "STATEN ISLAND", label: "Staten Island" }
];
export const UNSPECIFIED_BOROUGH = "Unspecified";

export function boroughLabel(value) {
  return BOROUGHS.find((b) => b.value === value)?.label ?? null;
}
