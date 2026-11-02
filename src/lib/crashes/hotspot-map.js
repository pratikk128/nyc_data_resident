/*
 * NYC Crash Hotspots' map, in two views of the same place and filters:
 *   "crashes"  a heat layer of crashes per ~165 m square (/api/crash-hotspots/map cells)
 *   "ksi"      a dot per crash that seriously hurt or killed someone; killed is a
 *              larger dot with an ink ring, so it doesn't rest on color alone.
 *              Each opens a popup that links to the crash in NYC Crash Lookup.
 * Leaflet and Leaflet.heat load on first draw (complaints311/heatmap.js).
 * Browser only. The intersections table is the non-map alternative.
 *
 * mountHotspotMap(canvas) → { update({ cells, points, area }), setView(view) }
 */
import { loadLeaflet, heatMax } from "../complaints311/heatmap.js";
import { escape } from "./render.js";
import { CELL_LAT, CELL_LON } from "./facts.js";
import { date } from "../format.js";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const BASE_TILES = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABEL_TILES = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const GRADIENT = { 0.2: "#A9CBFF", 0.45: "#1F4FB8", 0.7: "#FFE27A", 1: "#F28C38" };
const HEAT_RADIUS = 12, HEAT_BLUR = 14;
const INK = "#1C2A44";
const KILLED = "#B3261E";   // --red-deep
const SERIOUS = "#F28C38";  // the ramp's orange
const NYC_BOUNDS = [[40.49, -74.26], [40.92, -73.69]];

export function mountHotspotMap(canvas) {
  let L = null, map = null, heat = null, dots = null, ring = null, renderer = null;
  let data = null, view = "crashes", request = 0;

  function drawLayers() {
    if (!map || !data) return;
    heat.setLatLngs([]);
    dots.clearLayers();
    if (view === "crashes") {
      // As in the 311 heatmap: scale `max` by how many grid squares share one of the layer's bins at this zoom.
      const c = map.getCenter();
      const a = map.latLngToContainerPoint(c);
      const b = map.latLngToContainerPoint([c.lat + CELL_LAT, c.lng + CELL_LON]);
      const bin = (HEAT_RADIUS + HEAT_BLUR) / 2;
      const perBin = Math.max(1, (bin * bin) / Math.max(1e-6, Math.abs(b.x - a.x) * Math.abs(b.y - a.y)));
      heat.setOptions({ max: heatMax(data.cells) * Math.min(perBin, 25), maxZoom: map.getZoom() });
      // Leaflet reads [lat, lon, intensity]; a fourth value (the serious count) makes it no point at all.
      heat.setLatLngs(data.cells.map(([lat, lon, n]) => [lat, lon, n]));
      return;
    }
    // Serious first, so killed sits on top.
    const sorted = [...data.points].sort((p, q) => p[2] - q[2]);
    for (const [lat, lon, severity, id, day, label] of sorted) {
      const killed = severity === 3;
      L.circleMarker([lat, lon], {
        renderer, radius: killed ? 6.5 : 4.5, weight: killed ? 2 : 1, color: killed ? INK : "#fff",
        fillColor: killed ? KILLED : SERIOUS, fillOpacity: 0.95
      }).bindPopup(`<p class="hs-pop"><strong>${killed ? "Someone was killed" : "Someone was seriously hurt"}</strong><br>
        ${escape(date(day))}${label ? `<br>${escape(label)}` : ""}<br>
        <a href="/crash-lookup/?crash=${encodeURIComponent(id)}">See the crash report details</a></p>`).addTo(dots);
    }
  }

  function fit(area) {
    if (area?.kind === "point") {
      map.fitBounds(L.latLng(area.lat, area.lon).toBounds(area.radius * 2.4), { padding: [8, 8] });
    } else if (area && data.cells.length) {
      map.fitBounds(L.latLngBounds(data.cells.map((c) => [c[0], c[1]])), { padding: [16, 16], maxZoom: 16 });
    } else {
      map.fitBounds(NYC_BOUNDS);
    }
  }

  return {
    async update({ cells, points, area }) {
      const id = ++request;
      try {
        L = await loadLeaflet();
      } catch {
        canvas.innerHTML = '<p class="chart-fallback">The map couldn’t load. The intersections below list the same places.</p>';
        return;
      }
      if (id !== request) return;
      data = { cells, points };
      if (!map) {
        map = L.map(canvas, { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 17 });
        map.fitBounds(NYC_BOUNDS);
        L.tileLayer(BASE_TILES, { attribution: ATTRIBUTION, maxZoom: 17 }).addTo(map);
        map.createPane("labels").style.zIndex = "450"; // street names above the heat
        L.tileLayer(LABEL_TILES, { pane: "labels", maxZoom: 17 }).addTo(map);
        renderer = L.canvas({ tolerance: 6 });
        heat = L.heatLayer([], { radius: HEAT_RADIUS, blur: HEAT_BLUR, minOpacity: 0.2, gradient: GRADIENT }).addTo(map);
        dots = L.layerGroup().addTo(map);
        ring = L.layerGroup().addTo(map);
        map.on("zoomend", () => { if (view === "crashes") drawLayers(); });
      }
      ring.clearLayers();
      if (area?.kind === "point") {
        L.circle([area.lat, area.lon], { radius: area.radius, color: INK, weight: 2, dashArray: "5 4", fill: false, interactive: false }).addTo(ring);
      }
      map.invalidateSize();
      fit(area);
      drawLayers();
    },
    setView(next) {
      view = next;
      drawLayers();
    }
  };
}
