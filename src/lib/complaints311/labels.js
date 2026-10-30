/*
 * Plain-language names for 311 complaint types and location types.
 *
 * complaint_type is spelled inconsistently ("HEAT/HOT WATER", "Noise -
 * Residential"), so counts are merged on typeKey() (trimmed, upper case) and
 * shown with typeLabel(). location_type has ~150 values for a handful of real
 * places ("RESIDENTIAL BUILDING", "3+ Family Apt. Building", ...), so they're
 * folded into the groups in LOCATION_GROUPS; anything else, and blanks, become
 * "Other / Not specified".
 */

export const typeKey = (raw) => String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// Keyed by typeKey(). Types not listed fall back to sentence case of the raw name.
const TYPE_LABELS = {
  "ILLEGAL PARKING": "Illegal parking",
  "NOISE - RESIDENTIAL": "Noise from homes",
  "HEAT/HOT WATER": "No heat or hot water",
  "BLOCKED DRIVEWAY": "Blocked driveway",
  "NOISE - STREET/SIDEWALK": "Noise on the street",
  "UNSANITARY CONDITION": "Unsanitary building conditions",
  "STREET CONDITION": "Street conditions (potholes and more)",
  "PLUMBING": "Plumbing problems",
  "ABANDONED VEHICLE": "Abandoned vehicles",
  "DIRTY CONDITION": "Litter and dirty conditions",
  "PAINT/PLASTER": "Peeling paint or plaster",
  "WATER SYSTEM": "Water system problems",
  "SNOW OR ICE": "Snow or ice",
  "NOISE": "Noise (other)",
  "NOISE - COMMERCIAL": "Noise from businesses",
  "TRAFFIC SIGNAL CONDITION": "Traffic signal problems",
  "DOOR/WINDOW": "Broken doors or windows",
  "NOISE - VEHICLE": "Noise from vehicles",
  "WATER LEAK": "Water leaks",
  "ENCAMPMENT": "Homeless encampments",
  "DAMAGED TREE": "Damaged trees",
  "GENERAL": "General building repairs",
  "GENERAL CONSTRUCTION/PLUMBING": "Construction or plumbing work",
  "STREET LIGHT CONDITION": "Street light problems",
  "ILLEGAL DUMPING": "Illegal dumping",
  "ELECTRIC": "Electrical problems",
  "DERELICT VEHICLES": "Derelict vehicles",
  "MISSED COLLECTION": "Missed trash or recycling pickup",
  "HOMELESS PERSON ASSISTANCE": "Help for a homeless person",
  "FLOORING/STAIRS": "Floors or stairs",
  "MAINTENANCE OR FACILITY": "Park maintenance",
  "SIDEWALK CONDITION": "Sidewalk conditions",
  "APPLIANCE": "Broken appliances",
  "RODENT": "Rodents",
  "ELEVATOR": "Elevators",
  "BUILDING/USE": "Illegal building use",
  "SEWER": "Sewer problems",
  "NON-EMERGENCY POLICE MATTER": "Non-emergency police matters",
  "OVERGROWN TREE/BRANCHES": "Overgrown trees or branches",
  "VENDOR ENFORCEMENT": "Street vendors",
  "OBSTRUCTION": "Street obstructions",
  "WATER MAINTENANCE": "Water main maintenance",
  "CONSUMER COMPLAINT": "Consumer complaints",
  "FOR HIRE VEHICLE COMPLAINT": "For-hire vehicles",
  "GRAFFITI": "Graffiti",
  "SAFETY": "Building safety",
  "LEAD": "Lead",
  "FOOD ESTABLISHMENT": "Food businesses",
  "RESIDENTIAL DISPOSAL COMPLAINT": "Trash put out wrong",
  "SEWER MAINTENANCE": "Sewer maintenance",
  "ANIMAL-ABUSE": "Animal abuse",
  "PANHANDLING": "Panhandling",
  "DEAD/DYING TREE": "Dead or dying trees",
  "NOISE - HELICOPTER": "Helicopter noise",
  "DEAD ANIMAL": "Dead animals",
  "TRAFFIC": "Traffic",
  "ILLEGAL FIREWORKS": "Illegal fireworks",
  "INDOOR AIR QUALITY": "Indoor air quality",
  "TAXI COMPLAINT": "Taxis",
  "ROOT/SEWER/SIDEWALK CONDITION": "Tree roots and sidewalks",
  "AIR QUALITY": "Air quality",
  "DRUG ACTIVITY": "Drug activity",
  "CURB CONDITION": "Curb conditions",
  "STREET SWEEPING COMPLAINT": "Street sweeping",
  "SMOKING OR VAPING": "Smoking or vaping",
  "NOISE - PARK": "Noise in parks",
  "ILLEGAL TREE DAMAGE": "Illegal tree damage",
  "LOST PROPERTY": "Lost property",
  "HIGHWAY CONDITION": "Highway conditions",
  "WATER CONSERVATION": "Water waste",
  "ABANDONED BIKE": "Abandoned bikes",
  "NOISE - HOUSE OF WORSHIP": "Noise from houses of worship",
  "ELECTRICAL": "Electrical problems",
  "OUTSIDE BUILDING": "Building exteriors",
  "HPD LITERATURE REQUEST": "Housing information requests",
  "MOLD": "Mold",
  "HEATING": "No heat",
  "BUS STOP SHELTER COMPLAINT": "Bus stop shelters",
  "LITTER BASKET REQUEST": "Litter basket requests",
  "LITTER BASKET COMPLAINT": "Litter baskets",
  "ANIMAL IN A PARK": "Animals in parks",
  "URINATING IN PUBLIC": "Urinating in public",
  "DRINKING": "Public drinking",
  "BIKE/ROLLER/SKATE CHRONIC": "Bikes and scooters on sidewalks",
  "BIKE/ROLLER/SKATE": "Bikes, scooters and skaters",
  "LINKNYC": "LinkNYC kiosks",
  "TAXI REPORT": "Taxi reports",
  "FOR HIRE VEHICLE REPORT": "For-hire vehicle reports",
  "FOUND PROPERTY": "Found property",
  "MOBILE FOOD VENDOR": "Mobile food vendors",
  "NON-RESIDENTIAL HEAT": "No heat in a non-residential building",
  "CONSTRUCTION SAFETY ENFORCEMENT": "Construction safety",
  "SPECIAL PROJECTS INSPECTION TEAM (SPIT)": "Special building inspections",
  "EMERGENCY RESPONSE TEAM (ERT)": "Emergency building inspections"
};

