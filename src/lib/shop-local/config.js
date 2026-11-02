/*
 * Shop Local: the resident side of the SBS Certified Business List (the same
 * daily vendor list as Shop Diverse, src/lib/server/shop-diverse.js). Every
 * label, category and limit lives here. Safe to import from the browser.
 *
 * Only businesses a resident would eat at, shop at or hire are shown: each
 * NAICS title (as the dataset spells it) is mapped below to a plain-language
 * label and one of nine categories. Titles not listed (construction of
 * offices, wholesalers, consulting, "All Other Personal Services", a junk
 * drawer of janitorial, security and consulting firms…) are left out.
 *
 * walk: the business has a place customers visit (a restaurant, a shop, a
 * salon), so its street address is shown with directions. For every other
 * kind (plumbers, tutors, child care, lawyers) only the neighborhood and ZIP
 * are shown: many are one-person businesses registered at a home address.
 */

export const BASE = "/shop-local/";
export const PAGE_SIZE = 24;
export const MAX_KEYWORD_LENGTH = 60;

// [title, label, walk]
const t = (title, label, walk = false) => ({ title, label, walk });

/*
 * In tile order. tone picks the tile colors ([data-tone] in landing.css);
 * icon is the inner SVG of a 24×24 stroke icon (Lucide style).
 */
