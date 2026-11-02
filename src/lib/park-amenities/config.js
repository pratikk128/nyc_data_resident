/*
 * Settings for "Park Amenities Near Me", a locator for NYC Parks
 * playgrounds, dog runs, drinking fountains and pools. Everything tunable
 * lives here. Safe to import from the browser (no secrets).
 *
 * To add an amenity, add one entry to CATEGORIES: its dataset, how it looks,
 * and map(row), which turns one of its rows into the common shape
 * (normalize.js). The ETL job, search API, chips, map and list pick it up.
 *
 * Checked against the API (Nov 2026), the tabular datasets (not their "Map"
 * views):
 *   Playgrounds (j55h-3upk)  publicname, publiclocation, gispropnum, borough letter; shape MultiPolygon
 *   Dog runs (hxx3-bwgv)     name, gispropnum (blank on a few), seating, surface; the_geom MultiPolygon
 *   Fountains (qnv7-p7a2)    no name; propertyna (the park), fountainty (a model letter, or words
 *                            like "Bottle Filler High Low"), position, fountainco; the_geom Point.
 *                            Also lists sinks (food prep, slop, bathroom), which are left out
 *   Pools (y5rm-wagw)        name, location (Indoor / Outdoor), pooltype (Olympic, Wading…); polygon Polygon
 * Only the fountains name their park; the rest get it from Parks Properties
 * (enfh-gkve) by gispropnum. featurestatus / featuresta are "Active" on every
 * row: the feature is in the inventory, not that it's turned on today. No
 * dataset says whether a pool is open or a fountain is on, so seasonal ones
 * get the SEASONAL note instead.
 */
export const DOMAIN = "https://data.cityofnewyork.us";
export const datasetUrl = (id) => `${DOMAIN}/d/${id}`;

// Park names for the amenities whose dataset has only the park's id.
export const PARK_NAMES = {
  datasetId: "enfh-gkve", datasetName: "Parks Properties", cadence: "monthly"
};

const BOROUGH_LETTERS = { M: "Manhattan", X: "Bronx", B: "Brooklyn", Q: "Queens", R: "Staten Island" };
export const boroughName = (letter) => BOROUGH_LETTERS[String(letter ?? "").trim().toUpperCase()] ?? null;

const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
// "Out in Open, Near Ballfield" → "Out in open, near ballfield"
const sentence = (s) => text(s).toLowerCase().replace(/^./, (c) => c.toUpperCase());

// Fountain "types" that are sinks, not something to drink from.
const SINK = /^(food prep|slop|bathroom) sink$/i;

/*
 * The categories, in chip order. label is the chip, one the singular (the
 * "nearest of each" cards, "Pool · 0.3 mi"); tone picks the chip colors
 * ([data-tone] in landing.css); color is the map pin (the basemap is light in
 * both themes, so fixed hex); icon is the inner SVG of a 24×24 stroke icon on
 * chips, cards and pins, so color is never the only cue.
 *   cadence   how often the city says it publishes (src/lib/etl/cadence.js)
 *   select    the columns the ETL asks for
 *   map(row)  → { id, name, parkName?, parkId?, borough, geometry, details } or null to leave the row out
 *   lines(d)  the details as short phrases for a card
 *   seasonal(d)  true when the card gets the SEASONAL note
 */
