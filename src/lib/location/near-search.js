/*
 * The "near a spot" search box shared by Street Closures and Help Near Me:
 * what a typed address or ZIP leads to, and what the address lookup's answer
 * means for the page. Pure, so the tests cover it without a browser; the
 * page scripts do the DOM work.
 */

/*
 * The form's submit, from parseLocationInput() and the ZIP centroids →
 *   { kind: "message", text, focus }   say why not (focus: back to the box)
 *   { kind: "borough", borough }       a borough name alone ("BROOKLYN"): up to the page
 *   { kind: "point", lat, lon, label } a ZIP's middle
 *   { kind: "lookup" }                 an address: geocode it
 */
export function nearSearch(parsed, zips) {
  if (parsed.kind === "empty") return { kind: "message", text: "Type an address or ZIP code, or use your location.", focus: true };
  if (parsed.kind === "error") return { kind: "message", text: parsed.message, focus: false };
  if (parsed.kind === "borough") return { kind: "borough", borough: parsed.borough };
  if (parsed.kind === "zip") {
    const c = zips[parsed.zip];
    if (!c) return { kind: "message", text: `We don’t have a location for ZIP ${parsed.zip}. Try an address in it.`, focus: false };
    return { kind: "point", lat: c[0], lon: c[1], label: `the middle of ZIP ${parsed.zip}` };
  }
  return { kind: "lookup" };
}

/*
 * resolveLocation()'s answer →
 *   { kind: "point", lat, lon, label }
 *   { kind: "choose", text, choices }   choices: [{ lat, lon, label }]
 *   { kind: "message", text }
 */
export function addressOutcome(result) {
  if (result.status === "resolved") {
    const { lat, lon, label } = result.location;
    return { kind: "point", lat, lon, label };
  }
  if (result.status === "choose") {
    const text = result.reason === "ambiguous" ? "That could be a few places. Which one?" : "No exact match. Did you mean one of these?";
    return { kind: "choose", text, choices: result.suggestions };
  }
  return { kind: "message", text: "No matches. Try a nearby ZIP code or fewer words." };
}
