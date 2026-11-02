/*
 * Map of park amenities, on the shared near-a-spot map (src/lib/maps/nearby-map.js).
 * Browser only. Each amenity is a round pin in its category's color with the
 * category's icon inside (Help Near Me's pins, help-map.js), so color is
 * never alone. Clicking one opens its popup (name, park, details, distance,
 * directions) and picks its card. Pins are out of the Tab order: every pin
 * is a card in the list, the keyboard and screen reader way through the
 * results (DESIGN.md "Maps").
 *
 * mountAmenityMap(canvas, { onPick(id) }) →
 *   update({ amenities, point, radiusMeters, refit })  draws the amenities, the spot and its radius
 *   highlight(id, { pan, popup })                       rings one amenity (null: none), and opens its popup
 *   invalidate()                                        after the frame changes size
 */
import { mountNearbyMap, YELLOW, INK } from "../maps/nearby-map.js";
import { categoryOf } from "./config.js";
import { milesText } from "./nearby.js";
import { popupHtml, escape } from "./render.js";

export function pinHtml(category) {
  const c = categoryOf(category);
  return `<span class="hn-pin" style="--hn-pin:${c.color}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg></span>`;
}

const pinLabel = (a) => `${a.name}, ${categoryOf(a.category).one}, ${milesText(a.miles)} away`;

export function mountAmenityMap(canvas, { onPick }) {
  const markers = new Map(); // id → marker
  const base = mountNearbyMap(canvas, {
    fallback: "The map couldn’t load. The list below has every amenity.",
    keyOf: (a) => a.id,
    draw(a, { L, layer }) {
      const icon = L.divIcon({ className: "hn-pin-wrap", html: pinHtml(a.category), iconSize: [30, 30], iconAnchor: [15, 15] });
      const label = pinLabel(a);
      const m = L.marker([a.lat, a.lon], { icon, title: label, alt: label, keyboard: false, riseOnHover: true })
        .bindTooltip(escape(a.name), { direction: "top", offset: [0, -14] })
        .bindPopup(popupHtml(a), { offset: [0, -10], maxWidth: 230, autoPanPadding: [16, 16] })
        .on("click", () => onPick(a.id))
        // e.target, not m: Leaflet fires "add" inside addTo(), before m is assigned.
        .on("add", (e) => e.target.getElement()?.setAttribute("aria-label", label))
        .addTo(layer);
      markers.set(a.id, m);
      return [[a.lat, a.lon]];
    },
    // A yellow ring around the pin, and the pin on top of the others.
    drawHalo(a, { L, halo }) {
      L.circleMarker([a.lat, a.lon], { radius: 21, color: INK, weight: 1.5, fillColor: YELLOW, fillOpacity: 0.9, interactive: false }).addTo(halo);
      for (const [id, m] of markers) m.setZIndexOffset(id === a.id ? 1000 : 0);
    }
  });

  function update({ amenities, point, radiusMeters, refit = true }) {
    markers.clear();
    // Farthest first, so the nearest pins draw on top.
    return base.update({ items: [...amenities].reverse(), point, radiusMeters, refit });
  }

  function highlight(id, { pan = false, popup = false } = {}) {
    base.highlight(id, { pan });
    if (popup && id) markers.get(id)?.openPopup();
  }

  return { update, highlight, invalidate: base.invalidate };
}
