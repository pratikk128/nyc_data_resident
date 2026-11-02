/*
 * Vehicle types: the data's vehicle_type (free text on the police form:
 * "Sedan", "4 dr sedan", "Station Wagon/Sport Utility Vehicle", "PK",
 * "subn", "AMBULANCE", "E-Bike") grouped into the kinds people search by.
 * Browser-safe. The ingest lists the most common raw values nothing here
 * matches (npm run data:crashes).
 *
 * Rules are tried in order; the first whose pattern matches the upper-cased
 * value wins, so the specific ones (E-BIKE) come before the general (BIKE).
 */
export const VEHICLE_TYPES = [
  { key: "e-bike", label: "E-bike", pattern: /^E[- ]?BIKE|ELECTRIC BI|PEDAL ASSIST|^EBIKE/ },
  { key: "e-scooter", label: "E-scooter", pattern: /^E[- ]?SCOOT|ELECTRIC SCOOT|^ESCOOT|STAND ?UP SCOOT|STANDING SCOOT/ },
  { key: "bike", label: "Bicycle", pattern: /^(BIKE|BICYCLE|BICY|BIC|PEDAL|CITI ?BIKE)/ },
  { key: "moped", label: "Moped or motor scooter", pattern: /MOPED|MOTOR ?SCOOT|MINIBIKE|MINI BIKE|^SCOOTER|^SCOOT|^GAS SCOOT/ },
  { key: "motorcycle", label: "Motorcycle", pattern: /MOTORCYCLE|MOTORBIKE|DIRT ?BIKE|^MC$|^MOTOR ?CYC/ },
  { key: "emergency", label: "Ambulance, fire truck or police", pattern: /AMBUL|AMBU|FIRE|FDNY|POLICE|NYPD|EMS\b|FIRETRUCK/ },
  { key: "taxi", label: "Taxi, livery or limo", pattern: /TAXI|CAB\b|LIVERY|LIMO|FOR HIRE|^FHV/ },
  { key: "bus", label: "Bus", pattern: /\bBUS\b|^BUS|SCHOOL ?BUS|OMNIBUS|MTA/ },
  { key: "pickup", label: "Pickup truck", pattern: /PICK[- ]?UP|^PK$|^PICK/ },
  { key: "van", label: "Van", pattern: /^VAN|MINIVAN|CARGO VAN|PASSENGER VAN|\bVAN$/ },
  // Before trucks: "Station Wagon/Sport Utility Vehicle" isn't a utility truck,
  // and the data's bare "Utility" and "Utility Task Vehicle" are nearly all cars' makes.
  { key: "suv", label: "SUV or station wagon", pattern: /SPORT UTILITY|STATION WAGON|^SUV|^SUBN|SUBURBAN|CROSSOVER|WAGON|^UTILITY( TASK VEHICLE)?$/ },
  { key: "truck", label: "Truck (box, tractor-trailer, dump, delivery…)",
    pattern: /TRUCK|TRACTOR|DUMP|FLAT ?BED|FLAT RACK|GARBAGE|REFUSE|TOW|WRECKER|TANKER|CONCRETE|MIXER|CARRY ?ALL|CHASSIS|STAKE|LIFT BOOM|TRAILER|SEMI|DELIV|ARMORED|BEVERAGE|REFRIG|SANITATION|DSNY|BOX|SNOW ?PLOW|SWEEPER/ },
  { key: "sedan", label: "Car (sedan, coupe, hatchback…)", pattern: /SEDAN|^\d ?DR|DOOR|CONVERTIBLE|COUPE|HATCH|PASSENGER VEH|^CAR$|^UNKNOWN CAR$|^AUTO/ }
];

/*
 * A raw vehicle_type → one of VEHICLE_TYPES' keys, or null when it's blank,
 * "Unknown" or something no rule knows.
 */
export function vehicleTypeKey(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!s || /^(UNKNOWN|UNK|OTHER|N\/A|NA|-+)$/.test(s)) return null;
  return VEHICLE_TYPES.find((t) => t.pattern.test(s))?.key ?? null;
}

export const vehicleTypeLabel = (key) => VEHICLE_TYPES.find((t) => t.key === key)?.label ?? null;

// The form sends a key; free text ("suv", "e bike") goes through the same rules.
export function resolveVehicleType(text) {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  return VEHICLE_TYPES.find((v) => v.key === t)?.key ?? vehicleTypeKey(text);
}
