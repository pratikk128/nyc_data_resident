/*
 * The "near a spot" map shared by Street Closures (closure-map.js) and Help
 * Near Me (help-near-me/help-map.js): the muted Esri basemap with its labels
 * on top, the searched spot as an ink dot ringed in yellow, a dashed radius
 * ring, features the caller draws, and a yellow halo on the picked one.
 * Leaflet loads on first draw. Browser only. The page's list is the non-map
 * alternative (DESIGN.md "Maps").
 *
 * mountNearbyMap(canvas, options) →
 *   update({ items, point, radiusMeters, refit, fitTo })  draws the items, the spot and its radius
 *   highlight(key, { pan })                               halos one item (null: none)
 *   invalidate()                                          after the frame changes size
 *
 * options:
 *   draw(item, ctx)       adds the item to ctx.layer → [[lat, lon], ...] (its points, for fitting)
 *   drawHalo(item, ctx)   adds the item's highlight to ctx.halo
 *   keyOf(item)           its key for highlight()
 *   fallback              text when Leaflet can't load
 *   minPickedPx           a picked item smaller than this on screen gets zoomed to (lines); 0 for points
 * ctx: { L, map, layer, halo, renderer } (renderer: a canvas renderer with a wide tap tolerance)
 * fitTo: points to fit instead of the radius (items outside it, say)
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const BASE_TILES = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABEL_TILES = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const INK = "#1C2A44";
export const YELLOW = "#FFE27A";
const NYC_BOUNDS = [[40.49, -74.26], [40.92, -73.69]];

let leaflet = null;
export function loadLeaflet() {
  leaflet ??= Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]).then(([m]) => m.default);
  return leaflet;
}

export function mountNearbyMap(canvas, { draw, drawHalo, keyOf, fallback, minPickedPx = 0 }) {
  let map = null, layer = null, halo = null, L = null, renderer = null;
  let request = 0;
  let byKey = new Map(); // key → { item, points }
  let highlighted = null;
  const ctx = () => ({ L, map, layer, halo, renderer });

  async function update({ items, point, radiusMeters, refit = true, fitTo = null }) {
    const id = ++request;
    try {
      L = await loadLeaflet();
    } catch {
      canvas.innerHTML = `<p class="chart-fallback">${fallback}</p>`;
      return;
    }
    if (id !== request) return;
    if (!map) {
      map = L.map(canvas, { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 18, preferCanvas: true });
      L.tileLayer(BASE_TILES, { attribution: ATTRIBUTION, maxZoom: 16, maxNativeZoom: 16 }).addTo(map);
      map.createPane("labels").style.zIndex = "450";
      map.getPane("labels").style.pointerEvents = "none";
      L.tileLayer(LABEL_TILES, { pane: "labels", maxZoom: 18, maxNativeZoom: 16 }).addTo(map);
      // Wide tolerance so a thin line is easy to tap.
      renderer = L.canvas({ padding: 0.5, tolerance: 8 });
      layer = L.layerGroup().addTo(map);
      halo = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    halo.clearLayers();
    byKey = new Map();
    highlighted = null;

    const bounds = [];
    if (point && radiusMeters) {
      L.circle([point.lat, point.lon], { radius: radiusMeters, color: INK, weight: 1.5, dashArray: "4 4", fill: false, interactive: false }).addTo(layer);
    }
    for (const item of items) {
      const points = draw(item, ctx());
      byKey.set(keyOf(item), { item, points });
      bounds.push(...points);
    }
    if (point) {
      L.circleMarker([point.lat, point.lon], { radius: 7, color: YELLOW, weight: 3, fillColor: INK, fillOpacity: 1, interactive: false }).addTo(layer);
    }

    map.invalidateSize();
    if (!refit) return;
    if (point && fitTo?.length) map.fitBounds([[point.lat, point.lon], ...fitTo], { padding: [28, 28], maxZoom: 16 });
    else if (point && radiusMeters) map.fitBounds(L.latLng(point.lat, point.lon).toBounds(radiusMeters * 2.2));
    else if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    else map.fitBounds(NYC_BOUNDS);
  }

  function highlight(key, { pan = false } = {}) {
    if (!map) return;
    if (highlighted === key && !pan) return;
    halo.clearLayers();
    highlighted = key;
    const hit = key && byKey.get(key);
    if (!hit) return;
    drawHalo(hit.item, ctx());
    if (pan) {
      // Bring it into view; zoom in when it's too small to make out (a block in a borough view on a phone).
      const b = L.latLngBounds(hit.points);
      const px = map.latLngToContainerPoint(b.getNorthEast()).distanceTo(map.latLngToContainerPoint(b.getSouthWest()));
      const small = minPickedPx > 0 && px < minPickedPx;
      if (map.getBounds().contains(b) && !small) return;
      if (b.getNorthEast().equals(b.getSouthWest())) map.panTo(b.getCenter());
      else map.fitBounds(b, { maxZoom: Math.max(map.getZoom(), 16), padding: [40, 40] });
    }
  }

  return { update, highlight, invalidate: () => map?.invalidateSize() };
}
