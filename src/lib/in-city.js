/*
 * Is a spot inside New York City? Every "Use my location", spot in a URL and
 * API that takes a lat/lon checks with this, so a spot in Jersey City,
 * Hoboken, Fort Lee or Nassau is turned away instead of searched.
 *
 * It checks the outline's bounding box first, then the outline itself
 * (src/data/nyc-outline.json, rivers and harbor included out to the state
 * line, about 20 m accurate).
 */
import outline from "../data/nyc-outline.json" with { type: "json" };

const lons = outline.rings.flat().map(([lon]) => lon);
const lats = outline.rings.flat().map(([, lat]) => lat);
const box = { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) };

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const inCityLimits = (lat, lon) =>
  lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east &&
  outline.rings.some((ring) => inRing(lon, lat, ring));
