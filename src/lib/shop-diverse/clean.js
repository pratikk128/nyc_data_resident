/*
 * Cleans one row of the SBS Certified Business List (ci93-uc8s) into the
 * record the page uses. Pure functions, shared by the daily job and the tests.
 *
 * Quirks found in the data (Oct 2026):
 *   - Names: leading junk ("=---T. M. Kilduff"), ~700 in all caps.
 *   - Phones: mixed formats ("718.740.8400", "718 8159200").
 *   - Websites: "N/A", "http://Under Construction", company names with a
 *     scheme in front, "HTTPS://…".
 *   - ZIPs are stored as numbers, so New Jersey and New England lose their
 *     leading zero ("7724" is 07724).
 *   - Renewal dates are text, M/D/YYYY, sometimes doubled ("11/30/2026;11/30/2026").
 *     WBE-only firms have none.
 *   - Dates of establishment run up to the year 2996.
 *   - Borough is blank outside NYC and for some NYC addresses that didn't geocode.
 */

const KEEP_UPPER = new Set([
  "NYC", "NY", "NJ", "USA", "US", "LLC", "LLP", "PLLC", "PC", "DBA", "II", "III", "IV",
  "CPA", "HVAC", "IT", "AV", "MEP", "LTD", "JV"
]);
const KEEP_LOWER = new Set(["of", "and", "the", "for", "in", "on", "at", "to", "a", "an", "by"]);

