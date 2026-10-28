/*
 * Reading one lab value from the water quality dataset. Every measurement
 * column is text, and besides plain numbers it holds:
 *
 *   "<1", "<0.10", "<0.3"  below the lab's detection limit
 *   "ND"                   not detected (none in the data as of Oct 2026, but it's a common lab code)
 *   ">200.5"               above the counting limit (coliform only)
 *   "-9", "-9.99"          placeholders for a missing result (one sample each)
 *   null / ""              not tested (fluoride is only tested at some sites)
 *
 * parseMeasurement(raw, kind) → {
 *   status: "measured" | "not-detected" | "missing",
 *   value:  number | null   bacteria "not detected" → 0; other kinds → null (below the limit)
 *   limit:  number | null   the detection limit, for "<X"
 *   above:  boolean         ">X": at least X (value is X)
 *   raw
 * }
 * kind: "bacteria" (coliform, E. coli) or "chemistry" (chlorine, turbidity, fluoride).
 *
 * The SoQL in soql.js applies the same rules on the server; keep them in step.
 */

const NUMBER = /^-?\d+(\.\d+)?$|^-?\.\d+$/;

export function parseMeasurement(raw, kind = "chemistry") {
  const text = raw == null ? "" : String(raw).trim();
  const base = { value: null, limit: null, above: false, raw: raw ?? null };

  if (!text) return { ...base, status: "missing" };

  if (/^n\.?d\.?$/i.test(text)) {
    return { ...base, status: "not-detected", value: kind === "bacteria" ? 0 : null };
  }

  const qualifier = text[0];
  if (qualifier === "<" || qualifier === ">") {
    const n = text.slice(1).trim();
    if (!NUMBER.test(n)) return { ...base, status: "missing" };
    const limit = Number(n);
    if (qualifier === "<") return { ...base, status: "not-detected", value: kind === "bacteria" ? 0 : null, limit };
    return { ...base, status: "measured", value: limit, above: true };
  }

  if (!NUMBER.test(text)) return { ...base, status: "missing" };
  const value = Number(text);
  // Negative results are placeholders (-9, -9.99), not measurements.
  if (value < 0) return { ...base, status: "missing" };
  return { ...base, status: "measured", value };
}

// Bacteria found: measured above zero (a measured 0 is the same as none found).
export function isDetected(m) {
  return m.status === "measured" && m.value > 0;
}

// "Not detected" for display: below the detection limit, ND, or a measured 0 for bacteria.
export function notDetectedText(m) {
  return m.limit != null ? `Not detected (below ${m.limit})` : "Not detected";
}

// "2", "≥200.5", "Not detected", "No result"
export function measurementText(m) {
  if (m.status === "missing") return "No result";
  if (m.status === "not-detected" || (m.value === 0)) return notDetectedText(m);
  return `${m.above ? "≥" : ""}${m.value}`;
}
