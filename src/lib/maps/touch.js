/*
 * Phones: one finger scrolls the page, two fingers move and zoom the map.
 * Most maps fill the screen width, so with one-finger dragging a swipe down
 * the page would get stuck panning the map. Leaflet's pinch also pans
 * (TouchZoom), so nothing is lost. A one-finger swipe on the map briefly
 * says how to move it.
 *
 *   L.map(canvas, { ...touchOptions(L), ... })
 *   addTouchHint(map)   after the map is made
 */
export const touchOptions = (L) => ({ dragging: !L.Browser.mobile });

export function addTouchHint(map) {
  if (map.dragging.enabled()) return;
  const hint = document.createElement("p");
  hint.className = "map-touch-hint";
  hint.setAttribute("aria-hidden", "true"); // touch only; screen readers use the list
  hint.textContent = "Use two fingers to move the map";
  const container = map.getContainer();
  container.append(hint);
  let timer = 0;
  container.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) {
      hint.classList.remove("is-shown");
      return;
    }
    hint.classList.add("is-shown");
    clearTimeout(timer);
    timer = setTimeout(() => hint.classList.remove("is-shown"), 1500);
  }, { passive: true });
}
