/*
 * NYC Crash Hotspots' map: the dangerous intersections as numbered pins
 * (the same numbers as the list beside it), and a dot per crash that
 * seriously hurt or killed someone; killed is a larger dot with an ink ring,
 * so it doesn't rest on color alone. Each dot opens a popup that links to the
 * crash in NYC Crash Lookup. A spot gets a dashed circle for its distance.
 * Leaflet loads on first draw (complaints311/heatmap.js). Browser only; the
 * list is the non-map alternative.
 *
 * mountHotspotMap(canvas) → { update({ spots, points, area }), showSpot(i) }
 */
import { loadLeaflet } from "../complaints311/heatmap.js";
import { escape } from "./render.js";
import { boroughLabel } from "../complaints311/config.js";
import { count, date } from "../format.js";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const BASE_TILES = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABEL_TILES = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const INK = "#1C2A44";
const KILLED = "#B3261E";   // --red-deep
const SERIOUS = "#F28C38";
const NYC_BOUNDS = [[40.49, -74.26], [40.92, -73.69]];

export function mountHotspotMap(canvas) {
  let L = null, map = null, dots = null, pins = null, ring = null, renderer = null;
  let markers = [], request = 0;

  function draw({ spots, points, area }) {
    dots.clearLayers();
    pins.clearLayers();
    ring.clearLayers();
    // Serious first, so killed sits on top.
    for (const [lat, lon, severity, id, day, label] of [...points].sort((p, q) => p[2] - q[2])) {
      const killed = severity === 3;
      L.circleMarker([lat, lon], {
        renderer, radius: killed ? 6.5 : 4.5, weight: killed ? 2 : 1, color: killed ? INK : "#fff",
        fillColor: killed ? KILLED : SERIOUS, fillOpacity: 0.95
      }).bindPopup(`<p class="hs-pop"><strong>${killed ? "Someone was killed" : "Someone was seriously hurt"}</strong><br>
        ${escape(date(day))}${label ? `<br>${escape(label)}` : ""}<br>
        <a href="/crash-lookup/?crash=${encodeURIComponent(id)}">See the crash report details</a></p>`).addTo(dots);
    }
    markers = spots.map((c, i) => {
      if (c.lat == null) return null;
      const icon = L.divIcon({ className: "water-pin hs-pin", html: `<span>${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      return L.marker([c.lat, c.lon], { icon, title: `${i + 1}. ${c.label}`, zIndexOffset: 1000 - i })
        .bindPopup(`<p class="hs-pop"><strong>${i + 1}. ${escape(c.label)}</strong><br>${escape(boroughLabel(c.borough) ?? "")}<br>
          ${escape(count(c.hurt))} crash${c.hurt === 1 ? "" : "es"} hurt someone, ${escape(count(c.n))} in all</p>`)
        .addTo(pins);
    });
    if (area?.kind === "point") {
      L.circle([area.lat, area.lon], { radius: area.radius, color: INK, weight: 2, dashArray: "5 4", fill: false, interactive: false }).addTo(ring);
    }
  }

  function fit({ spots, points, area }) {
    if (area?.kind === "point") {
      map.fitBounds(L.latLng(area.lat, area.lon).toBounds(area.radius * 2.4), { padding: [8, 8] });
      return;
    }
    const where = area ? [...spots.filter((c) => c.lat != null).map((c) => [c.lat, c.lon]), ...points.map((p) => [p[0], p[1]])] : [];
    if (where.length) map.fitBounds(L.latLngBounds(where), { padding: [24, 24], maxZoom: 16 });
    else map.fitBounds(NYC_BOUNDS);
  }

  return {
    async update(data) {
      const id = ++request;
      try {
        L = await loadLeaflet();
      } catch {
        canvas.innerHTML = '<p class="chart-fallback">The map couldn’t load. The list of intersections has the same places.</p>';
        return;
      }
      if (id !== request) return;
      if (!map) {
        map = L.map(canvas, { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 17 });
        map.fitBounds(NYC_BOUNDS);
        L.tileLayer(BASE_TILES, { attribution: ATTRIBUTION, maxZoom: 17 }).addTo(map);
        map.createPane("labels").style.zIndex = "450"; // street names above the dots
        L.tileLayer(LABEL_TILES, { pane: "labels", maxZoom: 17 }).addTo(map);
        renderer = L.canvas({ tolerance: 6 });
        dots = L.layerGroup().addTo(map);
        pins = L.layerGroup().addTo(map);
        ring = L.layerGroup().addTo(map);
      }
      map.invalidateSize();
      draw(data);
      fit(data);
    },
    // Center on one numbered intersection and open its popup.
    showSpot(i) {
      const m = markers[i];
      if (!m) return;
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 16));
      m.openPopup();
    }
  };
}
