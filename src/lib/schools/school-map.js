/*
 * Maps for the NYC School Quality Explorer, on the same muted Esri basemap
 * as the drinking water and 311 maps. Leaflet loads on first draw. Browser only.
 *
 * mountSchoolsMap(canvas, { spot }) → { update({ points }) }
 *   Browse page: every matching school as a dot (canvas renderer, so 1,900
 *   points stay fast), with a popup linking to its page. The result list is
 *   the non-map alternative (DESIGN.md "Maps"). With a spot ({ lat, lon },
 *   from the address report's link) the map stays on it, pinned, instead of
 *   fitting every match.
 *   points: [[lat, lon, dbn, name, type slug], ...]
 *
 * mountMiniMap(canvas, { lat, lon, label })  School page: one marker.
 */
import { schoolPath, TYPE_BY_SLUG } from "./config.js";

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

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function baseMap(L, canvas, options = {}) {
  const map = L.map(canvas, { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 17, preferCanvas: true, ...options });
  L.tileLayer(BASE_TILES, { attribution: ATTRIBUTION, maxZoom: 16 }).addTo(map);
  map.createPane("labels").style.zIndex = "450";
  map.getPane("labels").style.pointerEvents = "none";
  L.tileLayer(LABEL_TILES, { pane: "labels", maxZoom: 16 }).addTo(map);
  return map;
}

const FAILED = '<p class="chart-fallback">The map couldn’t load. Use the list instead.</p>';

export function mountSchoolsMap(canvas, { spot = /** @type {{ lat: number, lon: number } | null} */ (null) } = {}) {
  let map = null, layer = null, L = null;
  let request = 0;

  async function update({ points }) {
    const id = ++request;
    try {
      L = await loadLeaflet();
    } catch {
      canvas.innerHTML = FAILED;
      return;
    }
    if (id !== request) return;
    if (!map) {
      map = baseMap(L, canvas);
      layer = L.layerGroup().addTo(map);
      if (spot) {
        L.circleMarker([spot.lat, spot.lon], { radius: 9, color: INK, weight: 3, fillColor: YELLOW, fillOpacity: 1 })
          .bindTooltip("The address", { direction: "top" })
          .addTo(map);
      }
    }
    layer.clearLayers();
    const renderer = L.canvas({ padding: 0.5 });
    for (const [lat, lon, dbn, name, type] of points) {
      L.circleMarker([lat, lon], { renderer, radius: 5, color: "#fff", weight: 1, fillColor: BLUE_DEEP, fillOpacity: 0.85 })
        .bindPopup(`<strong>${escape(name)}</strong><br>${escape(TYPE_BY_SLUG[type]?.label ?? "")} · ${escape(dbn)}<br><a href="${schoolPath(dbn)}">See this school</a>`)
        .addTo(layer);
    }
    map.invalidateSize();
    if (spot) map.setView([spot.lat, spot.lon], 15);
    else if (points.length > 1) map.fitBounds(points.map(([lat, lon]) => [lat, lon]), { padding: [24, 24], maxZoom: 15 });
    else if (points.length === 1) map.setView([points[0][0], points[0][1]], 15);
    else map.fitBounds(NYC_BOUNDS);
  }

  return { update, invalidate: () => map?.invalidateSize() };
}

export async function mountMiniMap(canvas, { lat, lon, label }) {
  let L;
  try {
    L = await loadLeaflet();
  } catch {
    canvas.innerHTML = '<p class="chart-fallback">The map couldn’t load.</p>';
    return;
  }
  const map = baseMap(L, canvas, { dragging: !L.Browser.mobile, tap: false });
  L.circleMarker([lat, lon], { radius: 8, color: INK, weight: 3, fillColor: YELLOW, fillOpacity: 1 })
    .bindTooltip(escape(label), { direction: "top" })
    .addTo(map);
  map.setView([lat, lon], 15);
}
