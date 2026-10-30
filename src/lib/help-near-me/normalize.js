/*
 * Turning each directory's rows into one shape of help site. Pure and
 * browser-safe, so the tests run it on real sample rows; the ETL job
 * (src/lib/server/help-near-me.js) fetches the rows and geocodes sites that
 * come out with no lat/lon.
 *
 *   { id, category, name, address, borough, zip, lat, lon, phone, hours,
 *     services[], provider, note, closed, sourceDatasetId, sourceUpdatedAt }
 *
 * phone is { display, tel } or null; hours is display text or null. Missing
 * values stay null (the page says "Call ahead / hours not listed"); nothing
 * is filled in. Each directory's columns differ (checked Oct 2026):
 *
 *   SNAP centers (tc6u-8rnp)     facility_name, street_address, comments = hours, no phone
 *   Homebase (ntcm-2w4k)         homebase_office (the provider), phone_number,
 *                                service_area_zip_code, no hours; borough "STATEN IS"
 *   Drop-in centers (bmxf-3rd4)  center_name, address (sometimes "…; Bronx, NY 10474"), comments = hours, no phone
 *   Computer centers (sejx-2gn3) one row per site per calendar_year; mon_open…sun_open as
 *                                "10am - 6pm", "8:00 AM - 4:00 PM", "Closed - Closed"; Y/N service flags
 *   DYCD sites (ebkm-iyma)       one row per program per site per fiscal year (date); no phone or hours
 *   NYC Aging (cqc8-am9x)        every contract, walk-in or not (providertype); hours as
 *                                12-hour "09:00"/"05:00" with no AM/PM, "00:00"/"00:00" closed
 *   NYCHA (crns-fw6u)            every community space, vacant or not, many free-text
 *                                program_type values including NYCHA's own offices and storage
 */
import { CATEGORIES, categoryByDataset } from "./config.js";
import { inNyc, isNycZip } from "../complaints311/location-input.js";

// ---------- Small cleaners ----------

// "14thÂ Street" (a no-break space read as Latin-1, as in one drop-in center's address) → "14th Street"
const clean = (s) => String(s ?? "").replace(/Â(?=[\s\u00a0])/g, "").replace(/\s+/g, " ").trim();
const blank = (s) => clean(s) || null;

// All-caps text ("RISEBORO COMMUNITY PARTNERSHIP INC") → "Riseboro Community Partnership Inc",
// "PS 123" and "McDonald" kept;
// mixed case is left as written.
export function tidy(s) {
  const t = clean(s);
  if (!t || /[a-z]/.test(t) || !/[A-Z]{3}/.test(t)) return t || null;
  return t.toLowerCase().replace(/(^|[\s\-/(&])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, n, s2) => n + s2.toLowerCase())
    .replace(/\b(Norc|Oac|Nyc|Nycha|Ymca|Ywca|Ymha|Ny|Ii|Iii|Iv|Llc)\b/g, (m) => m.toUpperCase())
    .replace(/\b(Ps|Is|Ms|Jhs|Hs)(?=\s+\d)/g, (m) => m.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => `Mc${c.toUpperCase()}`);
}

const BOROUGH_NAMES = {
  MANHATTAN: "Manhattan", "NEW YORK": "Manhattan", MN: "Manhattan", M: "Manhattan",
  BRONX: "Bronx", "THE BRONX": "Bronx", BX: "Bronx", X: "Bronx",
  BROOKLYN: "Brooklyn", BK: "Brooklyn", K: "Brooklyn", B: "Brooklyn",
  QUEENS: "Queens", QN: "Queens", Q: "Queens",
  "STATEN ISLAND": "Staten Island", "STATEN IS": "Staten Island", "STATEN IS.": "Staten Island", SI: "Staten Island", R: "Staten Island"
};

// "STATEN IS" / "staten island" / "Bronx" → "Staten Island" / "Bronx"; anything else → null.
export const normBorough = (b) => BOROUGH_NAMES[clean(b).toUpperCase()] ?? null;

/*
 * "718-414-1050", "(212) 281-1349", "212.555.0100 x12" → { display: "(718) 414-1050", tel: "+17184141050" }
 * (an extension stays in display and dials after a pause). Not a US number → null.
 */
