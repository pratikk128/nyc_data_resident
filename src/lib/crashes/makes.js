/*
 * Vehicle makes: one key per make for the data's spellings and for what
 * people type. Browser-safe.
 *
 * Since 2024 the city writes a make as an NCIC code plus a body class,
 * padded to four letters: "TOYT -CAR/SUV", "BMW  -CAR/SUV",
 * "FORD-TRUCK/BUS", "YAMA -MCL". A few rows (and older ones) spell it
 * out: "FORD", "Ford", "RAM", "Moped", "ZHILO". Raw values nothing here matches get
 * key null; add them here as they turn up.
 *
 *   key     what the database stores in vehicles.make_key
 *   codes   NCIC codes the data uses
 *   names   other spellings: full names, truncations seen in the data
 */
export const MAKES = [
  { key: "ACURA", label: "Acura", codes: ["ACUR"] },
  { key: "ALFA ROMEO", label: "Alfa Romeo", codes: ["ALFA"] },
  { key: "AUDI", label: "Audi", codes: ["AUDI"] },
  { key: "BENTLEY", label: "Bentley", codes: ["BENT"] },
  { key: "BMW", label: "BMW", codes: ["BMW"] },
  { key: "BUICK", label: "Buick", codes: ["BUIC"] },
  { key: "CADILLAC", label: "Cadillac", codes: ["CADI"] },
  { key: "CHEVROLET", label: "Chevrolet", codes: ["CHEV"], names: ["CHEVY"] },
  { key: "CHRYSLER", label: "Chrysler", codes: ["CHRY"] },
  { key: "DODGE", label: "Dodge", codes: ["DODG"] },
  { key: "FERRARI", label: "Ferrari", codes: ["FERR"] },
  { key: "FIAT", label: "Fiat", codes: ["FIAT"] },
  { key: "FISKER", label: "Fisker", codes: ["FISK"] },
  { key: "FORD", label: "Ford", codes: ["FORD"] },
  { key: "GENESIS", label: "Genesis", codes: ["GENS", "GENE"] },
  { key: "GMC", label: "GMC", codes: ["GMC"] },
  { key: "HONDA", label: "Honda", codes: ["HOND"] },
  { key: "HUMMER", label: "Hummer", codes: ["HUMM"] },
  { key: "HYUNDAI", label: "Hyundai", codes: ["HYUN"] },
  { key: "INFINITI", label: "Infiniti", codes: ["INFI"] },
  { key: "JAGUAR", label: "Jaguar", codes: ["JAGU", "JAGR"] },
  { key: "JEEP", label: "Jeep", codes: ["JEEP"] },
  { key: "KIA", label: "Kia", codes: ["KIA"] },
  { key: "LAMBORGHINI", label: "Lamborghini", codes: ["LAMO", "LAMB"] },
  { key: "LAND ROVER", label: "Land Rover", codes: ["LNDR", "LAND"], names: ["RANGE ROVER"] },
  { key: "LEXUS", label: "Lexus", codes: ["LEXS"] },
  { key: "LINCOLN", label: "Lincoln", codes: ["LINC"] },
  { key: "LUCID", label: "Lucid", codes: ["LUCI", "LUCD"] },
  { key: "MASERATI", label: "Maserati", codes: ["MASE"] },
  { key: "MAZDA", label: "Mazda", codes: ["MAZD"] },
  { key: "MERCEDES-BENZ", label: "Mercedes-Benz", codes: ["MERZ"], names: ["MERCEDES", "MERCEDES BENZ", "BENZ"] },
  { key: "MERCURY", label: "Mercury", codes: ["MERC"] },
  { key: "MINI", label: "Mini", codes: ["MNNI", "MINI"], names: ["MINI COOPER"] },
  { key: "MITSUBISHI", label: "Mitsubishi", codes: ["MITS"] },
  { key: "NISSAN", label: "Nissan", codes: ["NISS"] },
  { key: "POLESTAR", label: "Polestar", codes: ["POLE", "PLSR"] },
  { key: "PONTIAC", label: "Pontiac", codes: ["PONT"] },
  { key: "PORSCHE", label: "Porsche", codes: ["PORS"] },
  { key: "RAM", label: "Ram", codes: ["RAM", "RAMB"] }, // RAMB is Rambler's code, but the data's are new pickups and vans
  { key: "RIVIAN", label: "Rivian", codes: ["RIVI", "RIVN"] },
  { key: "ROLLS-ROYCE", label: "Rolls-Royce", codes: ["ROL", "ROLS"], names: ["ROLLS ROYCE"] },
  { key: "SAAB", label: "Saab", codes: ["SAAB"] },
  { key: "SATURN", label: "Saturn", codes: ["SATR", "STRN"] },
  { key: "SCION", label: "Scion", codes: ["SCIO"] },
  { key: "SMART", label: "Smart", codes: ["SMRT", "SMAR"] },
  { key: "SUBARU", label: "Subaru", codes: ["SUBA"] },
  { key: "SUZUKI", label: "Suzuki", codes: ["SUZI", "SUZU"] },
  { key: "TESLA", label: "Tesla", codes: ["TESL", "TSMR"] },
  { key: "TOYOTA", label: "Toyota", codes: ["TOYT", "TOYO"] },
  { key: "VOLKSWAGEN", label: "Volkswagen", codes: ["VOLK"], names: ["VW"] },
  { key: "VOLVO", label: "Volvo", codes: ["VOLV"] },
  // Trucks and buses
  { key: "BLUE BIRD", label: "Blue Bird", codes: ["BLUI", "BLBI"] },
  { key: "FREIGHTLINER", label: "Freightliner", codes: ["FRHT"] },
  { key: "HINO", label: "Hino", codes: ["HINO"] },
  { key: "IC BUS", label: "IC Bus", codes: ["IC"], names: ["IC CORP"] },
  { key: "INTERNATIONAL", label: "International", codes: ["INTL"], names: ["NAVISTAR"] },
  { key: "ISUZU", label: "Isuzu", codes: ["ISU", "ISUZ"] },
  { key: "KENWORTH", label: "Kenworth", codes: ["KW", "KENW"] },
  { key: "MACK", label: "Mack", codes: ["MACK"] },
  { key: "MOTOR COACH INDUSTRIES", label: "Motor Coach Industries", codes: ["MCI", "MCIN"] },
  { key: "NEW FLYER", label: "New Flyer", codes: ["NEWF", "NFLY"], names: ["NE FL"] },
  { key: "NOVA BUS", label: "Nova Bus", codes: ["NOVA"] },
  { key: "PETERBILT", label: "Peterbilt", codes: ["PTRB", "PETE"] },
  { key: "PREVOST", label: "Prevost", codes: ["PREV"] },
  { key: "STARCRAFT", label: "Starcraft", codes: [] },
  { key: "STERLING", label: "Sterling", codes: ["STER"] },
  { key: "THOMAS BUILT", label: "Thomas Built", codes: ["THMS"], names: ["THOMAS"] },
  { key: "WESTERN STAR", label: "Western Star", codes: ["WSTR"] },
  { key: "WORKHORSE", label: "Workhorse", codes: ["WORK"] },
  // Motorcycles and scooters
  { key: "JIAJUE", label: "Jiajue", codes: [], names: ["JIAJU"] },
  { key: "HARLEY-DAVIDSON", label: "Harley-Davidson", codes: ["HD", "HARL"], names: ["HARLEY", "HARLEY DAVIDSON"] },
  { key: "KAWASAKI", label: "Kawasaki", codes: ["KAWK", "KAWA"] },
  { key: "TRIUMPH", label: "Triumph", codes: ["TRUM", "TRIU"] },
  { key: "VESPA", label: "Vespa", codes: ["VESP"] },
  { key: "YAMAHA", label: "Yamaha", codes: ["YAMA"] },
  { key: "ZHILO", label: "Zhilo", codes: [] },
  { key: "ZNEN", label: "Znen", codes: [] }
];

