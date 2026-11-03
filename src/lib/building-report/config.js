/*
 * The Building Report Card (/building-report/?bbl=…): one tax lot, its track
 * record from twelve HPD and DOB datasets. Every dataset, the section it
 * feeds and how it's keyed, the parts the report is split into, plus the
 * labels the sections use. Pure and browser-safe.
 *
 * Keys differ by dataset (checked against each dataset's columns):
 *   bbl as text ('2031070036'): violations, bedbugs, litigation, OMO, HWO
 *   bbl as a number (2031070036): complaints, vacate orders, AEP
 *   boroid + block + lot (numbers): registrations (no bbl column)
 *   registrationid: registration contacts
 *   bin (text): DOB complaints and ECB violations, one building each, so a
 *     lot with several buildings asks for all of its BINs
 */
export const DOMAIN = "https://data.cityofnewyork.us";
export const datasetUrl = (id) => `${DOMAIN}/d/${id}`;

// Each section's datasets. cadence: "Update Frequency" on the dataset's page (etl/cadence.js).
export const DATASETS = {
  violations:    { id: "wvxf-dwi5", name: "Housing Maintenance Code Violations", cadence: "daily" },
  complaints:    { id: "ygpa-z7cr", name: "Housing Maintenance Code Complaints and Problems", cadence: "daily" },
  bedbugs:       { id: "wz6d-d3jb", name: "Bedbug Reporting", cadence: "monthly" },
  vacate:        { id: "tb8q-a3ar", name: "Order to Repair/Vacate Orders", cadence: "daily" },
  aep:           { id: "hcir-3275", name: "Buildings Selected for the Alternative Enforcement Program (AEP)", cadence: "monthly" },
  litigation:    { id: "59kj-x8nc", name: "Housing Litigations", cadence: "monthly" },
  registrations: { id: "tesw-yqqr", name: "Multiple Dwelling Registrations", cadence: "monthly" },
  contacts:      { id: "feu5-w2e2", name: "Registration Contacts", cadence: "monthly" },
  dobComplaints: { id: "eabe-havv", name: "DOB Complaints Received", cadence: "daily" },
  ecb:           { id: "6bgk-3dad", name: "DOB ECB Violations", cadence: "daily" },
  omo:           { id: "mdbu-nrqn", name: "Open Market Order (OMO) Charges", cadence: "daily" },
  hwo:           { id: "sbnd-xujn", name: "Handyman Work Order (HWO) Charges", cadence: "daily" }
};

// The lot itself, for the header (not shown as sections).
export const LOT_DATASETS = {
  pluto:      { id: "64uk-42ks", name: "Primary Land Use Tax Lot Output (PLUTO)" },
  footprints: { id: "5zhs-2jue", name: "Building Footprints" },
  hpdBuildings: { id: "kj4p-ruqc", name: "Buildings Subject to HPD Jurisdiction" }
};

/*
 * Sections. datasets: the keys above whose "last updated" the section shows.
 * hpd: an HPD section, which says "No HPD records" for a lot HPD has never
 * dealt with instead of showing zeros. Titles are plain words: readers
 * needn't know which agency keeps what (each section's intro says).
 */
export const SECTIONS = [
  { key: "flags",      title: "Serious warnings",               datasets: ["vacate", "aep", "litigation"], hpd: true },
  { key: "violations", title: "Open repair orders",             datasets: ["violations"], hpd: true },
  { key: "complaints", title: "Tenant complaints",              datasets: ["complaints"], hpd: true },
  { key: "repairs",    title: "Emergency repairs by the city",  datasets: ["omo", "hwo"], hpd: true },
  { key: "bedbugs",    title: "Bedbugs",                        datasets: ["bedbugs"], hpd: true },
  { key: "hygiene",    title: "Mice, roaches, mold and garbage", datasets: ["violations", "complaints"], hpd: true },
  { key: "dob",        title: "Building safety",                datasets: ["dobComplaints", "ecb"], hpd: false },
  { key: "court",      title: "Housing Court cases",            datasets: ["litigation"], hpd: true },
  { key: "landlord",   title: "Who owns it",                    datasets: ["registrations", "contacts"], hpd: true }
];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);