export function normPhone(raw) {
  const text = clean(raw);
  if (!text) return null;
  const [main, ext] = text.split(/\s*(?:x|ext\.?|extension)\s*/i);
  let digits = main.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  const extDigits = ext?.replace(/\D/g, "") || "";
  const display = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}${extDigits ? ` ext. ${extDigits}` : ""}`;
  return { display, tel: `+1${digits}${extDigits ? `,${extDigits}` : ""}` };
}

const ZIP = (z) => (clean(z).match(/\b\d{5}\b/) ?? [null])[0];

// A street address someone can walk to: a number and a street, not a P.O. box.
export const usableAddress = (a) => Boolean(a) && /\d/.test(a) && /[a-z]{2}/i.test(a) && !/\bP\.?\s*O\.?\s*BOX\b/i.test(a);

// "771 9th Avenue, 2nd Fl" / "771 Ninth Ave." → "771 9 AVENUE": for spotting the same building twice.
export function addressKey(address) {
  return clean(address).toUpperCase()
    .split(/[,;#]/)[0]
    .replace(/\b(FLOOR|FL|SUITE|STE|ROOM|RM|UNIT|APT|LL|BSMT|BASEMENT)\b.*$/, "")
    .replace(/\./g, "")
    .replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1")
    .replace(/\bAVE?\b|\bAV\b/g, "AVENUE").replace(/\bST\b/g, "STREET").replace(/\bRD\b/g, "ROAD")
    .replace(/\bBLVD\b/g, "BOULEVARD").replace(/\bPL\b/g, "PLACE").replace(/\bPKWY\b/g, "PARKWAY")
    .replace(/\bE\b/g, "EAST").replace(/\bW\b/g, "WEST").replace(/\bN\b/g, "NORTH").replace(/\bS\b/g, "SOUTH")
    .replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// BINs ending in 000000 are DOB's placeholders ("no building"), not a building.
const realBin = (bin) => {
  const b = clean(bin).replace(/\.0+$/, "");
  return /^[1-5]\d{6}$/.test(b) && !/^[1-5]000000$/.test(b) ? b : null;
};

const coord = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 1e6) / 1e6 : null;
};

const uniq = (list) => [...new Set(list.filter(Boolean))];

// ---------- Hours ----------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// 9, 0 → "9 AM"; 13, 30 → "1:30 PM"; 24 → "12 AM"
export function clock(h, m = 0) {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${suffix}`;
}

/*
 * NYC Aging's "09:00" / "05:00" (12-hour, no AM/PM) → "9 AM – 5 PM". Opening
 * times read as written (every one is 5–11 in the morning); a closing time at
 * or before the opening one is in the afternoon. "00:00" both → "Closed".
 * Missing or unreadable → null.
 */
