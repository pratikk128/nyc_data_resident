/*
 * NYC Drinking Water Quality: the dataset, its columns, and the reference
 * values each measurement is compared with. Shared by the server (queries)
 * and the browser (labels, tile colors).
 *
 * The reference values come from federal (EPA, 40 CFR Part 141), New York
 * State (10 NYCRR Subpart 5-1) and NYC DEP sources, each checked against the
 * official text on 2026-10-28. We use them as reference points for single
 * samples, which is not how the city's compliance is legally determined (many
 * rules use monthly or yearly averages, or repeat samples). The page says so.
 */

export const DATASET_ID = "bkwf-xfky";
export const DATASET_NAME = "Drinking Water Quality Distribution Monitoring Data";
export const DATASET_URL = `https://data.cityofnewyork.us/d/${DATASET_ID}`;
export const SITES_FILE_NAME = "Distribution Water Quality Sampling Sites (June 2021)";

// Every measurement column is text in the API (chlorine too), so values are
// parsed (parse.js) and cast in SoQL (soql.js).
export const FIELDS = {
  date: "sample_date",
  time: "sample_time",   // "8:41", local time
  site: "sample_site",
  sampleClass: "sample_class",
  number: "sample_number",
  chlorine: "residual_free_chlorine_mg_l",
  turbidity: "turbidity_ntu",
  fluoride: "fluoride_mg_l",
  coliform: "coliform_quanti_tray_mpn_100ml",
  ecoli: "e_coli_quanti_tray_mpn_100ml"
};

/*
 * Rates and medians use routine samples only. Resamples ("Resample_Compliance",
 * "Resample_Operational", "Op-resample") are taken at a site because an earlier
 * sample there was positive, so counting them would make problems look more
 * common. E. coli and coliform detections are listed from every class.
 */
export const ROUTINE_CLASSES = ["Compliance", "Operational"];

export const REFERENCES = {
  ecoli: {
    label: "E. coli",
    unit: "MPN/100 mL",
    rule: "Any detection is notable.",
    detail: "E. coli comes from human or animal waste. Under federal rules, one positive sample isn’t a violation by itself; " +
      "the water system must take repeat samples, and a positive repeat sample is a violation.",
    source: {
      name: "EPA, 40 CFR 141.63(c) (E. coli maximum contaminant level)",
      url: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-141/subpart-G/section-141.63"
    }
  },
  coliform: {
    label: "Total coliform",
    unit: "MPN/100 mL",
    maxPositiveShare: 0.05,
    rule: "Share of samples with any coliform, per month. More than 5.0% in a month triggers a federal assessment.",
    detail: "Coliform bacteria are common in soil and water and usually harmless, but they can signal a way for germs to get in.",
    source: {
      name: "EPA, 40 CFR 141.859(a)(1)(i) (Level 1 treatment technique trigger)",
      url: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-141/subpart-Y/section-141.859"
    }
  },
  chlorine: {
    label: "Free chlorine",
    unit: "mg/L",
    min: 0,   // "detectable": a reported value above 0
    max: 4.0,
    rule: "Should be detectable throughout the pipes. The EPA maximum is 4.0 mg/L.",
    detail: "Chlorine keeps germs from growing in the pipes.",
    source: {
      name: "EPA, 40 CFR 141.65 (maximum residual disinfectant level, 4.0 mg/L) and 141.72 (a detectable residual in the distribution system)",
      url: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-141/subpart-K/section-141.65"
    },
    detectableSource: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-141/subpart-H/section-141.72"
  },
  turbidity: {
    label: "Turbidity",
    unit: "NTU",
    max: 5,
    rule: "New York State’s distribution system standard is 5 NTU (judged on the monthly average).",
    detail: "Turbidity is cloudiness. Cloudy water can hide germs from chlorine.",
    source: {
      name: "NYS DOH, 10 NYCRR Subpart 5-1, Table 5 (distribution system turbidity)",
      url: "https://www.health.ny.gov/regulations/nycrr/title_10/part_5/docs/subpart_5-1_tables.pdf"
    }
  },
  fluoride: {
    label: "Fluoride",
    unit: "mg/L",
    target: 0.7,
    max: 4.0,
    rule: "NYC adds fluoride to about 0.7 mg/L. The EPA maximum is 4.0 mg/L.",
    detail: "Fluoride is added to help prevent tooth decay.",
    source: {
      name: "NYC DEP Drinking Water FAQs (target about 0.7 mg/L); EPA, 40 CFR 141.62 (maximum 4.0 mg/L)",
      url: "https://www.nyc.gov/site/dep/water/drinking-water-frequently-asked-questions.page"
    },
    maxSource: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-141/subpart-G/section-141.62"
  }
};

/*
 * Report card colors. Our own display thresholds, not regulatory ones: the
 * share of samples within the reference value. 95% lines up with the 5%
 * coliform trigger and the 5% "undetectable chlorine" limit above.
 * E. coli is green with no detections and amber with any (never red on its
 * own: one positive sample is followed up with repeat samples).
 */
export const TILE_THRESHOLDS = { green: 0.95, amber: 0.90 };

// A month counts as complete when it has at least this share of the median
// sample count of the 12 months before it, and the data runs to its last days.
export const COMPLETE_MONTH_SHARE = 0.6;
export const COMPLETE_MONTH_DAYS_FROM_END = 3;

export const STATION_MONTHS = 12;   // "last 12 months" on the near-me page
export const NEAREST_COUNT = 3;
export const MAX_SELECTED = 3;

export const BOROUGHS = [
  { value: "BRONX", label: "Bronx", bullet: "Bx" },
  { value: "BROOKLYN", label: "Brooklyn", bullet: "B" },
  { value: "MANHATTAN", label: "Manhattan", bullet: "M" },
  { value: "QUEENS", label: "Queens", bullet: "Q" },
  { value: "STATEN ISLAND", label: "Staten Island", bullet: "SI" }
];
export const boroughLabel = (value) => BOROUGHS.find((b) => b.value === value)?.label ?? "Unknown borough";

export const LINKS = {
  annualReport: "https://www.nyc.gov/site/dep/about/drinking-water-supply-quality-report.page",
  leadKit: "https://www.nyc.gov/site/dep/water/lead-in-drinking-water-test-kit.page",
  geosearch: "https://geosearch.planninglabs.nyc/",
  boroughBoundaries: "https://data.cityofnewyork.us/d/wh2p-dxnf",
  zipAreas: "https://data.cityofnewyork.us/d/pri4-ifjk"
};
