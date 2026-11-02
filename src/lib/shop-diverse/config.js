/*
 * Shop Diverse NYC: dataset, labels and links shared by the server, the page
 * and the tests. The dataset is NYC Small Business Services' list of certified
 * Minority-, Women-, Emerging- and Locally-based business enterprises. Nearly
 * all of it is professional services and construction, so the page is built
 * for contractors and agency buyers looking for certified firms to meet M/WBE
 * goals. Residents have their own page on the same list, Shop Local
 * (src/lib/shop-local/config.js).
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
// NAICS or NIGP codes per search, and businesses per shortlist or export
export const MAX_CODES = 10;
export const MAX_EXPORT = 100;

// The minimums offered for bonding limit and largest past contract: URL value
// → dollars. Both are self-reported, and only ~1,000 firms (mostly
// construction) give a bonding limit.
export const AMOUNT_TIERS = [
  { value: "100k", amount: 1e5, label: "$100K or more" },
  { value: "500k", amount: 5e5, label: "$500K or more" },
  { value: "1m", amount: 1e6, label: "$1M or more" },
  { value: "5m", amount: 5e6, label: "$5M or more" },
  { value: "10m", amount: 1e7, label: "$10M or more" },
  { value: "25m", amount: 2.5e7, label: "$25M or more" }
];

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
  { value: "oldest", label: "Longest established" },
  { value: "bonding", label: "Highest bonding limit" },
  { value: "contract", label: "Largest past contract" }
];