function sentenceCase(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : "Not specified";
}

export function typeLabel(rawOrKey) {
  return TYPE_LABELS[typeKey(rawOrKey)] ?? sentenceCase(rawOrKey);
}

// ---------- Location types ----------

export const OTHER_LOCATION = "Other / Not specified";

// Order matters: the first group whose test matches wins.
export const LOCATION_GROUPS = [
  { key: "Residential building", test: /resid|family|dwelling|apartment|apt\b|apt\.|\bhouse\b|hallway|lobby|stairwell|common area|roof|basement|^residence$/i },
  { key: "Street or sidewalk", test: /street|sidewalk|curb|gutter|alley|crosswalk|intersection|vehicle lane|median|traffic island|above address|highway|bridge|parking lot/i },
  { key: "Store or business", test: /store|commercial|comercial|business|retail|office|non-residential|warehouse|tattoo|barber|salon|spa|nail|beauty|cinema|theat|mixed use/i },
  { key: "Restaurant, bar or food vendor", test: /restaurant|\bbars?\b|club|deli|bakery|food|vendor|cafe|café/i },
  { key: "Park or playground", test: /park|playground|beach|garden/i },
  { key: "Subway, bus, taxi or ferry", test: /subway|bus|taxi|ferry|train|station|airport|terminal/i },
  { key: "Sewer or catch basin", test: /sewer|catch basin/i },
  { key: "School", test: /school|college|universit/i }
];

const NOT_SPECIFIED = /^(n\/a|na|none|unknown|other.*|)$/i;
// Checked before the groups: these contain a word another group keys on.
const OVERRIDES = [
  { test: /non-residential/i, key: "Store or business" },
  { test: /worship/i, key: OTHER_LOCATION },
  { test: /club ?house/i, key: OTHER_LOCATION }
];

// "RESIDENTIAL BUILDING" → "Residential building"; blanks and oddballs → "Other / Not specified".
export function locationGroup(raw) {
  const value = String(raw ?? "").trim();
  if (NOT_SPECIFIED.test(value)) return OTHER_LOCATION;
  const match = OVERRIDES.find((g) => g.test.test(value)) ?? LOCATION_GROUPS.find((g) => g.test.test(value));
  return match?.key ?? OTHER_LOCATION;
}

/*
 * What the city did, from resolution_description: agencies write long boilerplate
 * ("The New York City Police Department responded to the complaint and ..."), so each
 * note is sorted into one of three outcomes by the phrases below:
 *   acted    fixed, cleaned, repaired, or a summons or violation issued
 *   none     the agency found no problem or no violation, or said no action was needed
 *   unclear  everything else: no note, a duplicate, couldn't get in, referred elsewhere
 * The checks run in order and the first match wins, since some notes use both kinds of words
 * ("didn't observe a violation ... couldn't issue a summons").
 */
export const OUTCOMES = [
  { key: "acted", label: "Fixed or ticketed" },
  { key: "none", label: "Nothing found or no action" },
  { key: "unclear", label: "No clear answer" }
];

const OUTCOME_TESTS = [
  ["none", /\bno violations? (was|were) issued|couldn't issue|could not issue/i],
  ["acted", /without the need to issue/i], // NYPD: "no criminal violation existed. The condition was corrected without ..."
  ["unclear", /(unable|not able) to (gain|get) (access|entry)|could not gain access|unable to complete the inspection/i],
  ["acted", /\bissued (a |an )?(summons|notice of violation|corrective action|office of administrative)|\bpolice issued\b|\bviolations? (was|were) issued\b|\bpled guilty\b|\bhearing was scheduled\b/i],
  ["acted", /\b(repaired|cleaned|collected|removed|towed|shut)\b|\bconditions? (was|were) corrected\b|\bhad been restored\b|\btook action\b|\bwork necessary to correct\b|\baccepted assistance\b|\bmailed you\b/i],
  ["none", /\bno (evidence|criminal violation|violations?|encampment|condition)\b|\bnot necessary\b|\bno further action\b|\bcould(n't| not) find\b|\bdid not violate\b|\bdid(n't| not) observe\b|\bmeets its standards\b|\btemporary condition\b|\bdid not accept\b|\bdoesn't meet\b|\bnot to be meeting\b|\b(could not|unable to) locate\b/i]
];

export function outcomeKey(resolution) {
  const text = String(resolution ?? "");
  return OUTCOME_TESTS.find(([, test]) => test.test(text))?.[0] ?? "unclear";
}