export const CATEGORIES = [
  {
    key: "playground", label: "Playgrounds", one: "Playground",
    datasetId: "j55h-3upk", datasetName: "Playgrounds with Dedicated Children's Areas (DCAs)",
    cadence: "as-needed", tone: "orange", color: "#A14A0C",
    icon: '<path d="M5 21V4M9 21V4M5 8h4M5 12h4M5 16h4"/><path d="M9 5c4 0 5 4 7 8s3 7 5 7"/>',
    select: ["system", "publicname", "publiclocation", "gispropnum", "borough", "shape"],
    map: (r) => ({
      id: r.system, name: r.publicname, parkId: r.gispropnum, borough: r.borough, geometry: r.shape,
      details: { where: text(r.publiclocation) || null }
    }),
    lines: (d) => (d.where ? [d.where] : []),
    seasonal: () => false
  },
  {
    key: "dog", label: "Dog runs", one: "Dog run",
    datasetId: "hxx3-bwgv", datasetName: "Dog Runs",
    cadence: "monthly", tone: "purple", color: "#5B3FC4",
    icon: '<circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M12 12c-3 0-5.5 3.5-5.5 6 0 1.7 1.3 2.5 3 2.5 1 0 1.6-.5 2.5-.5s1.5.5 2.5.5c1.7 0 3-.8 3-2.5 0-2.5-2.5-6-5.5-6z"/>',
    select: ["system", "name", "gispropnum", "borough", "seating", "surface", "the_geom"],
    map: (r) => ({
      id: r.system, name: r.name, parkId: r.gispropnum, borough: r.borough, geometry: r.the_geom,
      details: { surface: text(r.surface) || null, seating: /^yes$/i.test(text(r.seating)) }
    }),
    lines: (d) => [d.surface ? `${sentence(d.surface)} surface` : null, d.seating ? "Has seating" : null].filter(Boolean),
    seasonal: () => false
  },
  {
    key: "fountain", label: "Water fountains", one: "Water fountain",
    datasetId: "qnv7-p7a2", datasetName: "NYC Parks Drinking Fountains",
    cadence: "as-needed", tone: "blue", color: "#1F4FB8",
    icon: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>',
    select: ["system", "fountainty", "position", "fountainco", "propertyna", "gispropnum", "borough", "the_geom"],
    map: (r) => {
      const type = text(r.fountainty);
      if (SINK.test(type)) return null;
      const position = text(r.position);
      const bottle = /bottle filler/i.test(type);
      return {
        id: r.system, name: bottle ? "Bottle filler" : "Drinking fountain",
        parkName: r.propertyna, parkId: r.gispropnum, borough: r.borough, geometry: r.the_geom,
        details: {
          type: type || null,
          bottleFiller: bottle,
          dogBowl: /dog/i.test(type),
          twoHeights: /high low/i.test(type),
          indoor: /^indoor|^water cooler$/i.test(type) || /\bindoor\b/i.test(position),
          position: position || null,
          count: Number(r.fountainco) > 1 ? Number(r.fountainco) : 1
        }
      };
    },
    lines: (d) => [
      d.indoor ? "Indoors" : null,
      d.position && !/^indoor$/i.test(d.position) ? sentence(d.position) : null,
      d.bottleFiller ? "Fills bottles" : null,
      d.twoHeights ? "Two heights" : null,
      d.dogBowl ? "Dog bowl" : null,
      d.count > 1 ? `${d.count} fountains together` : null
    ].filter(Boolean),
    seasonal: (d) => !d.indoor
  },
  {
    key: "pool", label: "Pools", one: "Pool",
    datasetId: "y5rm-wagw", datasetName: "NYC Parks Pools",
    cadence: "monthly", tone: "teal", color: "#0F6E66",
    icon: '<path d="M8 13V5a2 2 0 0 1 2-2M16 13V5a2 2 0 0 0-2-2M8 6h8M8 10h8"/><path d="M2 17c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 21c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/>',
    select: ["system", "name", "location", "pooltype", "gispropnum", "borough", "polygon"],
    map: (r) => ({
      id: r.system, name: r.name, parkId: r.gispropnum, borough: r.borough, geometry: r.polygon,
      details: { indoor: /^indoor$/i.test(text(r.location)), size: text(r.pooltype) || null }
    }),
    // "Outdoor", "Olympic pool" / "Intermediate and diving pool"
    lines: (d) => [d.indoor ? "Indoor" : "Outdoor", d.size ? `${sentence(d.size.replace(/&/g, "and"))} pool` : null].filter(Boolean),
    seasonal: (d) => !d.indoor
  }
];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const categoryOf = (key) => CATEGORIES.find((c) => c.key === key) ?? null;

// Radius choices in miles; the URL keeps the number (?r=1).
export const RADII = [0.5, 1];
export const DEFAULT_RADIUS = 0.5;
export const MAX_RADIUS = 1;        // the API sends every amenity within this
export const FAR_PER_CATEGORY = 1;  // and, for a category with none that close, its nearest one anywhere
export const PAGE_SIZE = 25;        // list: this many, then "Show more" adds as many again
export const METERS_PER_MILE = 1609.344;

export const PARKS_URL = "https://www.nycgovparks.org/";
// "May be seasonal; check NYC Parks for current status", with NYC Parks a link to PARKS_URL.
export const SEASONAL = { before: "May be seasonal; check ", link: "NYC Parks", after: " for current status" };

export const ERROR_TEXT = "Couldn’t reach NYC Open Data. Try again in a minute.";
