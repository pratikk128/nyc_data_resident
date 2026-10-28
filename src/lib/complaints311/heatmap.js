/*
 * "Where complaints happen near you": placeholder until the map is built.
 * The rest of the page only calls mountHeatmap() and update(), so the map
 * can be dropped in here without touching anything else.
 *
 * @typedef {Object} HeatmapProps
 * @property {{ lat: number, lon: number }} center   Middle of the map
 * @property {number} radiusMeters                     Area shown (default: the 1 mile neighborhood)
 * @property {{ since: string, through: string }} dateRange   YYYY-MM-DD, created_date
 * @property {string[]} complaintTypes                 Filter options: the area's top complaint types (typeKey() values)
 * @property {string[]} [selectedTypes]                Types ticked in the filter; empty means all
 * @property {(selected: string[]) => void} onComplaintTypeChange   Called when the filter changes
 *
 * TODO(map): replace the empty container with a heatmap of request locations:
 *   - Data: a new API route (all SoQL in soql.js) that aggregates server-side,
 *     e.g. $select=snap_to_grid(location, <precision>) AS cell, count(*) AS n
 *     $where=<window> AND within_circle(location, lat, lon, radiusMeters)
 *       [AND complaint_type IN (...selected)]  $group=cell
 *     so the browser gets a few thousand weighted points, never raw rows.
 *   - Draw: Leaflet + Leaflet.heat (or deck.gl HeatmapLayer) on a muted basemap,
 *     the 1 mile circle as the view and the ¼ mile circle outlined (RADII in config.js).
 *   - Refetch when selectedTypes or dateRange change; keep the ranked list on the
 *     page as the non-map alternative (DESIGN.md "Maps").
 */
import { typeLabel } from "./labels.js";
import { escape } from "./render.js";

/*
 * root: the [data-heatmap] element from HeatmapPlaceholder.astro.
 * Returns { update(props) }.
 */
export function mountHeatmap(root) {
  const filter = root.querySelector("[data-heatmap-filter]");
  const options = root.querySelector("[data-heatmap-options]");
  const status = root.querySelector("[data-heatmap-status]");
  let props = null;

  options.addEventListener("change", () => {
    const selected = Array.from(options.querySelectorAll("input:checked")).map((i) => i.value);
    props = { ...props, selectedTypes: selected };
    status.textContent = selected.length
      ? `Filter set to ${selected.length} ${selected.length === 1 ? "type" : "types"}. The map will use it once it’s built.`
      : "Showing all complaint types.";
    props.onComplaintTypeChange?.(selected);
  });

  return {
    /** @param {HeatmapProps | null} next  null hides the section (no point to center on) */
    update(next) {
      props = next;
      root.hidden = !next;
      if (!next) return;
      const selected = new Set(next.selectedTypes ?? []);
      filter.hidden = !next.complaintTypes.length;
      options.innerHTML = next.complaintTypes.map((key, i) => (
        `<label class="pay-chip c311-chip"><input type="checkbox" name="heatmap-type" value="${escape(key)}"` +
        `${selected.has(key) ? " checked" : ""} id="hm-type-${i}"/>${escape(typeLabel(key))}</label>`
      )).join("");
    }
  };
}