/*
 * The report's parts, one page each (DESIGN.md §6.3): the overview (key
 * takeaways from every section) and one page per topic. path: after
 * /building-report/. sections: the sections the part shows in full.
 * "all" isn't a card: the overview links to it for readers who want every
 * section on one page.
 */
export const PARTS = [
  {
    id: "overview", path: "", label: "Key takeaways",
    blurb: "The short version: what stands out, in one screen.",
    sections: []
  },
  {
    id: "repairs", path: "repairs/", label: "Repairs & complaints",
    blurb: "What inspectors ordered fixed, what tenants reported, and when the city stepped in.",
    sections: ["violations", "complaints", "repairs"]
  },
  {
    id: "pests", path: "pests/", label: "Pests & cleanliness",
    blurb: "Bedbugs, mice, roaches, mold and garbage.",
    sections: ["bedbugs", "hygiene"]
  },
  {
    id: "legal", path: "legal/", label: "Safety, court & owner",
    blurb: "Vacate orders, building safety, court cases and who owns it.",
    sections: ["flags", "dob", "court", "landlord"]
  }
];
export const ALL_PART = { id: "all", path: "all/", label: "Everything", sections: SECTION_KEYS };
export const partById = (id) => [...PARTS, ALL_PART].find((p) => p.id === id) ?? null;

export const BUILDING_TTL = 3600;
export const SECTION_TTL = 3600;

// "2031070036": borough digit, 5-digit block, 4-digit lot. Block and lot start at 1
// (all zeros is a placeholder in some datasets).
export const isBbl = (value) => /^[1-5](?!00000)\d{5}(?!0000)\d{4}$/.test(String(value ?? ""));
// Why ?bbl= isn't a BBL, for the API's 400. null when it is one.
export function bblProblem(value) {
  const v = String(value ?? "");
  if (!v) return "Pick a building: ?bbl= takes a 10-digit BBL.";
  if (!/^\d{10}$/.test(v)) return "?bbl= takes a 10-digit BBL (borough digit, 5-digit block, 4-digit lot).";
  if (!/^[1-5]/.test(v)) return "The BBL's first digit is the borough and has to be 1–5.";
  if (v.slice(1, 6) === "00000") return "The BBL's block (digits 2–6) can't be 00000.";
  if (v.slice(6) === "0000") return "The BBL's lot (the last 4 digits) can't be 0000.";
  return null;
}
export const bblParts = (bbl) => ({ boro: Number(bbl[0]), block: Number(bbl.slice(1, 6)), lot: Number(bbl.slice(6)) });

export const BOROUGH_NAMES = { 1: "Manhattan", 2: "Bronx", 3: "Brooklyn", 4: "Queens", 5: "Staten Island" };

// A building's page, for the URL: its overview, or one part (PARTS id).
export const buildingPath = (bbl, part = "overview") =>
  `/building-report/${partById(part)?.path ?? ""}?bbl=${bbl}`;

// ---------- Labels ----------

// HPD violation classes (HPD's own definitions, shortened), with a plain name first.
export const CLASSES = [
  { key: "C", label: "Urgent", code: "Class C", short: "Owner has 24 hours", text: "Immediately hazardous, like no heat, a gas leak or lead paint: the owner usually has 24 hours to fix it." },
  { key: "B", label: "Serious", code: "Class B", short: "Owner has 30 days", text: "Hazardous, like a broken lock or a leak: the owner has 30 days to fix it." },
  { key: "A", label: "Minor", code: "Class A", short: "Owner has 90 days", text: "Non-hazardous, like peeling paint in a closet: the owner has 90 days to fix it." },
  { key: "I", label: "City notice", code: "Class I", short: "Not a repair", text: "An order from HPD rather than a repair, like a vacate order or a notice that the building is on the city’s watch list (AEP)." }
];

// Registration contact roles, owners first. Names only: the page never shows contacts' addresses.
export const CONTACT_ROLES = [
  { type: "CorporateOwner", label: "Owner (company)" },
  { type: "IndividualOwner", label: "Owner" },
  { type: "JointOwner", label: "Joint owner" },
  { type: "HeadOfficer", label: "Head officer" },
  { type: "Officer", label: "Officer" },
  { type: "Shareholder", label: "Shareholder" },
  { type: "Lessee", label: "Lessee" },
  { type: "Agent", label: "Managing agent" },
  { type: "SiteManager", label: "Site manager" }
];

