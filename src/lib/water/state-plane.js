/*
 * New York State Plane, Long Island zone, US survey feet (EPSG:2263) → lat/lon.
 * Inverse Lambert Conformal Conic (2SP) on the GRS80 ellipsoid, following
 * EPSG Guidance Note 7-2. NAD83 and WGS84 differ by about a meter here, which
 * doesn't matter for a map of sampling stations.
 */
const A = 6378137;
const F = 1 / 298.257222101;
const E = Math.sqrt(2 * F - F * F);
const RAD = Math.PI / 180;
const FT = 1200 / 3937; // US survey foot in meters

const LAT1 = (41 + 2 / 60) * RAD;   // standard parallels
const LAT2 = (40 + 40 / 60) * RAD;
const LAT0 = (40 + 10 / 60) * RAD;  // latitude of origin
const LON0 = -74 * RAD;
const FALSE_EASTING = 300000;       // meters

const m = (phi) => Math.cos(phi) / Math.sqrt(1 - E * E * Math.sin(phi) ** 2);
const t = (phi) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);

const N = (Math.log(m(LAT1)) - Math.log(m(LAT2))) / (Math.log(t(LAT1)) - Math.log(t(LAT2)));
const FF = m(LAT1) / (N * t(LAT1) ** N);
const R0 = A * FF * t(LAT0) ** N;

// x, y in US feet → { lat, lon } in degrees.
export function statePlaneToLatLon(x, y) {
  const dx = x * FT - FALSE_EASTING;
  const dy = R0 - y * FT;
  const r = Math.sign(N) * Math.hypot(dx, dy);
  const tt = (r / (A * FF)) ** (1 / N);
  const theta = Math.atan2(dx, dy);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 10; i++) {
    const s = E * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - s) / (1 + s)) ** (E / 2));
  }
  return { lat: phi / RAD, lon: (theta / N + LON0) / RAD };
}
