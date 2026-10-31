/*
 * The deep dive's small map: where the crash was, and the spot searched
 * from (with its radius) when there was one. Built on the shared nearby
 * map (src/lib/maps/nearby-map.js). Browser only; the "When and where"
 * list next to it is the non-map alternative.
 */
import { mountNearbyMap, INK, YELLOW } from "../maps/nearby-map.js";

export function mountCrashMap(canvas) {
  const base = mountNearbyMap(canvas, {
    fallback: "The map couldn’t load. The street and borough are listed beside it.",
    keyOf: () => "crash",
    draw(c, { L, layer }) {
      L.circleMarker([c.lat, c.lon], { radius: 9, color: INK, weight: 2.5, fillColor: YELLOW, fillOpacity: 1, interactive: false }).addTo(layer);
      return [[c.lat, c.lon]];
    },
    drawHalo() {}
  });
  // spot: { lat, lon, radius } or null
  return (point, spot) => base.update({
    items: [point],
    point: spot ? { lat: spot.lat, lon: spot.lon } : null,
    radiusMeters: spot?.radius ?? null,
    fitTo: spot ? [[point.lat, point.lon]] : null
  });
}