// HPD complaint major_category values, in plain words.
export const COMPLAINT_CATEGORIES = {
  "HEAT/HOT WATER": "Heat or hot water",
  "UNSANITARY CONDITION": "Unsanitary conditions (pests, mold, garbage)",
  "PLUMBING": "Plumbing",
  "PAINT/PLASTER": "Paint or plaster",
  "DOOR/WINDOW": "Doors or windows",
  "WATER LEAK": "Water leaks",
  "GENERAL": "General",
  "ELECTRIC": "Electrical",
  "FLOORING/STAIRS": "Floors or stairs",
  "APPLIANCE": "Appliances",
  "SAFETY": "Safety (smoke detectors, window guards and more)",
  "ELEVATOR": "Elevator",
  "OUTSIDE BUILDING": "Outside the building",
  "LINE OF TRAVEL": "Line of travel (hallways, exits)"
};

/*
 * DOB complaint category codes → plain English, transcribed from DOB's
 * "Complaint Categories" list (Rev. 9/21, nyc.gov/assets/buildings/pdf/complaint_category.pdf;
 * the dataset's own attachment is an older Rev. 12/18). The data pads
 * numbers to two digits ("05"). Codes not on the list show as "Other DOB complaint (code 7R)".
 */
export const DOB_CATEGORIES = {
  "01": "Accident: construction or plumbing",
  "02": "Accident: to the public",
  "03": "Adjacent buildings not protected",
  "04": "Illegal after-hours work",
  "05": "Work without a permit",
  "06": "Construction changing the grade or watercourse",
  "07": "Construction changing the watercourse",
  "08": "No contractor’s sign",
  "09": "Excessive debris",
  "10": "Debris or building falling, or in danger of falling",
  "11": "Demolition without a permit",
  "12": "Unsafe or illegal demolition",
  "13": "Elevator not ready for FDNY use",
  "14": "Excavation undermining an adjacent building",
  "15": "Fence missing, inadequate or illegal",
  "16": "Inadequate support or shoring",
  "17": "Material or personnel hoist without a permit",
  "18": "Unsafe material storage",
  "19": "Illegal mechanical demolition",
  "1A": "Illegal conversion of commercial space to apartments",
  "1B": "Illegal tree removal or grade change (Special Natural Area District)",
  "1C": "Damage assessment (disaster)",
  "1D": "Con Edison referral",
  "1E": "Suspended (hanging) scaffold: no permit, dangerous or accident",
  "1F": "Missed annual crane inspection",
  "1G": "Stalled construction site",
  "1H": "Emergency asbestos response",
  "1J": "Gas piping removed without a permit (jewelry or dentistry torch)",
  "1K": "Bowstring truss tracking",
  "1L": "Gas utility referral",
  "1U": "Special operations compliance inspection",
  "1V": "Electrical enforcement work order (DOB)",
  "1W": "Plumbing enforcement work order (DOB)",
  "1X": "Construction enforcement work order (DOB)",
  "1Y": "Enforcement work order (DOB)",
  "1Z": "Enforcement work order (DOB)",
  "20": "Illegal work on a landmark building",
  "21": "Safety net or guard rail damaged or missing (over 6 stories)",
  "22": "No safety netting",
  "23": "Sidewalk shed or scaffold inadequate, defective or without a permit",
  "24": "No sidewalk shed",
  "25": "No warning signs or lights",
  "26": "No watchman",
  "27": "Illegal auto repair",
  "28": "Building in danger of collapse",
  "29": "Building vacant, open and unguarded",
  "2A": "Posted notice or order removed or tampered with",
  "2B": "Vacate order not obeyed",
  "2C": "Smoking on a construction site",
  "2D": "No “No smoking” signs on a construction site",
  "2E": "Full demolition notification",
  "2F": "Building under structural monitoring",
  "2G": "Illegal advertising sign or billboard",
  "2H": "Second Avenue Subway construction",
  "2J": "Building destroyed (Sandy)",
  "2K": "Structurally compromised building",
  "2L": "Unsafe façade notification",
  "2M": "Monopole tracking",
  "2N": "COVID-19 executive order",
  "2P": "Façade compliance inspection",
  "30": "Building shaking or vibrating, structural stability affected",
  "31": "No certificate of occupancy, or use contrary to it",
  "32": "Certificate of occupancy not complied with",
  "33": "Illegal commercial use",
  "34": "Illegal compactor room or refuse chute",
  "35": "Illegal curb cut, driveway or carport",
  "36": "Illegal driveway or carport",
  "37": "Exit locked, blocked or missing",
  "38": "Exit door not proper",
  "39": "No second way out",
  "3A": "Unlicensed or illegal electrical work in progress",
  "3B": "Routine inspection",
  "3C": "Plan compliance inspection",
  "3D": "Bicycle access waiver request (elevator safety)",
  "3E": "Bicycle access waiver request (alternate parking)",
  "3G": "Restroom not complying with Local Law 79/16",
  "3H": "City Planning or BSA compliance inspection",
  "40": "Part of the building falling",
  "41": "Part of the building in danger of falling",
  "42": "Illegal fence",
  "43": "Structural stability affected",
  "44": "Illegal fireplace or wood stove",
  "45": "Illegal conversion",
  "46": "Place of assembly without a permit",
  "47": "Place of assembly permit not complied with",
  "48": "Illegal residential use",
  "49": "Illegal storefront sign, awning or canopy",
  "4A": "Illegal hotel rooms in a residential building",
  "4B": "Professional certification audit",
  "4E": "Stalled site tracking",
  "4G": "Illegal conversion: no-access follow-up",
  "4H": "V.E.S.T. program (DOB and NYPD)",
  "4J": "M.A.R.C.H. program (multi-agency)",
  "4K": "Construction safety tracking (demolition)",
  "4L": "Construction safety tracking (high-rise)",
  "4M": "Construction safety tracking (low-rise)",
  "4N": "Retaining wall tracking",
  "4P": "Legal or padlock tracking",
  "4S": "Sustainability enforcement work order",
  "4W": "Woodside settlement project",
  "4X": "After-hours work with a permit",
  "50": "Sign falling, or illegal sign going up",
  "51": "Illegal social club",
  "52": "Inadequate sprinkler system",
  "53": "Illegal or improper vent or exhaust",
  "54": "Wall or retaining wall bulging or cracked",
  "55": "Zoning: non-conforming use",
  "56": "Boiler fumes, smoke or carbon monoxide",
  "57": "Illegal boiler",
  "58": "Boiler defective, not working or without a permit",
  "59": "Defective or exposed electrical wiring",
  "5A": "Joint FDNY and DOB inspection request",
  "5B": "Lightweight materials not complying",
  "5C": "Structural stability affected by new construction",
  "5D": "Vertical enlargement not complying",
  "5E": "Amusement ride accident",
  "5F": "Compliance inspection",
  "5G": "Unlicensed or illegal work in progress",
  "5H": "Illegal activity",
  "5J": "Multi-agency joint inspection",
  "60": "Improper electrical work",
  "61": "Unlicensed electrical work in progress",
  "62": "Elevator danger: open or unguarded shaft",
  "63": "Elevator defective or not working",
  "64": "Elevator shaft open and unguarded",
  "65": "Illegal or defective gas hookup or piping",
  "66": "Plumbing work without a permit",
  "67": "Crane without a permit, or unsafe",
  "68": "Unsafe crane or scaffold operation",
  "69": "Unsafe crane or scaffold installation",
  "6A": "Vesting inspection",
  "6B": "Homeless shelter inspection: plumbing",
  "6C": "Homeless shelter inspection: construction",
  "6D": "Homeless shelter inspection: electrical",
  "6M": "Elevator: several on the property",
  "6S": "Elevator: the only one, no other service",
  "6V": "Tenant safety inspection",
  "6W": "Tenant safety notice not posted or given out",
  "6X": "Work-without-permit watch list compliance",
  "6Y": "Local law audit",
  "6Z": "Training compliance",
  "70": "Suspension scaffold hanging with no work going on",
  "71": "Illegal work or change of use in an SRO",
  "72": "Change of occupancy or use in an SRO",
  "73": "Failure to maintain the building",
  "74": "Illegal commercial or manufacturing use in a residential zone",
  "75": "Adult establishment",
  "76": "Unlicensed or illegal plumbing work in progress",
  "77": "Not accessible (Local Law 58/87)",
  "78": "Privately owned public space not complying",
  "79": "Parking lot lights shining on the building",
  "7A": "Integrity complaint referral",
  "7B": "Illegal commercial or manufacturing use in a C1 or C2 zone",
  "7F": "Construction safety: tracking compliance",
  "7G": "Construction safety: sweep",
  "7J": "Work without a permit in an occupied apartment building",
  "7K": "Local Law 188/17 inspection (active jobs)",
  "7L": "Health Department referral: tenant protection",
  "7N": "Privately owned public space inspection",
  "80": "Elevator not inspected, illegal or without a permit",
  "81": "Elevator accident",
  "82": "Boiler accident or explosion",
  "83": "Construction beyond the approved plans or permits",
  "84": "Defective or cracking façade",
  "85": "Improper drainage",
  "86": "Work despite a stop work order",
  "87": "Deck safety inspection request",
  "88": "Safety net or guard rail damaged or missing (6 stories or less)",
  "89": "Crane, derrick or suspension accident",
  "8A": "Construction safety compliance action",
  "90": "Unlicensed or illegal activity",
  "91": "Site conditions endangering workers",
  "92": "Illegal conversion of manufacturing space",
  "93": "Retaining wall safety inspection request",
  "94": "Plumbing defective, leaking or not maintained",
  "95": "Bronx second-offense pilot",
  "96": "Unlicensed boiler, electrical, plumbing or sign work completed",
  "97": "Another agency’s jurisdiction",
  "98": "Referred to operations",
  "99": "Other"
};

