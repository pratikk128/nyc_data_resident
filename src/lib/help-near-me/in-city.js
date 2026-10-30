/*
 * Is a spot inside New York City? For Help near me's "Use my location", the
 * spot in the URL and the search API.
 *
 * inNyc() (complaints311/location-input.js) is a rough box that also takes in
 * Jersey City, Hoboken, Fort Lee and the edge of Nassau. This checks the box
 * first, then the city's outline (src/data/nyc-outline.json, rivers and
 * harbor included out to the state line, about 20 m accurate).
 */
import { inNyc } from "../complaints311/location-input.js";
import outline from "../../data/nyc-outline.json" with { type: "json" };

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const inCityLimits = (lat, lon) => inNyc(lat, lon) && outline.rings.some((ring) => inRing(lon, lat, ring));
