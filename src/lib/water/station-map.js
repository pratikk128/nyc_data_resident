/*
 * "What about near me?": a Leaflet map of sampling stations, on the same
 * muted Esri basemap as the 311 heat map. Leaflet loads on first draw.
 * Selected stations are drawn larger in yellow with their number (1–3); a
 * searched spot is a small ink dot. The station dropdown is the non-map
 * alternative (DESIGN.md "Maps").
 *
 * mountStationMap(canvas, { onPick(site) }) → { update({ stations, selected, point, refit }) }
 *   stations  [{ site, place, lat, lon }] to show
 *   selected  site codes, in order
 *   point     { lat, lon, label } or null
 *   refit     true to zoom to the search or stations again; otherwise the
 *             reader's view stays (the first draw always fits)
 */
import { escape } from "./near-me.js";

// Esri has tiles up to zoom 16 only (past it: "Map data not yet available"), so
// tile layers keep the map's maxZoom and enlarge zoom-16 tiles (maxNativeZoom).
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const BASE_TILES = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABEL_TILES = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const INK = "#1C2A44";
const BLUE_DEEP = "#1F4FB8";
const YELLOW = "#FFE27A";
const NYC_BOUNDS = [[40.49, -74.26], [40.92, -73.69]];

let leaflet = null;
function loadLeaflet() {
  leaflet ??= Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]).then(([m]) => m.default);
  return leaflet;
}

export function mountStationMap(canvas, { onPick }) {
  let map = null, layer = null, L = null;
  let request = 0;
  let needsFit = true; // survives a draw that's superseded before Leaflet loads

  async function draw({ stations, selected, point, refit = false }) {
    const id = ++request;
    if (refit) needsFit = true;
    try {
      L = await loadLeaflet();
    } catch {
      canvas.innerHTML = '<p class="chart-fallback">The map couldn’t load. Use the station list above instead.</p>';
      return;
    }
    if (id !== request) return;
    if (!map) {
      map = L.map(canvas, { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 17 });
      L.tileLayer(BASE_TILES, { attribution: ATTRIBUTION, maxZoom: 17, maxNativeZoom: 16 }).addTo(map);
      map.createPane("labels").style.zIndex = "450";
      map.getPane("labels").style.pointerEvents = "none";
      L.tileLayer(LABEL_TILES, { pane: "labels", maxZoom: 17, maxNativeZoom: 16 }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    const picked = new Map(selected.map((s, i) => [s, i + 1]));
    const bounds = [];

    for (const s of stations) {
      if (picked.has(s.site)) continue; // drawn on top below
      const m = L.circleMarker([s.lat, s.lon], {
        radius: 6, color: "#fff", weight: 1.5, fillColor: BLUE_DEEP, fillOpacity: 0.85
      }).addTo(layer);
      m.bindTooltip(`Station ${escape(s.site)}: ${escape(s.place)}`, { direction: "top" });
      m.on("click", () => onPick(s.site));
      bounds.push([s.lat, s.lon]);
    }
    for (const [site, n] of picked) {
      const s = stations.find((x) => x.site === site) ?? null;
      if (!s) continue;
      const icon = L.divIcon({ className: "water-pin", html: `<span>${n}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      L.marker([s.lat, s.lon], { icon, keyboard: false, title: `Station ${s.site} (selected)` })
        .bindTooltip(`${n}. Station ${escape(s.site)}: ${escape(s.place)}`, { direction: "top" })
        .addTo(layer);
      bounds.push([s.lat, s.lon]);
    }
    if (point) {
      L.circleMarker([point.lat, point.lon], { radius: 7, color: YELLOW, weight: 3, fillColor: INK, fillOpacity: 1, interactive: false }).addTo(layer);
    }

    map.invalidateSize();
    const pickedPoints = selected.map((s) => stations.find((x) => x.site === s)).filter(Boolean).map((s) => [s.lat, s.lon]);
    if (needsFit) {
      // Zoom to the search and its stations, else to the borough's stations, else the city.
      needsFit = false;
      const focus = point ? [[point.lat, point.lon], ...pickedPoints] : bounds;
      if (focus.length > 1) map.fitBounds(focus, { padding: [28, 28], maxZoom: 15 });
      else if (focus.length === 1) map.setView(focus[0], 14);
      else map.fitBounds(NYC_BOUNDS);
      return;
    }
    // Otherwise keep the reader's view, widening it only for a picked station that's out of sight.
    const view = map.getBounds();
    const outside = pickedPoints.filter((p) => !view.contains(p));
    if (outside.length) map.fitBounds(view.extend(L.latLngBounds(outside)), { padding: [28, 28], maxZoom: 15 });
  }

  return { update: draw };
}