export function dobCategoryLabel(code) {
  const key = String(code ?? "").trim().toUpperCase().padStart(2, "0");
  return DOB_CATEGORIES[key] ?? `Other DOB complaint (code ${key})`;
}

/*
 * Pests, mold and garbage. Complaints: HPD's minor_category, and for pests
 * its problem_code. Violations have no category, so they're sorted by their
 * text ("ABATE THE INFESTATION CONSISTING OF ROACHES …", "… VISIBLE MOLD
 * CONDITION …", "… RECEPTACLES FOR THE DEPOSIT OF GARBAGE …"), first match wins.
 */
export const HYGIENE_COMPLAINTS = ["PESTS", "MOLD", "GARBAGE/RECYCLING STORAGE", "SEWAGE"];
export const HYGIENE_KINDS = [
  { key: "bedbugs", label: "Bedbugs", test: /BED ?BUGS?/ },
  { key: "rodents", label: "Mice or rats", test: /\b(MICE|MOUSE|RATS?|RODENTS?)\b/ },
  { key: "roaches", label: "Roaches", test: /ROACH/ },
  { key: "pests", label: "Other pests", test: /INFEST|VERMIN|INSECT|\bFLIES\b|\bPESTS?\b|TERMITE|FLEAS/ },
  { key: "mold", label: "Mold", test: /\bMOLD\b/ },
  { key: "garbage", label: "Garbage", test: /GARBAGE|RUBBISH/ }
];
// What the violations query looks for (soql.js); HYGIENE_KINDS sorts what comes back.
export const HYGIENE_WORDS = ["INFEST", "BED BUG", "MICE", "RODENT", "RATS", "ROACH", "VERMIN", "MOLD", "GARBAGE", "RUBBISH"];
export const HYGIENE_COMPLAINT_LABELS = {
  "MICE": "Mice", "ROACHES": "Roaches", "BED BUGS": "Bedbugs", "FLIES": "Flies", "TERMITES": "Termites", "FLEAS": "Fleas",
  "MOLD": "Mold", "GARBAGE/RECYCLING STORAGE": "Garbage or recycling storage", "SEWAGE": "Sewage"
};

// OMO and HWO status reasons that mean the city's contractor did the work.
export const WORK_DONE = ["OMO Completed", "Work Partially Completed"];
