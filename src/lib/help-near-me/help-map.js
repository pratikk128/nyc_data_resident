/*
 * Map of help sites, on the shared near-a-spot map (src/lib/maps/nearby-map.js).
 * Browser only. Each site is a round pin in its category's color with the
 * category's icon inside, so color is never alone; pins are keyboard
 * reachable (Tab, then Enter picks one) and named for screen readers. The
 * list is the non-map alternative (DESIGN.md "Maps").
 *
 * mountHelpMap(canvas, { onPick(id) }) →
 *   update({ sites, point, radiusMeters, refit, fitTo })  draws the sites, the spot and its radius
 *   highlight(id, { pan })                                 rings one site (null: none)
 *   invalidate()                                           after the frame changes size
 */
import { mountNearbyMap, YELLOW, INK } from "../maps/nearby-map.js";
import { categoryOf } from "./config.js";
import { milesText } from "./distance.js";

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function pinHtml(category) {
  const c = categoryOf(category);
  return `<span class="hn-pin" style="--hn-pin:${c.color}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg></span>`;
}

export const pinLabel = (s) => `${s.name}, ${categoryOf(s.category).label}, ${milesText(s.miles)} away`;

export function mountHelpMap(canvas, { onPick }) {
  const markers = new Map(); // id → marker
  const base = mountNearbyMap(canvas, {
    fallback: "The map couldn’t load. The list below has every place.",
    keyOf: (s) => s.id,
    draw(s, { L, layer }) {
      const icon = L.divIcon({ className: "hn-pin-wrap", html: pinHtml(s.category), iconSize: [30, 30], iconAnchor: [15, 15] });
      const label = pinLabel(s);
      const m = L.marker([s.lat, s.lon], { icon, title: label, alt: label, keyboard: true, riseOnHover: true })
        .bindTooltip(escape(s.name), { direction: "top", offset: [0, -14] })
        .on("click", () => onPick(s.id))
        .on("add", () => m.getElement()?.setAttribute("aria-label", label))
        .addTo(layer);
      markers.set(s.id, m);
      return [[s.lat, s.lon]];
    },
    // A yellow ring around the pin, and the pin on top of the others.
    drawHalo(s, { L, halo }) {
      L.circleMarker([s.lat, s.lon], { radius: 21, color: INK, weight: 1.5, fillColor: YELLOW, fillOpacity: 0.9, interactive: false }).addTo(halo);
      for (const [id, m] of markers) m.setZIndexOffset(id === s.id ? 1000 : 0);
    }
  });

  function update({ sites, point, radiusMeters, refit = true, fitTo = null }) {
    markers.clear();
    // Farthest first, so the nearest pins draw on top.
    return base.update({ items: [...sites].reverse(), point, radiusMeters, refit, fitTo });
  }

  return { update, highlight: base.highlight, invalidate: base.invalidate };
}