const letters = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const BY_CODE = new Map();
const BY_NAME = new Map();
for (const m of MAKES) {
  for (const c of m.codes) BY_CODE.set(c, m);
  for (const n of [m.key, letters(m.label), ...(m.names ?? [])]) BY_NAME.set(letters(n), m);
}

export const makeLabel = (key) => MAKES.find((m) => m.key === key)?.label ?? null;

/*
 * A raw vehicle_make → { key, class }: key null when the make isn't known
 * here, class "car" | "truck" | "motorcycle" from the code's suffix (null
 * without one).
 */
export function makeOf(raw) {
  const s = String(raw ?? "").toUpperCase().trim();
  if (!s) return { key: null, class: null };
  const coded = s.match(/^([A-Z0-9&]+)\s*-\s*(CAR\/SUV|TRUCK\/BUS|MCL)\s*$/);
  if (coded) {
    const make = BY_CODE.get(coded[1]) ?? BY_NAME.get(coded[1]);
    return { key: make?.key ?? null, class: { "CAR/SUV": "car", "TRUCK/BUS": "truck", MCL: "motorcycle" }[coded[2]] };
  }
  const name = letters(s);
  const make = BY_NAME.get(name) ?? BY_CODE.get(name) ?? uniquePrefix(name, 4);
  return { key: make?.key ?? null, class: null };
}

// The one make whose name starts with `text` (at least `min` letters), else null.
function uniquePrefix(text, min) {
  if (text.length < min) return null;
  const hits = MAKES.filter((m) => m.key.startsWith(text) || letters(m.label).startsWith(text));
  return hits.length === 1 ? hits[0] : null;
}

// Edit distance, for typos like "Toyta" or "Hundai".
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/*
 * What someone typed in the make box → { key, label, how } or null.
 *   how  "exact"  a name, code or known spelling ("Toyota", "toyt", "Chevy")
 *        "prefix" the start of one make's name ("Mercedes", "Lambo")
 *        "typo"   one or two letters off one make's name ("Toyta", "Hundai")
 */
export function resolveMake(text) {
  const t = letters(text);
  if (!t) return null;
  const exact = BY_NAME.get(t) ?? BY_CODE.get(t.replace(/ /g, ""));
  if (exact) return { key: exact.key, label: exact.label, how: "exact" };
  const prefix = uniquePrefix(t, 3);
  if (prefix) return { key: prefix.key, label: prefix.label, how: "prefix" };
  if (t.length >= 4) {
    const allowed = t.length >= 7 ? 2 : 1;
    const close = MAKES.filter((m) => [m.key, ...(m.names ?? [])].some((n) => distance(t, n) <= allowed));
    if (close.length === 1) return { key: close[0].key, label: close[0].label, how: "typo" };
  }
  return null;
}