export const CATEGORIES = [
  {
    key: "eat", label: "Eat & drink", tone: "orange",
    icon: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10"/><path d="M17 21V3c-2 1-3 4-3 7v3h3"/>',
    titles: [
      t("Full-Service Restaurants", "Restaurant", true),
      t("Limited-Service Restaurants", "Takeout and counter service", true),
      t("Cafeterias, Grill Buffets, and Buffets", "Buffet", true),
      t("Snack and Nonalcoholic Beverage Bars", "Café, juice or snack bar", true),
      t("Drinking Places (Alcoholic Beverages)", "Bar", true),
      t("Baked Goods Retailers", "Bakery", true),
      t("Confectionery and Nut Retailers", "Candy and nut shop", true),
      t("All Other Specialty Food Retailers", "Specialty food shop", true),
      t("Meat Retailers", "Butcher", true),
      t("Supermarkets and Other Grocery Retailers (except Convenience Retailers)", "Grocery store", true),
      t("Convenience Retailers", "Convenience store", true),
      t("Beer, Wine, and Liquor Retailers", "Wine and liquor store", true),
      t("Caterers", "Caterer"),
      t("Mobile Food Services", "Food truck or cart")
    ]
  },
  {
    key: "shop", label: "Shop", tone: "yellow",
    icon: '<path d="M5 8h14l-1 13H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    titles: [
      t("Clothing and Clothing Accessories Retailers", "Clothing store", true),
      t("Shoe Retailers", "Shoe store", true),
      t("Shoe Stores", "Shoe store", true),
      t("Jewelry Retailers", "Jewelry store", true),
      t("Luggage and Leather Goods Retailers", "Leather goods store", true),
      t("Cosmetics, Beauty Supplies, and Perfume Retailers", "Beauty supply store", true),
      t("All Other Health and Personal Care Retailers", "Health and personal care store", true),
      t("Food (Health) Supplement Retailers", "Supplement store", true),
      t("Pharmacies and Drug Retailers", "Pharmacy", true),
      t("Optical Goods Retailers", "Optical shop", true),
      t("Florists", "Florist", true),
      t("Gift, Novelty, and Souvenir Retailers", "Gift shop", true),
      t("Book Retailers and News Dealers", "Bookstore", true),
      t("Art Dealers", "Art gallery", true),
      t("Musical Instrument and Supplies Retailers", "Music store", true),
      t("Sporting Goods Retailers", "Sporting goods store", true),
      t("Sewing, Needlework, and Piece Goods Retailers", "Fabric and sewing shop", true),
      t("Pet and Pet Supplies Retailers", "Pet store", true),
      t("Furniture Retailers", "Furniture store", true),
      t("All Other Home Furnishings Retailers", "Home goods store", true),
      t("Floor Covering Retailers", "Flooring store", true),
      t("Window Treatment Retailers", "Blinds and window treatments", true),
      t("Electronics and Appliance Retailers", "Electronics and appliance store", true),
      t("Hardware Retailers", "Hardware store", true),
      t("Paint and Wallpaper Retailers", "Paint store", true),
      t("Home Centers", "Home improvement store", true),
      t("Nursery, Garden Center, and Farm Supply Retailers", "Garden center", true),
      t("Office Supplies and Stationery Retailers", "Office supply and stationery store", true),
      t("Department Stores", "Department store", true),
      t("All Other General Merchandise Retailers", "General store", true),
      t("All Other Miscellaneous Store Retailers (except Tobacco Stores)", "Specialty shop", true),
      t("All Other Miscellaneous Retailers", "Specialty shop"),
      t("Electronic Shopping and Mail-Order Houses", "Online shop")
    ]
  },
  {
    key: "beauty", label: "Beauty & self-care", tone: "pink",
    icon: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5 20 19M8.5 16.5 20 5"/>',
    titles: [
      t("Beauty Salons", "Hair or beauty salon", true),
      t("Nail Salons", "Nail salon", true),
      t("Barber Shops", "Barbershop", true),
      t("Other Personal Care Services", "Spa and personal care")
    ]
  },
  {
    key: "home", label: "Home & everyday services", tone: "teal",
    icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z"/>',
    titles: [
      t("Residential Remodelers", "Home remodeler"),
      t("Plumbing, Heating, and Air-Conditioning Contractors", "Plumbing, heating and A/C"),
      t("Electrical Contractors and Other Wiring Installation Contractors", "Electrician"),
      t("Painting and Wall Covering Contractors", "Painter"),
      t("Flooring Contractors", "Flooring installer"),
      t("Tile and Terrazzo Contractors", "Tile installer"),
      t("Finish Carpentry Contractors", "Carpenter"),
      t("Roofing Contractors", "Roofer"),
      t("Glass and Glazing Contractors", "Glass and windows"),
      t("Exterminating and Pest Control Services", "Pest control"),
      t("Locksmiths", "Locksmith"),
      t("Carpet and Upholstery Cleaning Services", "Carpet and upholstery cleaning"),
      t("Landscaping Services", "Landscaper"),
      t("Interior Design Services", "Interior designer"),
      t("Appliance Repair and Maintenance", "Appliance repair"),
      t("Electronic and Precision Equipment Repair and Maintenance", "Electronics repair"),
      t("Other Personal and Household Goods Repair and Maintenance", "Household repairs"),
      t("Reupholstery and Furniture Repair", "Furniture repair"),
      t("Used Household and Office Goods Moving", "Mover"),
      t("Fuel Dealers", "Heating oil and fuel"),
      t("Pet Care (except Veterinary) Services", "Pet care"),
      t("Drycleaning and Laundry Services (except Coin-Operated)", "Dry cleaner", true),
      t("Coin-Operated Laundries and Drycleaners", "Laundromat", true),
      t("Lessors of Miniwarehouses and Self-Storage Units", "Self-storage", true),
      t("Funeral Homes and Funeral Services", "Funeral home", true)
    ]
  },
  {
    key: "health", label: "Health & fitness", tone: "green",
    icon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    titles: [
      t("Offices of Physicians (except Mental Health Specialists)", "Doctor", true),
      t("Offices of Physicians, Mental Health Specialists", "Psychiatrist"),
      t("Offices of Dentists", "Dentist", true),
      t("Offices of Chiropractors", "Chiropractor", true),
      t("Offices of Optometrists", "Optometrist", true),
      t("Offices of Podiatrists", "Podiatrist", true),
      t("Offices of Mental Health Practitioners (except Physicians)", "Therapist or counselor"),
      t("Offices of Physical, Occupational and Speech Therapists, and Audiologists", "Physical, occupational or speech therapy"),
      t("Offices of All Other Miscellaneous Health Practitioners", "Health practitioner"),
      t("Home Health Care Services", "Home health care"),
      t("Fitness and Recreational Sports Centers", "Gym or fitness studio", true),
      t("Diet and Weight Reducing Centers", "Weight-loss program")
    ]
  },
  {
    key: "learn", label: "Kids, classes & care", tone: "lime",
    icon: '<path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
    titles: [
      t("Child Care Services", "Child care"),
      t("Child and Youth Services", "Youth program"),
      t("Exam Preparation and Tutoring", "Tutoring and test prep"),
      t("Sports and Recreation Instruction", "Sports and fitness lessons"),
      t("Fine Arts Schools", "Art, music or dance classes"),
      t("Language Schools", "Language classes"),
      t("Automobile Driving Schools", "Driving school"),
      t("Computer Training", "Computer classes"),
      t("Cosmetology and Barber Schools", "Beauty school"),
      t("All Other Miscellaneous Schools and Instruction", "Classes and lessons"),
      t("Services for the Elderly and Persons with Disabilities", "Senior and disability services")
    ]
  },
  {
    key: "fun", label: "Events, arts & fun", tone: "purple",
    icon: '<path d="M4 4h16v6a8 8 0 0 1-16 0V4z"/><path d="M8.5 9h.01M15.5 9h.01M9 14c1.5 1.3 4.5 1.3 6 0"/>',
    titles: [
      t("Independent Artists, Writers, and Performers", "Artist, writer or performer"),
      t("Musical Groups and Artists", "Musician or band"),
      t("Dance Companies", "Dance company"),
      t("Theater Companies and Dinner Theaters", "Theater company"),
      t("Other Performing Arts Companies", "Performing arts"),
      t("Photography Studios, Portrait", "Portrait photographer"),
      t("All Other Amusement and Recreation Industries", "Recreation and entertainment"),
      t("Promoters of Performing Arts, Sports, and Similar Events with Facilities", "Event venue", true),
      t("Promoters of Performing Arts, Sports, and Similar Events without Facilities", "Event promoter"),
      t("Amusement Arcades", "Arcade", true),
      t("Museums", "Museum", true),
      t("Historical Sites", "Historic site", true),
      t("Tour Operators", "Tour operator"),
      t("Scenic and Sightseeing Transportation, Land", "Sightseeing tour"),
      t("Scenic and Sightseeing Transportation, Water", "Sightseeing tour"),
      t("Scenic and Sightseeing Transportation, Other", "Sightseeing tour"),
      t("Travel Agencies", "Travel agent"),
      t("Hotels (except Casino Hotels) and Motels", "Hotel", true),
      t("All Other Traveler Accommodation", "Inn or bed and breakfast", true)
    ]
  },
  {
    key: "money", label: "Money, legal & real estate", tone: "blue",
    icon: '<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z"/>',
    titles: [
      t("Offices of Lawyers", "Lawyer"),
      t("All Other Legal Services", "Legal services"),
      t("Offices of Certified Public Accountants", "Accountant (CPA)"),
      t("Other Accounting Services", "Bookkeeping and accounting"),
      t("Tax Preparation Services", "Tax preparer"),
      t("Insurance Agencies and Brokerages", "Insurance agent"),
      t("Portfolio Management and Investment Advice", "Financial adviser"),
      t("Mortgage and Nonmortgage Loan Brokers", "Mortgage broker"),
      t("Offices of Real Estate Agents and Brokers", "Real estate agent"),
      t("Offices of Real Estate Appraisers", "Home appraiser"),
      t("Residential Property Managers", "Property manager"),
      t("Translation and Interpretation Services", "Translator or interpreter")
    ]
  },
  {
    key: "auto", label: "Cars & getting around", tone: "red",
    icon: '<path d="M5 17h14v-5l-2-5H7l-2 5v5z"/><path d="M5 12h14"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
    titles: [
      t("Taxi and Ridesharing Services", "Taxi or car service"),
      t("Limousine Service", "Limousine"),
      t("Special Needs Transportation", "Accessible rides (ambulette)"),
      t("Charter Bus Industry", "Charter bus"),
      t("Motor Vehicle Towing", "Towing"),
      t("General Automotive Repair", "Auto repair", true),
      t("Specialized Automotive Repair", "Auto repair", true),
      t("All Other Automotive Repair and Maintenance", "Auto repair", true),
      t("Automotive Body, Paint, and Interior Repair and Maintenance", "Auto body shop", true),
      t("Automotive Oil Change and Lubrication Shops", "Oil change", true),
      t("Car Washes", "Car wash", true),
      t("Tire Dealers", "Tire shop", true),
      t("New Car Dealers", "Car dealer", true),
      t("Used Car Dealers", "Car dealer", true),
      t("Parking Lots and Garages", "Parking", true),
      t("Truck, Utility Trailer, and RV (Recreational Vehicle) Rental and Leasing", "Truck and trailer rental", true)
    ]
  }
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// NAICS title → { cat, label, walk }
export const KINDS = new Map(CATEGORIES.flatMap((c) => c.titles.map((x) => [x.title, { cat: c.key, label: x.label, walk: x.walk }])));

/*
 * Who owns it, in chip order: women (a WBE certification) or an owner
 * ethnicity on an MBE certification, as SBS spells it. "Hispanic" is the
 * dataset's word, so the page uses it as written.
 */
export const OWNERS = [
  { key: "women", label: "Women-owned", tone: "pink" },
  { key: "black", label: "Black-owned", ethnicity: "Black", tone: "purple" },
  { key: "hispanic", label: "Hispanic-owned", ethnicity: "Hispanic", tone: "purple" },
  { key: "asian", label: "Asian-owned", ethnicity: "Asian", tone: "purple" },
  { key: "native", label: "Native American-owned", ethnicity: "Native American", tone: "purple" }
];
export const OWNER_KEYS = OWNERS.map((o) => o.key);

// The five boroughs, URL slug → label (the same slugs as Shop Diverse).
export const BOROUGHS = [
  { slug: "manhattan", label: "Manhattan" },
  { slug: "brooklyn", label: "Brooklyn" },
  { slug: "queens", label: "Queens" },
  { slug: "bronx", label: "Bronx" },
  { slug: "staten-island", label: "Staten Island" }
];