export function agingDay(open, close) {
  const parse = (s) => {
    const m = clean(s).replace(/\s/g, "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
  };
  const o = parse(open), c = parse(close);
  if (!o || !c) return null;
  if (o.h === 0 && o.m === 0 && c.h === 0 && c.m === 0) return "Closed";
  let closeH = c.h;
  if (closeH * 60 + c.m <= o.h * 60 + o.m) closeH += 12;
  return `${clock(o.h, o.m)} – ${clock(closeH, c.m)}`;
}

/*
 * The computer centers' free text for a day → "10 AM – 6 PM" when it reads
 * as a range ("10am - 6pm", "10:00AM - 6:00PM", "8:00 AM - 4:00 PM"),
 * "Closed" for "Closed" / "Closed - Closed", otherwise the text as written.
 */
export function dayText(raw) {
  const t = clean(raw);
  if (!t || /^n\/?a$/i.test(t)) return null;
  if (/^closed(\s*-\s*closed)?$/i.test(t)) return "Closed";
  const time = "(\\d{1,2})(?::(\\d{2}))?\\s*([ap])\\.?m\\.?";
  const m = t.match(new RegExp(`^${time}\\s*[-–to]+\\s*${time}$`, "i"));
  if (!m) return t;
  const to24 = (h, ap) => (Number(h) % 12) + (ap.toLowerCase() === "p" ? 12 : 0);
  return `${clock(to24(m[1], m[3]), Number(m[2] ?? 0))} – ${clock(to24(m[4], m[6]), Number(m[5] ?? 0))}`;
}

/*
 * Seven days' text (Mon first, null for not listed) → "Mon–Fri 9 AM – 5 PM · Sat–Sun Closed",
 * runs of the same hours joined. Days not listed are left out; none listed, or
 * every listed day "Closed", → null.
 */
export function weekHours(days) {
  const runs = [];
  days.forEach((text, i) => {
    const last = runs[runs.length - 1];
    if (last && last.text === text && last.end === i - 1) last.end = i;
    else runs.push({ text, start: i, end: i });
  });
  // NYC Aging writes "00:00" every day when it has no hours: not listed, not closed.
  if (runs.every((r) => !r.text || r.text === "Closed")) return null;
  const parts = runs.filter((r) => r.text).map((r) =>
    `${DAYS[r.start]}${r.end > r.start ? `–${DAYS[r.end]}` : ""} ${r.text}`);
  if (!parts.length) return null;
  if (runs.length === 1 && runs[0].text) return `Every day ${runs[0].text}`;
  return parts.join(" · ");
}

// ---------- One site ----------

function site(datasetId, updatedAt, f) {
  const category = categoryByDataset(datasetId).key;
  const address = tidy(f.address);
  const borough = normBorough(f.borough);
  const key = realBin(f.bin) ?? (address ? `${addressKey(address)}|${borough ?? ""}` : `${f.lat},${f.lon}`);
  return {
    id: `${category}:${key}`,
    category,
    name: tidy(f.name) || tidy(f.provider) || address,
    address,
    borough,
    zip: ZIP(f.zip),
    lat: coord(f.lat),
    lon: coord(f.lon),
    phone: normPhone(f.phone),
    hours: blank(f.hours),
    services: uniq(f.services ?? []),
    provider: tidy(f.provider) || null,
    note: blank(f.note),
    closed: Boolean(f.closed),
    sourceDatasetId: datasetId,
    sourceUpdatedAt: updatedAt ?? null
  };
}

// In NYC: by its point when it has one, else by its ZIP. Out-of-city contracts (White Plains) drop out.
const inCity = (s) => (s.lat != null && s.lon != null ? inNyc(s.lat, s.lon) : !s.zip || isNycZip(s.zip));

/*
 * One site per building: rows with the same key (BIN, else street address and
 * borough) become one, the first row's details winning and gaps filled from the
 * others, services merged in order.
 */
export function dedupeSites(sites) {
  const byId = new Map();
  for (const s of sites) {
    const had = byId.get(s.id);
    if (!had) { byId.set(s.id, { ...s, services: [...s.services] }); continue; }
    had.services = uniq([...had.services, ...s.services]);
    for (const k of ["name", "address", "borough", "zip", "lat", "lon", "phone", "hours", "provider", "note"]) had[k] ??= s[k];
    had.closed = had.closed && s.closed; // open if any program there is
  }
  return [...byId.values()];
}

const finish = (sites) => dedupeSites(sites.filter((s) => usableAddress(s.address) && inCity(s)));

// ---------- Per directory ----------

export function normalizeSnap(rows, updatedAt) {
  return finish(rows.map((r) => site("tc6u-8rnp", updatedAt, {
    name: r.facility_name, address: r.street_address, borough: r.borough, zip: r.zip_code,
    lat: r.latitude, lon: r.longitude, bin: r.bin, hours: r.comments
  })));
}

export function normalizeHomebase(rows, updatedAt) {
  return finish(rows.map((r) => {
    const zips = clean(r.service_area_zip_code);
    return site("ntcm-2w4k", updatedAt, {
      name: `Homebase: ${clean(r.homebase_office)}`, provider: r.homebase_office,
      address: r.address, borough: r.borough, zip: r.postcode, lat: r.latitude, lon: r.longitude, bin: r.bin,
      phone: r.phone_number,
      services: ["Help staying housed", "Eviction prevention"],
      note: !zips ? null : /\d{5}/.test(zips) ? `Serves people who live in ZIP codes ${zips}` : `Serves people who live in ${zips}`
    });
  }));
}

// "800 Barretto Street; Bronx, NY 10474", "4200 7th Avenue, Brooklyn, 11232, NY",
// "108 West 146th Street, 10039, Manhattan, New York, USA" → the street address alone
const streetPart = (a) => clean(a).split(";")[0].replace(/,\s*(\d{5}|New York|Manhattan|Bronx|Brooklyn|Queens|Staten Island|NY)\b.*$/i, "");

export function normalizeDropIn(rows, updatedAt) {
  return finish(rows.map((r) => site("bmxf-3rd4", updatedAt, {
    name: r.center_name, address: streetPart(r.address), borough: r.borough, zip: r.postcode,
    lat: r.latitude, lon: r.longitude, bin: r.bin, hours: r.comments,
    services: ["Meals, showers & a place to rest", "Help finding shelter"]
  })));
}

const yes = (v) => clean(v).toUpperCase() === "Y";
const COMPUTER_FLAGS = [
  ["device_loaning", "Borrow a laptop or tablet"],
  ["technology_related_courses", "Computer classes"],
  ["job_readiness_ex_resume_help", "Job & résumé help"],
  ["general_tech_help", "Tech help"],
  ["telehealth_skills", "Telehealth help"],
  ["wheelchair_accessible", "Wheelchair accessible"]
];

// Rows for one calendar_year (the server asks for the latest).
export function normalizeComputers(rows, updatedAt) {
  return finish(rows.map((r) => {
    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => dayText(r[`${d}_open`]));
    const closed = /temporar/i.test(clean(r.status));
    const services = [
      "Free computers & Wi-Fi",
      clean(r.target_population) === "Older Adults" ? "For older adults" : null,
      ...COMPUTER_FLAGS.filter(([k]) => yes(r[k])).map(([, label]) => label)
    ];
    return site("sejx-2gn3", updatedAt, {
      name: r.location_name, provider: r.operator_name,
      address: streetPart(r.address_street || r.full_location_address), borough: r.borough_name, zip: r.zipcode,
      lat: r.latitude, lon: r.longitude, bin: r.bin, phone: r.full_location_phone_number,
      hours: weekHours(days), services, closed,
      note: closed ? "Temporarily closed" : yes(r.access_requirements) ? "You may need to sign up or be a member to use the computers" : null
    });
  }));
}

