/*
 * Shop Diverse NYC: dataset, labels and links shared by the server, the page
 * and the tests. The dataset is NYC Small Business Services' list of certified
 * Minority-, Women-, Emerging- and Locally-based business enterprises.
 */

export const DATASET_ID = "ci93-uc8s";
export const DATASET_NAME = "SBS Certified Business List";
export const DATASET_URL = `https://data.cityofnewyork.us/d/${DATASET_ID}`;

export const LINKS = {
  // Where to confirm a certification is current
  sbsDirectory: "https://sbsconnect.nyc.gov/certification-directory-search/",
  sbsCertification: "https://www.nyc.gov/site/sbs/businesses/certify-with-the-city.page"
};

export const PAGE_SIZE = 24;
export const MAX_KEYWORD_LENGTH = 80;

// Certification codes as the dataset spells them, with the badge tone
// ([data-tone] in landing.css) and plain-language names.
export const CERTS = {
  WBE: { label: "Women-owned", long: "Women-owned Business Enterprise", tone: "pink" },
  MBE: { label: "Minority-owned", long: "Minority-owned Business Enterprise", tone: "purple" },
  LBE: { label: "Locally based", long: "Locally-based Business Enterprise", tone: "green" },
  EBE: { label: "Emerging", long: "Emerging Business Enterprise", tone: "orange" }
};
export const CERT_ORDER = ["WBE", "MBE", "LBE", "EBE"];

// URL slug → label. "outside" covers every address outside the five boroughs.
export const BOROUGHS = [
  { slug: "manhattan", label: "Manhattan" },
  { slug: "brooklyn", label: "Brooklyn" },
  { slug: "queens", label: "Queens" },
  { slug: "bronx", label: "Bronx" },
  { slug: "staten-island", label: "Staten Island" },
  { slug: "outside", label: "Outside NYC" }
];

// Owner ethnicity labels for MBE firms, as the dataset has them (title-cased).
// "Non-minority" is left out of the filter: it describes WBE-only firms.
export const MINORITY_ETHNICITIES = ["Black", "Asian", "Hispanic", "Native American"];

export const SORTS = [
  { value: "recommended", label: "Recommended" },
  { value: "az", label: "A–Z" },
  { value: "newest", label: "Newest established" },
  { value: "oldest", label: "Longest established" }
];
