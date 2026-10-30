/*
 * Map of closed blocks, on the shared near-a-spot map (src/lib/maps/nearby-map.js).
 * Browser only. Each block is a line colored by its status, with a dash
 * pattern too so the color is never alone:
 *   active now     solid red
 *   starts soon    dashed amber
 *   later          dotted blue
 * The card list is the non-map alternative (DESIGN.md "Maps").
 *
 * mountClosureMap(canvas, { onPick(seg) }) →
 *   update({ blocks, point, radiusMeters, refit })  draws the blocks (each with .status), the spot and its radius
 *   highlight(seg, { pan })                          outlines one block (null: none)
 *   invalidate()                                     after the frame changes size
 */
import { mountNearbyMap, YELLOW } from "../maps/nearby-map.js";

const MIN_PICKED_PX = 48; // a picked block shorter than this on screen gets zoomed to

// The basemap stays light in both themes, so these fixed colors work in both.
export const STATE_STYLES = {
  active: { color: "#B3261E", dashArray: null, label: "Active now" },
  soon: { color: "#D98A00", dashArray: "8 5", label: "Starts within 3 days" },
  later: { color: "#1F4FB8", dashArray: "2 5", label: "Starts later" }
};

const styleFor = (state, on = false) => ({
  color: STATE_STYLES[state].color,
  dashArray: on ? null : STATE_STYLES[state].dashArray,
  weight: on ? 7 : 4,
  opacity: 0.95,
  lineCap: "round"
});

// Later first, so active closures draw on top.
const ORDER = { later: 0, soon: 1, active: 2 };

export function mountClosureMap(canvas, { onPick }) {
  let title = (b) => b.on;
  const base = mountNearbyMap(canvas, {
    fallback: "The map couldn’t load. The list has every closure.",
    minPickedPx: MIN_PICKED_PX,
    keyOf: (b) => b.seg,
    draw(b, { L, layer, renderer }) {
      L.polyline(b.lines, { renderer, ...styleFor(b.status.state) })
        .bindTooltip(title(b), { sticky: true })
        .on("click", () => onPick(b.seg))
        .addTo(layer);
      return b.lines.flat();
    },
    // A yellow outline under a thicker copy of the line, on top of everything.
    drawHalo(b, { L, halo, renderer }) {
      L.polyline(b.lines, { renderer, color: YELLOW, weight: 13, opacity: 1, lineCap: "round", interactive: false }).addTo(halo);
      L.polyline(b.lines, { renderer, ...styleFor(b.status.state, true), interactive: false }).addTo(halo);
    }
  });

  function update({ blocks, point, radiusMeters, refit = true, title: t = (b) => b.on }) {
    title = t;
    const items = [...blocks].sort((a, b) => ORDER[a.status.state] - ORDER[b.status.state]);
    return base.update({ items, point, radiusMeters, refit });
  }

  return { update, highlight: base.highlight, invalidate: base.invalidate };
}