/*
 * DYCD program areas kept, in plain words. Left out: SYEP (summer job
 * worksites, not places to walk into), Literacy and Immigrant Services
 * (mostly adult classes), and RHY except its drop-in centers (the rest are
 * residential shelters whose locations aren't published as walk-in sites).
 */
export const YOUTH_AREAS = {
  Compass: "After-school & summer programs",
  Cornerstone: "Community center",
  Beacon: "School-based community center",
  Discretionary: "Community program",
  CSBG: "Family & anti-poverty services",
  WIOA: "Job training",
  "Advance and Earn": "Job training",
  CRED: "Job training",
  "Office of Neighborhood Safety": "Violence prevention",
  "Strategic Partnerships": "Community program",
  RHY: "Runaway & homeless youth drop-in"
};
export const isYouthRowKept = (r) =>
  Object.hasOwn(YOUTH_AREAS, clean(r.program_area)) && (clean(r.program_area) !== "RHY" || /drop-?in/i.test(clean(r.program_type)));

// Rows for one fiscal year (the server asks for the latest).
// Tags: the plain-words program areas first, then DYCD's service categories, then ages.
const youthRank = (t) => (Object.values(YOUTH_AREAS).includes(t) ? 0 : /^(Ages|Grades)\b/.test(t) ? 2 : 1);

export function normalizeYouth(rows, updatedAt) {
  const sites = finish(rows.filter(isYouthRowKept).map((r) => {
    const ages = clean(r.age_range).replace(/\s*-\s*/, "–");
    return site("ebkm-iyma", updatedAt, {
      name: r.program_site_name, provider: r.provider,
      address: r.street_address, borough: r.borough, zip: r.zipcode, lat: r.latitude, lon: r.longitude, bin: r.bin,
      services: [YOUTH_AREAS[clean(r.program_area)], ...clean(r.service_category).split(/\s*;\s*/), ages || null]
    });
  }));
  for (const s of sites) s.services.sort((a, b) => youthRank(a) - youthRank(b)); // stable, so order within a rank stays
  return sites;
}

/*
 * NYC Aging contract types that are places an older adult (or a caregiver)
 * can go or call, in plain words. Left out: home-delivered meals,
 * transportation, friendly visiting and home care, which come to you.
 */
