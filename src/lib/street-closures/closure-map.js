/*
 * Map of closed blocks, on the same muted Esri basemap as the other maps.
 * Leaflet loads on first draw. Browser only. Each block is a line colored by
 * its status, with a dash pattern too so the color is never alone:
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
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const BASE_TILES = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABEL_TILES = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const INK = "#1C2A44";
const YELLOW = "#FFE27A";
const NYC_BOUNDS = [[40.49, -74.26], [40.92, -73.69]];

// The basemap stays light in both themes, so these fixed colors work in both.
export const STATE_STYLES = {
  active: { color: "#B3261E", dashArray: null, label: "Active now" },
  soon: { color: "#D98A00", dashArray: "8 5", label: "Starts within 3 days" },
  later: { color: "#1F4FB8", dashArray: "2 5", label: "Starts later" }
};

let leaflet = null;
function loadLeaflet() {
  leaflet ??= Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]).then(([m]) => m.default);
  return leaflet;
}

export function mountClosureMap(canvas, { onPick }) {
  let map = null, layer = null, halo = null, L = null, renderer = null;
  let request = 0;
  let byseg = new Map(); // seg → { line, block }
  let highlighted = null;

  const styleFor = (state, on = false) => ({
    color: STATE_STYLES[state].color,
    dashArray: on ? null : STATE_STYLES[state].dashArray,
    weight: on ? 7 : 4,
    opacity: 0.95,
    lineCap: "round"
  });

  async function update({ blocks, point, radiusMeters, refit = true, title = (b) => b.on }) {
    const id = ++request;
    try {
      L = await loadLeaflet();
    } catch {
      canvas.innerHTML = '<p class="chart-fallback">The map couldn’t load. The list has every closure.</p>';
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
    byseg = new Map();
    highlighted = null;

    // Later first, so active closures draw on top.
    const order = { later: 0, soon: 1, active: 2 };
    const sorted = [...blocks].sort((a, b) => order[a.status.state] - order[b.status.state]);
    const bounds = [];
    for (const b of sorted) {
      const line = L.polyline(b.lines, { renderer, ...styleFor(b.status.state) })
        .bindTooltip(title(b), { sticky: true })
        .on("click", () => onPick(b.seg))
        .addTo(layer);
      byseg.set(b.seg, { line, block: b });
      for (const l of b.lines) bounds.push(...l);
    }
    if (point) {
      if (radiusMeters) {
        L.circle([point.lat, point.lon], { radius: radiusMeters, color: INK, weight: 1.5, dashArray: "4 4", fill: false, interactive: false }).addTo(layer);
      }
      L.circleMarker([point.lat, point.lon], { radius: 7, color: YELLOW, weight: 3, fillColor: INK, fillOpacity: 1, interactive: false }).addTo(layer);
    }

    map.invalidateSize();
    if (!refit) return;
    if (point && radiusMeters) map.fitBounds(L.latLng(point.lat, point.lon).toBounds(radiusMeters * 2.2));
    else if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    else map.fitBounds(NYC_BOUNDS);
  }

  function highlight(seg, { pan = false } = {}) {
    if (!map) return;
    if (highlighted === seg && !pan) return;
    halo.clearLayers();
    highlighted = seg;
    const hit = seg && byseg.get(seg);
    if (!hit) return;
    const { block } = hit;
    // A yellow outline under a thicker copy of the line, on top of everything.
    L.polyline(block.lines, { renderer, color: YELLOW, weight: 13, opacity: 1, lineCap: "round", interactive: false }).addTo(halo);
    L.polyline(block.lines, { renderer, ...styleFor(block.status.state, true), interactive: false }).addTo(halo);
    if (pan) {
      const b = L.latLngBounds(block.lines.flat());
      if (!map.getBounds().contains(b)) map.fitBounds(b, { maxZoom: Math.max(map.getZoom(), 15), padding: [40, 40] });
    }
  }

  return { update, highlight, invalidate: () => map?.invalidateSize() };
}
