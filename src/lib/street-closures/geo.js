/*
 * Distance from a spot to a closed block's line, in meters. At city scale a
 * flat projection around the spot is within a few centimeters of the true
 * distance. Browser-safe.
 */
const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

// point { lat, lon }; line [[lat, lon], ...] → meters to the nearest point on the line
export function distanceToLine(point, line) {
  const kx = Math.cos(point.lat * RAD) * RAD * EARTH_RADIUS;
  const ky = RAD * EARTH_RADIUS;
  const xy = line.map(([lat, lon]) => [(lon - point.lon) * kx, (lat - point.lat) * ky]);
  if (xy.length === 1) return Math.hypot(...xy[0]);
  let best = Infinity;
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1];
    const [bx, by] = xy[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Where the spot (the origin) projects onto the segment, clamped to its ends.
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
