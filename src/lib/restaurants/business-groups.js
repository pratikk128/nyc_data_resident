/*
 * Restaurant leads by service type: which critical violations each kind of
 * service business can help fix. This is the one place the mapping lives: the
 * daily leads job, the page and scripts/audit-violation-mapping.mjs all read it.
 *
 * Codes were checked against the distinct critical violation_code /
 * violation_description pairs in dataset 43nn-pn8j for Oct 2024 – Oct 2026
 * (all on DOHMH's revised code list). A code may belong to more than one
 * group. Run `npm run audit:violations` to list any critical code that isn't
 * mapped here or in IGNORED_CODES.
 */

export const LEADS_CONFIG = {
  // Time toggle, in days counted back from the latest inspection date in the data.
  windows: [7, 30],
  defaultWindow: 7,
  // NYC re-inspects a restaurant whose initial inspection scores 14 or more (B/C range).
  reinspectionScore: 14,
  // "Hide low scores" (on by default) drops restaurants whose latest score is this or lower.
  lowScoreMax: 3,
  pageSize: 24,
  // Non-critical codes to treat as leads too (e.g. "10B" back-flow for plumbers).
  // A code listed here also has to be in a group's codes[] to show up.
  includeNonCriticalCodes: ["10D"]
};

// Critical codes deliberately left out of every group, with the reason.
const SOURCING = "Food bought from the wrong source or in bad condition; fixed by changing suppliers, not by a service.";
const HANDLING = "Everyday food handling lapse the kitchen corrects on the spot; doesn't point to any one service.";
export const IGNORED_CODES = {
  "07A": "Obstructing an inspector; no service fixes that.",
  "03A": SOURCING, "03B": SOURCING, "03C": SOURCING, "03D": SOURCING, "03F": SOURCING, "04P": SOURCING,
  "09A": HANDLING, "04H": HANDLING, "06C": HANDLING, "06E": HANDLING, "06F": HANDLING
};

// icon: inner SVG of a 24×24 stroke icon. tone: a [data-tone] color in landing.css
// (red and orange are kept for the urgency badges).
export const BUSINESS_GROUPS = [
  {
    id: "pest-control",
    label: "Pest Control",
    short: "pest",
    description: "Rats, mice, roaches, flies or other animals inside, and pesticides stored or used where they could get into food.",
    tone: "yellow",
    icon: '<ellipse cx="12" cy="13" rx="5" ry="6.5"/><path d="M12 6.5V20M9 4.5l1.5 2M15 4.5l-1.5 2M7 10H3.5M7 14H3M7.5 18L4.5 20M17 10h3.5M17 14h4M16.5 18l3 2"/>',
    codes: ["04K", "04L", "04M", "04N", "04O", "04E"]
  },
  {
    id: "refrigeration",
    label: "Refrigeration & Temperature Equipment",
    short: "refrigeration",
    description: "Cold food above 41 °F, or not enough hot or cold holding equipment.",
    tone: "blue",
    icon: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M6 9.5h12M9 5.5v2M9 12.5v3"/>',
    // Hot food below 140 °F (02B) and cooling methods (02H, 02I) are staff practice, so they're in
    // training; a shortage of hot holding equipment is still caught by 05F.
    codes: ["02G", "05F"]
  },
  {
    id: "plumbing",
    label: "Plumbing & Water Systems",
    short: "plumbing",
    description: "Sewage disposal or back-ups, missing or blocked hand-wash sinks, no toilet, or an unsafe water supply.",
    tone: "teal",
    icon: '<path d="M12 3c3.5 4.5 6 7.7 6 11a6 6 0 0 1-12 0c0-3.3 2.5-6.5 6-11z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>',
    codes: ["05A", "05D", "05E", "04F", "03E"]
  },
  {
    id: "ventilation",
    label: "Hood, Exhaust & Ventilation",
    short: "ventilation",
    description: "Harmful gas or vapor in the air, including carbon monoxide above 9 ppm, and ventilation that is missing, inadequate or in disrepair.",
    tone: "purple",
    icon: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    codes: ["05B", "10D"] // 10D (not critical) via includeNonCriticalCodes
  },
  {
    id: "cleaning",
    label: "Commercial Cleaning & Sanitation",
    short: "sanitation",
    description: "Food contact surfaces not washed, rinsed and sanitized, or food and work areas contaminated by sewage or liquid waste.",
    tone: "green",
    icon: '<path d="M14 3l-4 9M7 12h8l1.5 9h-11L7 12zM9.5 16.5v2M13 16.5v2"/>',
    codes: ["06D", "04F"]
  },
  {
    id: "training",
    label: "Food Safety Training & Compliance Consulting",
    short: "food safety",
    description: "No certified food protection supervisor, worker hygiene, cooking, hot holding and cooling temperatures, and required HACCP plans and procedures.",
    tone: "pink",
    icon: '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
    codes: [
      "04A", "04B", "04C", "04D", "06A", "06B",       // certificate holder and worker hygiene
      "02A", "02B", "02C", "02D", "02F", "02H", "02I", // cooking, reheating, hot holding, cooling
      "03G", "03I", "04I", "05H", "06G", "06H"         // procedures, labels, HACCP and SOPs
    ]
  },
  {
    id: "equipment",
    label: "Kitchen Equipment & Facility Repair",
    short: "equipment",
    description: "Food contact surfaces or equipment badly built or maintained, missing thermometers, toxic chemicals stored near food.",
    tone: "lime",
    icon: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3.5 17.5a1.4 1.4 0 0 0 2 2l5.7-5.7a4 4 0 0 0 5.3-5.3l-2.5 2.5-2-2 2.5-2.5z"/>',
    codes: ["05C", "04J", "04E"]
  }
];

const GROUPS_BY_CODE = new Map();
for (const g of BUSINESS_GROUPS) {
  for (const code of g.codes) GROUPS_BY_CODE.set(code, [...(GROUPS_BY_CODE.get(code) ?? []), g.id]);
}

// Every code in any group, sorted.
export const MAPPED_CODES = [...GROUPS_BY_CODE.keys()].sort();

// Group ids for a violation code ([] when unmapped).
export function groupsFor(code) {
  return GROUPS_BY_CODE.get(String(code ?? "").trim()) ?? [];
}

export function businessGroup(id) {
  return BUSINESS_GROUPS.find((g) => g.id === id) ?? null;
}
