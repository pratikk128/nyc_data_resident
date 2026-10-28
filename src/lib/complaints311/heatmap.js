/*
 * "Where complaints happen near you": a Leaflet map with a Leaflet.heat layer
 * of request counts per ~50 m cell (/api/311/heatmap), the 1 mile circle as
 * the view and the ¼ mile circle outlined. Leaflet loads only once a place is
 * picked. The ranked lists above stay the non-map alternative (DESIGN.md "Maps").
 *
 * @typedef {Object} HeatmapProps
 * @property {{ lat: number, lon: number }} center   Middle of the map
 * @property {number} radiusMeters                     Area shown (the 1 mile neighborhood)
 * @property {string} window                           "3m" | "12m"
 * @property {{ since: string, through: string }} dateRange   YYYY-MM-DD, created_date
 * @property {string[]} complaintTypes                 Filter options: the area's top complaint types (typeKey() values)
 * @property {string[]} [selectedTypes]                Types ticked in the filter; empty means all
 * @property {(selected: string[]) => void} onComplaintTypeChange   Called when the filter changes
 */
import { typeLabel } from "./labels.js";
import { escape } from "./render.js";
import { RADII, HEATMAP_CELLS_PER_DEGREE } from "./config.js";
import { count } from "../format.js";

// Esri's Light Gray Canvas (no API key): a muted base, and its street names drawn above the heat.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const BASE_TILES = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABEL_TILES = `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Pastel blue → blue-deep → yellow → orange, so the busiest spots stand out on the light basemap.
const GRADIENT = { 0.2: "#A9CBFF", 0.45: "#1F4FB8", 0.7: "#FFE27A", 1: "#F28C38" };
const HEAT_RADIUS = 12, HEAT_BLUR = 14;
const INK = "#1C2A44";
const BLUE_DEEP = "#1F4FB8";

let leaflet = null;
// Leaflet.heat is a plain script that extends the global L.
async function loadLeaflet() {
  leaflet ??= (async () => {
    const [{ default: L }] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
    window.L = L;
    await import("leaflet.heat");
    return L;
  })();
  return leaflet;
}

/*
 * The heat layer's `max`: a high percentile of the cell counts rather than the
 * very busiest cell, so one building with hundreds of calls doesn't wash out the rest.
 */
export function heatMax(cells, pct = 0.98) {
  if (!cells.length) return 1;
  const ns = cells.map((c) => c[2]).sort((a, b) => a - b);
  return Math.max(1, ns[Math.min(ns.length - 1, Math.floor(pct * ns.length))]);
}

/*
 * root: the [data-heatmap] element from HeatmapSection.astro.
 * Returns { update(props) }.
 */
export function mountHeatmap(root) {
  const filter = root.querySelector("[data-heatmap-filter]");
  const options = root.querySelector("[data-heatmap-options]");
  const status = root.querySelector("[data-heatmap-status]");
  const canvas = root.querySelector("[data-heatmap-canvas]");
  let props = null;
  let map = null, heat = null, rings = null;
  let request = 0;
  let controller = null;

  async function draw() {
    const p = props;
    const id = ++request;
    controller?.abort();
    controller = new AbortController();
    const types = p.selectedTypes ?? [];
    status.textContent = "Loading the map…";
    const q = new URLSearchParams({ lat: p.center.lat, lon: p.center.lon, window: p.window });
    if (types.length) q.set("types", types.join("|"));

    let data, L;
    try {
      [L, data] = await Promise.all([
        loadLeaflet(),
        fetch(`/api/311/heatmap?${q}`, { signal: controller.signal }).then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(typeof body?.error === "string" && res.status < 500 ? body.error : "upstream");
          return body;
        })
      ]);
    } catch (err) {
      if (err.name === "AbortError" || id !== request) return;
      status.textContent = err.message !== "upstream" ? err.message : "The map couldn’t load from NYC Open Data. Try again in a minute.";
      return;
    }
    if (id !== request) return;

    const c = [p.center.lat, p.center.lon];
    // The 1 mile circle's box. (L.Circle.getBounds() only works once the circle is on a map.)
    const bounds = L.latLng(c).toBounds(p.radiusMeters * 2);
    // The view has to be set before the heat layer is added; it reads the map's position on add.
    if (!map) {
      map = L.map(canvas, { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 16 });
      map.fitBounds(bounds, { padding: [8, 8] });
      L.tileLayer(BASE_TILES, { attribution: ATTRIBUTION, maxZoom: 16 }).addTo(map);
      map.createPane("labels").style.zIndex = "450"; // above the heat (overlayPane is 400)
      L.tileLayer(LABEL_TILES, { pane: "labels", maxZoom: 16 }).addTo(map);
      heat = L.heatLayer([], { radius: HEAT_RADIUS, blur: HEAT_BLUR, minOpacity: 0.02, gradient: GRADIENT }).addTo(map);
      rings = L.layerGroup().addTo(map);
    }
    rings.clearLayers();
    L.circle(c, { radius: p.radiusMeters, color: BLUE_DEEP, weight: 1.5, dashArray: "5 4", fill: false, interactive: false }).addTo(rings);
    L.circle(c, { radius: RADII.immediate, color: INK, weight: 2, fill: false, interactive: false }).addTo(rings);
    L.circleMarker(c, { radius: 4, color: "#fff", weight: 2, fillColor: INK, fillOpacity: 1, interactive: false }).addTo(rings);
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [8, 8] });

    /*
     * Leaflet.heat sums the points in each (radius + blur) / 2 pixel bin and paints a soft blob
     * per bin, and the blobs overlap; `max` is scaled by how many grid cells fit in a bin at this
     * zoom, so a busy area doesn't go solid on a small (more zoomed out) map.
     * maxZoom: the layer dims points 2× per zoom level below it; at the opening view, full strength.
     */
    const a = map.latLngToContainerPoint(c);
    const b = map.latLngToContainerPoint([c[0] + 1 / HEATMAP_CELLS_PER_DEGREE, c[1] + 1 / HEATMAP_CELLS_PER_DEGREE]);
    const bin = (HEAT_RADIUS + HEAT_BLUR) / 2;
    const cellsPerBin = Math.max(1, (bin * bin) / Math.max(1e-6, Math.abs(b.x - a.x) * Math.abs(b.y - a.y)));
    heat.setOptions({ max: heatMax(data.cells) * cellsPerBin, maxZoom: map.getZoom() });
    heat.setLatLngs(data.cells);

    const which = types.length === 0 ? "all complaint types"
      : types.length === 1 ? typeLabel(types[0])
      : `${types.length} complaint types`;
    status.textContent = data.total
      ? `Showing ${count(data.total)} requests within 1 mile (${which}).`
      : `No requests within 1 mile for ${which}.`;
  }

  options.addEventListener("change", () => {
    const selected = Array.from(options.querySelectorAll("input:checked")).map((i) => i.value);
    props = { ...props, selectedTypes: selected };
    props.onComplaintTypeChange?.(selected);
    draw();
  });

  return {
    /** @param {HeatmapProps | null} next  null hides the section (no point to center on) */
    update(next) {
      props = next;
      root.hidden = !next;
      if (!next) { controller?.abort(); return; }
      const selected = new Set(next.selectedTypes ?? []);
      filter.hidden = !next.complaintTypes.length;
      options.innerHTML = next.complaintTypes.map((key, i) => (
        `<label class="pay-chip c311-chip"><input type="checkbox" name="heatmap-type" value="${escape(key)}"` +
        `${selected.has(key) ? " checked" : ""} id="hm-type-${i}"/>${escape(typeLabel(key))}</label>`
      )).join("");
      draw();
    }
  };
}