// "ACME PLUMBING OF NY, LLC" → "Acme Plumbing of NY, LLC". Only for text with
// no lowercase letters, so mixed-case names ("iHeart", "McKinsey") stay as written.
export function titleCase(text) {
  const value = String(text ?? "");
  if (/[a-z]/.test(value)) return value;
  return value.toLowerCase().replace(/[a-z0-9][a-z0-9'’]*/g, (word, offset) => {
    const upper = word.toUpperCase();
    if (KEEP_UPPER.has(upper)) return upper;
    if (offset > 0 && KEEP_LOWER.has(word)) return word;
    // "41st" stays lowercase; a unit or model ("5g", "3d") is upper-cased
    if (/^\d/.test(word)) return /^\d+(st|nd|rd|th)$/.test(word) ? word : upper;
    // "o'brien" → "O'Brien", but "joe's" → "Joe's"
    const cap = word[0].toUpperCase() + word.slice(1);
    return cap.replace(/^(.['’])([a-z])/, (m, head, c) => head + c.toUpperCase());
  });
}

// Trimmed, whitespace collapsed, placeholders ("N/A", "none", "-") as "".
export function text(value) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return /^(n\/?a|none|null|-+|\.+)$/i.test(s) ? "" : s;
}

// Business names: leading punctuation junk stripped, shouting title-cased.
// A leading quote goes too, with its closing quote ("“I AM” EHS" → "I AM EHS"),
// so A–Z order starts at the first letter.
export function businessName(value) {
  const s = text(value).replace(/^[=\-–—_*.,;:~+#]+\s*/, "");
  const unquoted = s.replace(/^["“”'‘’]\s*([^"“”]*?)\s*["“”]\s*/, "$1 ").replace(/^["“”'‘’]+\s*/, "").trim();
  return titleCase(unquoted);
}

// Street lines, cities and people: title-case shouting and all-lowercase text.
function properCase(value) {
  const s = text(value);
  if (!/[a-z]/i.test(s)) return s;
  if (s === s.toLowerCase()) return titleCase(s.toUpperCase());
  return titleCase(s);
}

// "Stony point" → "Stony Point"; "MT. VERNON" → "Mt. Vernon".
function cityName(value) {
  return properCase(value).replace(/(^|[\s-])([a-z])/g, (m, sep, c) => sep + c.toUpperCase());
}

// Ten digits (an 11-digit number starting with 1 drops the 1) → "(201) 993-9696"
// with a tel: link; anything else is shown as written, with no link.
export function phone(value) {
  const raw = text(value);
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  if (digits.length !== 10) return raw ? { display: raw, tel: null } : null;
  return {
    display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
    tel: `+1${digits}`
  };
}

// A usable URL, or null. The host has to look like a domain: no spaces, at
// least one dot, and letters after the last one. The scheme is kept as
// written, since a site that only serves http:// breaks behind https:// (and
// browsers upgrade an http:// link where https works); a bare address gets
// https://.
export function website(value) {
  const s = text(value);
  if (!s) return null;
  const scheme = /^http:/i.test(s) ? "http" : "https";
  const rest = s.replace(/^https?:\/*/i, "").replace(/^\/+/, "");
  const m = rest.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(:\d+)?([/?#]\S*)?$/i);
  if (!m) return null;
  return `${scheme}://${m[1].toLowerCase()}${m[2] ?? ""}${m[3] && m[3] !== "/" ? m[3] : ""}`;
}

// Five digits; 3- and 4-digit values get their leading zeros back, ZIP+4 is cut.
export function zip(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length >= 3 && digits.length <= 5) return digits.padStart(5, "0");
  if (digits.length === 9) return digits.slice(0, 5);
  return "";
}

const BOROUGH_NAMES = {
  MANHATTAN: "Manhattan", BROOKLYN: "Brooklyn", QUEENS: "Queens", BRONX: "Bronx",
  "STATEN IS": "Staten Island", "STATEN ISLAND": "Staten Island"
};

// The borough of a NYC ZIP code, or null. Queens ZIPs in the 110s are only
// 11004 and 11005; the rest of 110xx and all of 115xx are Nassau County.
export function boroughFromZip(code) {
  if (!/^\d{5}$/.test(code ?? "")) return null;
  const p = code.slice(0, 3);
  if (p === "100" || p === "101" || p === "102") return "Manhattan";
  if (p === "103") return "Staten Island";
  if (p === "104") return "Bronx";
  if (p === "112") return "Brooklyn";
  if (p === "111" || p === "113" || p === "114" || p === "116" || code === "11004" || code === "11005") return "Queens";
  return null;
}

// The dataset's geocoded borough; for a New York address without one, the ZIP's.
export function borough(row, cleanZip) {
  const named = BOROUGH_NAMES[text(row.borough).toUpperCase()];
  if (named) return named;
  const state = text(row.state).toUpperCase();
  return !state || state === "NY" ? boroughFromZip(cleanZip) : null;
}

// "MBE,WBE" → ["WBE", "MBE"] in display order, unknown codes kept at the end.
export function certifications(value) {
  const order = ["WBE", "MBE", "LBE", "EBE"];
  const codes = [...new Set(text(value).toUpperCase().split(/[,;/\s]+/).filter(Boolean))];
  return codes.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}

// "10/31/2030" or "11/30/2026;11/30/2026" → ["2026-11-30"], unique and sorted.
export function renewalDates(value) {
  const dates = text(value).split(/[;,]/).map((part) => {
    const m = part.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [, mo, d, y] = m.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }).filter(Boolean);
  return [...new Set(dates)].sort();
}

// Floating timestamp → "YYYY-MM-DD", or null if it's missing, after `today`
// (a typo like 2996) or before 1800.
export function pastDate(value, today) {
  const d = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d > today || d < "1800-01-01") return null;
  return d;
}

// "BLACK" → "Black"; "NON-MINORITY" → "Non-minority"; junk like "/A" → null.
export function ethnicity(value) {
  const s = text(value).toUpperCase();
  if (!/^[A-Z][A-Z -]+$/.test(s)) return null;
  if (s === "NON-MINORITY") return "Non-minority";
  return titleCase(s);
}

const positive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Past job i (1–3). Job 1's contract value is the column the dataset calls
// largest_value_of_contract.
function job(row, i, today) {
  const client = businessName(row[`name_of_client_job_exp_${i}`]);
  if (!client) return null;
  const pct = positive(row[`percent_self_performed_job_exp_${i}`]);
  return compact({
    client,
    value: positive(i === 1 ? row.largest_value_of_contract : row[`value_of_contract_job_exp_${i}`]),
    selfPerformed: pct && pct <= 100 ? pct : null,
    date: pastDate(row[`date_of_work_job_exp_${i}`], today),
    description: text(row[`description_of_work_job_exp_${i}`])
  });
}

// Drops empty fields so records stay small and the page never shows blanks.
function compact(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) delete obj[k];
  }
  return obj;
}

/*
 * One vendor. `today` (YYYY-MM-DD, New York) is only used to drop
 * establishment dates in the future. Returns null for a row with no id or name.
 */
export function cleanVendor(row, today) {
  const id = text(row.account_number);
  const name = businessName(row.vendor_formal_name);
  if (!id || !name) return null;
  const dba = businessName(row.vendor_dba);
  const cleanZip = zip(row.zip);
  const naics = text(row.id6_digit_naics_code).replace(/\.0+$/, "");
  const description = String(row.business_description ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return compact({
    id,
    name,
    dba: dba && dba.toUpperCase() !== name.toUpperCase() ? dba : null,
    certs: certifications(row.certification),
    renewals: renewalDates(row.cert_renewal_date),
    ethnicity: ethnicity(row.ethnicity),
    sector: text(row.naics_sector),
    subsector: text(row.naics_subsector),
    title: text(row.naics_title),
    naics: /^\d{2,6}$/.test(naics) ? naics : null,
    nigp: text(row.nigp_codes).split("|").map((c) => c.trim()).filter((c) => /^\d+$/.test(c)),
    description: /^(n\/?a|none|-+)$/i.test(description) ? "" : description,
    contact: properCase(`${text(row.first_name)} ${text(row.last_name)}`),
    phone: phone(row.telephone),
    website: website(row.website),
    address1: properCase(row.address1),
    address2: properCase(row.address2),
    city: cityName(row.city),
    state: text(row.state).toUpperCase().slice(0, 2),
    zip: cleanZip,
    borough: borough(row, cleanZip),
    established: pastDate(row.date_of_establishment, today),
    bonding: positive(row.aggregate_bonding_limit),
    union: text(row.signatory_to_union_contracts),
    largestContract: positive(row.largest_value_of_contract),
    jobs: [1, 2, 3].map((i) => job(row, i, today)).filter(Boolean),
    passport: text(row.enrolled_in_passport).toUpperCase() === "YES" || null
  });
}

const EXCERPT_LENGTH = 160;

// First ~160 characters of the description, cut at a word.
export function excerpt(description) {
  const s = String(description ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= EXCERPT_LENGTH) return s;
  const cut = s.slice(0, EXCERPT_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : EXCERPT_LENGTH).replace(/[\s,;:.–-]+$/, "")}…`;
}

// The fields the search, ranking and result cards use; the daily job keeps
// only these in KV. The detail view loads the whole record by id. The full
// description stays out: the index keeps its excerpt, for the cards and the
// ranking, and its other words, for the keyword search (descriptionHaystack).
const INDEX_FIELDS = [
  "id", "name", "dba", "certs", "renewals", "ethnicity", "sector", "subsector", "title",
  "phone", "website", "city", "state", "zip", "borough", "established"
];
export function indexRecord(vendor) {
  const out = {};
  for (const k of INDEX_FIELDS) if (vendor[k] !== undefined) out[k] = vendor[k];
  if (out.phone) out.phone = { tel: out.phone.tel ?? null };
  out.excerpt = excerpt(vendor.description);
  // Words the name and industry hold don't need repeating: keyword search
  // scores a match spread across them like one in the description (ranking.js).
  out.keywords = extraWords(vendor.description,
    [out.excerpt, out.name, out.dba, out.sector, out.subsector, out.title].filter(Boolean).join(" "));
  return compact(out);
}

// The ~600 industries (sector, subsector, title) repeat across ~12,000
// vendors, so KV keeps each once and vendors point to it by index ("ind"),
// which saves about a fifth of the copy. unpackIndex() puts the fields back,
// sharing one string per industry.
const INDUSTRY_FIELDS = ["sector", "subsector", "title"];
export function packIndex(records) {
  const ids = new Map();
  const industries = [];
  const vendors = records.map(({ sector, subsector, title, ...rest }) => {
    const row = [sector ?? "", subsector ?? "", title ?? ""];
    const key = row.join("\t");
    if (!ids.has(key)) {
      ids.set(key, industries.length);
      industries.push(row);
    }
    return { ...rest, ind: ids.get(key) };
  });
  return { industries, vendors };
}

export function unpackIndex({ industries, vendors }) {
  return vendors.map(({ ind, ...rest }) => {
    const out = { ...rest };
    INDUSTRY_FIELDS.forEach((k, i) => { if (industries[ind]?.[i]) out[k] = industries[ind][i]; });
    return out;
  });
}

// Upper-cased words for keyword matching: punctuation and apostrophes become
// spaces, so "Joe’s" and "JOES" both find "joe".
export function searchText(value) {
  return ` ${String(value ?? "").toUpperCase().replace(/['‘’ʼ`]/g, "").replace(/[^A-Z0-9]+/g, " ").trim()} `;
}

const words = (value) => searchText(value).trim().split(" ").filter(Boolean);

// Filler words, left out of the description's extra words and of keywords (keywordWords), so "food and beverage"
// still finds a firm whose "and" was dropped. Not "IT" or "US": those are
// search terms here.
export const STOP_WORDS = new Set([
  "A", "AN", "THE", "AND", "OR", "OF", "TO", "IN", "ON", "AT", "BY", "FOR", "WITH", "FROM", "INTO", "AS",
  "IS", "ARE", "WAS", "WERE", "BE", "BEEN", "HAS", "HAVE", "HAD", "THAT", "THIS", "THESE", "THOSE", "WHICH",
  "WHO", "WE", "OUR", "THEY", "THEIR", "THEM", "ITS", "YOU", "YOUR", "ALSO", "THAN", "WHILE"
]);

// The description's words that `searchable` (its excerpt, and the other text
// keyword search looks in) doesn't already hold, each once, with filler words
// left out ("TILE FLOORS"). Keywords match the start of any word, so repeats
// add nothing, and neither does a word that starts a longer one ("PROJECT"
// beside "PROJECTS"), except one of one or two letters, which has to match a
// whole word.
export function extraWords(description, searchable) {
  const known = words(searchable);
  const skip = new Set(known);
  const extra = [...new Set(words(description))].filter((w) => !skip.has(w) && !STOP_WORDS.has(w));
  // Sorted, any longer words a word starts come right after it.
  const sorted = [...new Set([...extra, ...known])].sort();
  const covered = new Set(sorted.filter((w, i) => w.length > 2 && sorted[i + 1]?.startsWith(w)));
  return extra.filter((w) => !covered.has(w)).join(" ");
}

// The description as keyword search sees it: the excerpt's words plus the rest.
export function descriptionHaystack(record) {
  return `${searchText(record.excerpt)}${record.keywords ? `${record.keywords} ` : ""}`;
}

// Endings cut from a keyword so its other forms match too. Keywords match the
// start of a word, so "PLUMBER" and "PLUMBING" both become "PLUMB", and
// "BAKERY" and "BAKERIES" both become "BAKER". The first ending that leaves a
// long enough stem wins ("BAKERS" → "BAKER", not "BAK"). -ES only goes after
// s, x, z, ch and sh ("BOXES" → "BOX", but "TILES" → "TILE").
const ENDINGS = [
  ["IERS", 4], ["IES", 3], ["IER", 4], ["ERS", 4], ["ING", 4], ["ER", 4], ["Y", 4],
  [/(S|X|Z|CH|SH)ES$/, 3], ["S", 3]
];

export function stem(word) {
  if (/\d/.test(word)) return word;
  for (const [ending, min] of ENDINGS) {
    const cut = typeof ending === "string"
      ? (word.endsWith(ending) ? word.slice(0, -ending.length) : null)
      : (ending.test(word) ? word.slice(0, -2) : null);
    if (cut === null || cut.length < min) continue;
    // "SHIPPING" → "SHIP", "PLANNER" → "PLAN"; "INSTALL", "DRESS", "STAFF" keep theirs
    return /([B-DGKMNPRT])\1$/.test(cut) ? cut.slice(0, -1) : cut;
  }
  return word;
}

// A keyword's words, stemmed, without filler words (unless that's all it has).
export function keywordWords(value) {
  const all = words(value);
  const kept = all.filter((w) => !STOP_WORDS.has(w));
  return (kept.length ? kept : all).map(stem);
}
