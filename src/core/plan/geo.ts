import type { LngLat } from '../types';

/** Mean Earth radius (IUGG), metres. Used for haversine distance. */
const R_MEAN = 6371008.8;
/** WGS84 ellipsoid. */
const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle (haversine) distance in metres. Within ~0.5% of the ellipsoidal distance. */
export function distanceM(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const dφ = φ2 - φ1;
  const dλ = toRad(b[0] - a[0]);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R_MEAN * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees, 0 = north, clockwise, in [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const dλ = toRad(b[0] - a[0]);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const deg = toDeg(Math.atan2(y, x));
  return ((deg % 360) + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** 8-point compass direction for a bearing in degrees (any value; wraps). */
export function compass(bearing: number): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' {
  if (!Number.isFinite(bearing)) return 'N';
  const b = ((bearing % 360) + 360) % 360;
  return POINTS[Math.round(b / 45) % 8];
}

/** Ellipsoidal radii of curvature at latitude φ (radians): meridional M, prime vertical N. */
function radii(φ: number): { M: number; N: number } {
  const s = Math.sin(φ);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  return { M: (WGS84_A * (1 - WGS84_E2)) / (w * w * w), N: WGS84_A / w };
}

/** Drop a repeated closing vertex, if present. */
function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length > 1) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) return ring.slice(0, -1);
  }
  return ring;
}

/**
 * Project a ring to local metres around its mean point.
 * y: meridian distance using the meridional radius at the reference latitude.
 * x: longitude offset scaled by N·cos(φ) at each vertex's own latitude (a local
 * sinusoidal projection, equal-area on the sphere). For blocks a few km across
 * the area error is far below 0.1%.
 */
function project(ring: LngLat[]): { pts: [number, number][]; lon0: number; lat0: number } {
  const n = ring.length;
  let lon0 = 0;
  let lat0 = 0;
  // Handle antimeridian: unwrap longitudes relative to the first vertex.
  const lons = ring.map((p) => p[0]);
  for (let i = 1; i < n; i++) {
    while (lons[i] - lons[0] > 180) lons[i] -= 360;
    while (lons[i] - lons[0] < -180) lons[i] += 360;
  }
  for (let i = 0; i < n; i++) {
    lon0 += lons[i];
    lat0 += ring[i][1];
  }
  lon0 /= n;
  lat0 /= n;
  const { M } = radii(toRad(lat0));
  const pts = ring.map((p, i): [number, number] => {
    const φ = toRad(p[1]);
    const { N } = radii(φ);
    return [toRad(lons[i] - lon0) * N * Math.cos(φ), toRad(p[1] - lat0) * M];
  });
  return { pts, lon0, lat0 };
}

function unproject(x: number, y: number, lon0: number, lat0: number): LngLat {
  const { M } = radii(toRad(lat0));
  const lat = lat0 + toDeg(y / M);
  const φ = toRad(lat);
  const { N } = radii(φ);
  const c = N * Math.cos(φ);
  let lon = lon0 + (c > 1e-9 ? toDeg(x / c) : 0);
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [lon, lat];
}

/** Area of a polygon ring in hectares (ring may or may not repeat its first point). */
export function polygonAreaHa(ring: LngLat[]): number {
  const r = openRing(ring);
  if (r.length < 3) return 0;
  const { pts } = project(r);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2 / 10000;
}

/** Area-weighted centroid of a ring. Falls back to the vertex mean for degenerate rings. */
export function centroid(ring: LngLat[]): LngLat {
  const r = openRing(ring);
  if (r.length === 0) return [NaN, NaN];
  if (r.length === 1) return [r[0][0], r[0][1]];
  const { pts, lon0, lat0 } = project(r);
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const c = x1 * y2 - x2 * y1;
    a2 += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  if (Math.abs(a2) < 1e-6) {
    // Degenerate (line or repeated points): mean of projected vertices.
    let mx = 0;
    let my = 0;
    for (const [x, y] of pts) {
      mx += x;
      my += y;
    }
    return unproject(mx / pts.length, my / pts.length, lon0, lat0);
  }
  return unproject(cx / (3 * a2), cy / (3 * a2), lon0, lat0);
}

/** Ray-casting point-in-polygon test. Points exactly on an edge may go either way. */
export function pointInPolygon(p: LngLat, ring: LngLat[]): boolean {
  const r = openRing(ring);
  if (r.length < 3) return false;
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
