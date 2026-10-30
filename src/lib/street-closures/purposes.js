/*
 * What the work is, in plain English. The dataset's `purpose` is DOT's permit
 * type, cut at 40 characters ("PLACE EQUIPMENT OTHER THAN CRANE OR SHOV").
 * Each one gets a plain label for the cards and a group for the "What's the
 * work?" bars. Browser-safe.
 *
 * "-PROTECTED" (also cut to "-PROT", "-P") marks a protected street: one
 * repaved or rebuilt in the last few years, where DOT's restoration rules are
 * stricter. It's the same work, so it shares the label and group.
 */

export const GROUPS = [
  { key: "paving", label: "Repaving" },
  { key: "building", label: "Building work using the street" },
  { key: "equipment", label: "Cranes and equipment" },
  { key: "water", label: "Water and sewer" },
  { key: "gas", label: "Gas lines" },
  { key: "electric", label: "Electric, phone and cable" },
  { key: "poles", label: "Utility poles" },
  { key: "reconstruction", label: "Street reconstruction" },
  { key: "transit", label: "Subway and rail" },
  { key: "other", label: "Other work" }
];
export const groupLabel = (key) => GROUPS.find((g) => g.key === key)?.label ?? null;

// Permit type (protected suffix removed) → [group, plain label]
const PURPOSES = {
  "DOT IN-HOUSE PAVING": ["paving", "Repaving by a DOT crew"],
  "DOT IN-HOUSE MILLING": ["paving", "Grinding off old asphalt before repaving (DOT crew)"],
  "CONTRACT ROADWAY MILLING": ["paving", "Grinding off old asphalt before repaving (contractor)"],
  "PAVE STREET-W/ ENGINEERING & INSP FEE": ["paving", "Paving by a private contractor"],
  "C.A.R. RESTORATION": ["paving", "Patching the street after earlier work"],
  "OCCUPANCY OF ROADWAY AS STIPULATED": ["building", "A building project using part of the roadway"],
  "OCCUPANCY OF SIDEWALK AS STIPULATED": ["building", "A building project using the sidewalk"],
  "PLACE MATERIAL ON STREET": ["building", "Construction materials stored on the street"],
  "PLACE OPEN CONSTRUCTION DEBRIS CONTAINER": ["building", "A debris container on the street"],
  "PLACE CONSTRUCTION OFFICE TRAILER ON STR": ["building", "A construction office trailer on the street"],
  "CROSSING SIDEWALK": ["building", "Construction vehicles crossing the sidewalk"],
  "TEMPORARY PEDESTRIAN WALK": ["building", "A temporary walkway for pedestrians"],
  "OPEN SIDEWALK TO INSTALL FOUNDATION": ["building", "Sidewalk opened for a building foundation"],
  "PLACE EQUIPMENT OTHER THAN CRANE OR SHOV": ["equipment", "Construction equipment parked on the street"],
  "PLACE CRANE OR SHOVEL ON STREET": ["equipment", "A crane or excavator on the street"],
  "DEP CONTRACTOR MAJOR INSTALLATION SEWER": ["water", "New sewer lines (DEP)"],
  "DEP CONTRACTOR MAJOR INSTALLATION WATER": ["water", "New water mains (DEP)"],
  "MAJOR INSTALLATIONS - WATER": ["water", "New water lines"],
  "REPAIR WATER": ["water", "Water line repair"],
  "REPAIR WATER - SEWER": ["water", "Sewer repair"],
  "MAJOR INSTALLATION - GAS": ["gas", "New gas lines"],
  "MAJOR INSTALLATIONS - GAS": ["gas", "New gas lines"],
  "REPAIR GAS": ["gas", "Gas line repair"],
  "TRIBUTARY INSTALL - GAS": ["gas", "Gas service line to a building"],
  "CONDUIT CONSTRUCTION AND FRANCHISE": ["electric", "Underground cable conduit"],
  "MAJOR INSTALLATIONS - HIGH VOLTAGE": ["electric", "High-voltage electric lines"],
  "MAJOR INSTALL - HIGH VOLTAGE": ["electric", "High-voltage electric lines"],
  "REPAIR ELECTRIC/COMMUNICATIONS": ["electric", "Electric or communications repair"],
  "MAJOR INSTALLATION - TELEPHONE": ["electric", "New telephone lines"],
  "TRIBUTARY INSTALL - ELECTRIC": ["electric", "Electric service line to a building"],
  "CONSTRUCT OR ALTER MANHOLE &/OR CASTING": ["electric", "Manhole work"],
  "REPLACEMENT OF POLES": ["poles", "Replacing utility poles"],
  "REMOVAL OF POLES": ["poles", "Removing utility poles"],
  "RELOCATION OF POLES": ["poles", "Moving utility poles"],
  "INSTALLATION OF POLES": ["poles", "Putting up utility poles"],
  "D.D.C. CONTRACTOR MAJOR RECONSTRUCTION": ["reconstruction", "Rebuilding the street (Design and Construction dept.)"],
  "DDC CONTRACTOR MAJOR RECONSTRUCTION": ["reconstruction", "Rebuilding the street (Design and Construction dept.)"],
  "E.D.C. CONTRACTOR MAJOR RECONSTRUCTION": ["reconstruction", "Rebuilding the street (Economic Development Corp.)"],
  "RAPID TRANSIT CONSTRUCT/ ALTERATION": ["transit", "Subway or rail construction"],
  "TEMPORARY CONSTRUCTION SIGNS/MARKINGS": ["other", "Temporary construction signs or markings"],
  "CORES OR BORINGS": ["other", "Soil or pavement test drilling"],
  "TEST PITS": ["other", "Test digging to find underground lines"],
  "PLACE/REMOVE BIKE SHARE STATION ON ST": ["other", "Putting in or taking out a bike share station"],
  "INSTALL TRAFFIC SIGNALS": ["other", "Traffic signal work"]
};

// The longest cut of "-PROTECTED" that ends a purpose: " - PROTECTED", "-PROT", "-P".
const PROTECTED = /\s*-\s*P(?:R(?:O(?:T(?:E(?:C(?:T(?:E(?:D)?)?)?)?)?)?)?)?$/;

const sentence = (s) => s.charAt(0) + s.slice(1).toLowerCase();

// "MAJOR INSTALLATIONS - GAS-PROTECTED" → { group: "gas", label: "New gas lines", protected: true }
export function describePurpose(raw) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!text) return { group: "other", label: "Not stated", protected: false };
  const base = text.replace(PROTECTED, "");
  const isProtected = base !== text;
  const hit = PURPOSES[base];
  if (hit) return { group: hit[0], label: hit[1], protected: isProtected };
  return { group: "other", label: sentence(base), protected: isProtected };
}
