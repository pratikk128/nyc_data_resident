/*
 * What the comparison sections (above-average types, location types) compare,
 * worked out from store.js state:
 *   - a spot or ZIP: the ½ mile neighborhood by default, or the ¼ mile when the
 *     reader picks it and it has enough requests; against the borough or the city.
 *   - a borough on its own: the borough against the city.
 */
import { boroughLabel, AREAS } from "./config.js";
import { comparisonArea } from "./stats.js";

const waiting = (...pieces) => pieces.some((p) => p.status === "loading" || p.status === "idle");

export function comparisonView(state) {
  const loc = state.location;
  if (!loc) return { status: "idle" };
  const base = state.baseline;
  const boroughName = boroughLabel(state.borough);

  if (loc.kind === "borough") {
    if (base.status === "error") return { status: "error", error: base.error };
    if (waiting(base)) return { status: "loading", waitingOnBaseline: true };
    return {
      status: "ready", mode: "borough", local: base.data.borough, localName: `in ${boroughName}`,
      names: { here: boroughName, borough: null, city: "NYC" },
      baseline: base.data.city, baselineName: "the NYC average", city: base.data.city, vs: "city", boroughName
    };
  }

  const { immediate: imm, neighborhood: nb, zip } = state;
  const failed = [zip, nb, base].find((p) => p.status === "error");
  if (failed) return { status: "error", error: failed.error };
  if (waiting(nb, base) || imm.status === "loading") return { status: "loading", waitingOnBaseline: waiting(base) };

  // If the ¼ mile query failed, compare with the ½ mile and say the ¼ mile isn't available.
  const cmp = comparisonArea(imm.status === "ready" ? imm.data.total : 0, state.area);
  const immediateFailed = imm.status === "error";
  const local = cmp.area === "immediate" ? imm.data : nb.data;
  const hasBorough = Boolean(base.data.borough && boroughName);
  const vs = state.vs === "borough" && hasBorough ? "borough" : "city";
  return {
    status: "ready", mode: "radius", ...cmp, immediateFailed,
    local, localName: "here",
    names: { here: cmp.area === "immediate" ? "Within ¼ mile" : "Within ½ mile", borough: hasBorough ? boroughName : null, city: "NYC" },
    baseline: vs === "borough" ? base.data.borough : base.data.city,
    baselineName: vs === "borough" ? `the ${boroughName} average` : "the NYC average",
    boroughBaseline: hasBorough ? base.data.borough : null,
    city: base.data.city,
    vs, hasBorough, boroughName, areaInfo: AREAS[cmp.area]
  };
}