export const AGING_TYPES = {
  "OLDER ADULT CENTER CONTRACTS": "Older adult center (meals & activities)",
  "NATURALLY OCCURING RETIREMENT COMMUNITY CONTRACTS": "Support for older adults in their building (NORC)",
  "CASE MANAGEMENT SERVICES CONTRACTS": "Case management",
  "NEW YORK CONNECTS CONTRACTS": "Benefits & long-term care help",
  "CAREGIVER SERVICES CONTRACTS": "Caregiver support",
  "LEGAL SERVICES CONTRACTS": "Legal help",
  "ELDER ABUSE SERVICES CONTRACTS": "Elder abuse help",
  "GERIATRIC MENTAL HEALTH SERVICES CONTRACTS": "Mental health support"
};

export function normalizeAging(rows, updatedAt) {
  return finish(rows.filter((r) => Object.hasOwn(AGING_TYPES, clean(r.providertype))).map((r) => {
    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => agingDay(r[`${d}houropen`], r[`${d}hourclose`]));
    return site("cqc8-am9x", updatedAt, {
      name: r.programname, provider: r.sponsorname,
      address: r.programaddress, borough: r.borough, zip: r.programzipcode, lat: r.latitude, lon: r.longitude, bin: r.bin,
      phone: r.programphone, hours: weekHours(days), services: [AGING_TYPES[clean(r.providertype)]]
    });
  }));
}

/*
 * NYCHA community spaces that hold a program residents can use. The
 * program_type column is free text; these words keep a row, and the second
 * list drops NYCHA's own offices, shops and storage.
 */
const NYCHA_KEEP = /senior|senor|community|cornerstone|compass|norc|child ?care|head start|health|clinic|food pantry|jobs plus|education|literacy|computer|library|youth|family|vocational|case management|domestic violence|social services|adult day|job readiness|wellness|sports|mentoring|violence|recreation/i;
const NYCHA_DROP = /storage|property management|nypd|cctv|plasterer|carpent|paint admin|heating|\bta use\b|\bra (president|leader|use)\b|borough office|neighborhood \d|neighborhood administrator|pm office|unk?n?own|business development|choir|lighting vendor/i;
// "Food Pantry/Storage" is kept for its food pantry: any one part of the type can keep it.
export const isNychaRowKept = (r) => clean(r.status).toLowerCase() === "occupied" &&
  clean(r.program_type).split("/").some((part) => NYCHA_KEEP.test(part) && !NYCHA_DROP.test(part));

const NYCHA_WORDS = [
  [/cornerstone|community cent/i, "Community center"],
  [/compass/i, "After-school programs"],
  [/norc/i, "Support for older adults in their building (NORC)"],
  [/senior|senor/i, "Older adult center"],
  [/child care|head start|upk|early intervention/i, "Child care"],
  [/health|clinic|wellness/i, "Health clinic"],
  [/food pantry/i, "Food pantry"],
  [/jobs plus|vocational|job readiness|workforce|trade/i, "Job help"],
  [/literacy|education|esl|ged/i, "Classes"],
  [/computer/i, "Computer lab"],
  [/gun violence|cure violence/i, "Violence prevention"],
  [/domestic violence|counsel/i, "Counseling"],
  [/youth|family|mentoring|case management/i, "Family & youth services"],
  [/sports|recreation/i, "Sports & recreation"],
  [/library/i, "Library"]
];

export function normalizeNycha(rows, updatedAt) {
  return finish(rows.filter(isNychaRowKept).map((r) => {
    const type = clean(r.program_type);
    const services = NYCHA_WORDS.filter(([re]) => re.test(type)).map(([, label]) => label);
    const dev = tidy(r.development);
    return site("crns-fw6u", updatedAt, {
      name: dev ? `${dev}${/houses|homes|apartments|plaza|towers|gardens/i.test(dev) ? "" : " Houses"} community space` : null,
      provider: r.sponsor, address: r.address, borough: r.borough, zip: r.postcode,
      lat: r.latitude, lon: r.longitude, bin: r.bin, services
    });
  }));
}

export const NORMALIZERS = {
  "tc6u-8rnp": normalizeSnap,
  "ntcm-2w4k": normalizeHomebase,
  "bmxf-3rd4": normalizeDropIn,
  "sejx-2gn3": normalizeComputers,
  "ebkm-iyma": normalizeYouth,
  "cqc8-am9x": normalizeAging,
  "crns-fw6u": normalizeNycha
};

// Every category has a normalizer (a new one in config.js needs one here).
for (const c of CATEGORIES) if (!NORMALIZERS[c.datasetId]) throw new Error(`No normalizer for ${c.datasetId}`);
