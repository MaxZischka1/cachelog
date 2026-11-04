/**
 * Pure geo helpers for the map module. No React Native imports (runs under Jest).
 * Kept private to src/map so this module does not depend on core/plan.
 */
import type { Block, LngLat, PlanContent } from '../core/types';

/** [south-west, north-east] corners. */
export type Bounds = [LngLat, LngLat];

const M_PER_DEG_LAT = 111_320;

export function isValidLngLat(p: unknown): p is LngLat {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}

/** Walks arbitrarily nested GeoJSON coordinate arrays and collects positions. */
function collectCoords(coords: unknown, out: LngLat[]): void {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === 'number') {
    if (isValidLngLat(coords)) out.push([coords[0], coords[1]]);
    return;
  }
  for (const c of coords) collectCoords(c, out);
}

/** Every position that should be visible when the block is shown. */
export function collectBlockPoints(block: Block, plan: PlanContent | null): LngLat[] {
  const pts: LngLat[] = [];
  for (const layer of block.layers ?? []) {
    if (layer.kind === 'raster') {
      for (const c of layer.corners ?? []) if (isValidLngLat(c)) pts.push(c);
    } else if (layer.kind === 'vector') {
      for (const f of layer.geojson?.features ?? []) {
        if (f?.geometry) collectCoords(f.geometry.coordinates, pts);
      }
    }
  }
  if (plan) {
    for (const p of plan.pieces ?? []) for (const c of p.polygon ?? []) if (isValidLngLat(c)) pts.push(c);
    for (const c of plan.caches ?? []) if (isValidLngLat(c.position)) pts.push(c.position);
    for (const h of plan.hazards ?? []) for (const c of h.geometry ?? []) if (isValidLngLat(c)) pts.push(c);
  }
  return pts;
}

export function boundsOf(points: LngLat[]): Bounds | null {
  if (points.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}

/** Bounding box covering raster corners, vector layers, pieces, caches and hazards; null if nothing. */
export function blockBounds(block: Block, plan: PlanContent | null): Bounds | null {
  return boundsOf(collectBlockPoints(block, plan));
}

/** Expands bounds by `meters` on every side (clamped to valid lat/lng). */
export function padBounds(b: Bounds, meters: number): Bounds {
  const [[w, s], [e, n]] = b;
  const midLat = (s + n) / 2;
  const dLat = meters / M_PER_DEG_LAT;
  const cos = Math.max(Math.cos((midLat * Math.PI) / 180), 0.01);
  const dLng = meters / (M_PER_DEG_LAT * cos);
  return [
    [Math.max(-180, w - dLng), Math.max(-85, s - dLat)],
    [Math.min(180, e + dLng), Math.min(85, n + dLat)],
  ];
}

/** Ensures the box is at least `minMeters` across in both directions (single cache, tiny piece). */
export function ensureMinSize(b: Bounds, minMeters: number): Bounds {
  const [[w, s], [e, n]] = b;
  const midLat = (s + n) / 2;
  const cos = Math.max(Math.cos((midLat * Math.PI) / 180), 0.01);
  const widthM = (e - w) * M_PER_DEG_LAT * cos;
  const heightM = (n - s) * M_PER_DEG_LAT;
  const padM = Math.max(0, (minMeters - Math.min(widthM, heightM)) / 2);
  return padM > 0 ? padBounds(b, padM) : b;
}

/** MapLibre RN v11 flat bounds: [west, south, east, north]. */
export function toLngLatBounds(b: Bounds): [number, number, number, number] {
  return [b[0][0], b[0][1], b[1][0], b[1][1]];
}

/** Area-weighted centroid of a ring (planar, fine at block scale); falls back to vertex mean. */
export function ringCentroid(ring: LngLat[]): LngLat | null {
  const pts = ring.filter(isValidLngLat);
  if (pts.length === 0) return null;
  let a = 0, cx = 0, cy = 0;
  const x0 = pts[0][0], y0 = pts[0][1]; // shift for numeric stability
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const ax = x1 - x0, ay = y1 - y0, bx = x2 - x0, by = y2 - y0;
    const cross = ax * by - bx * ay;
    a += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (Math.abs(a) < 1e-14) {
    const sx = pts.reduce((t, p) => t + p[0], 0);
    const sy = pts.reduce((t, p) => t + p[1], 0);
    return [sx / pts.length, sy / pts.length];
  }
  return [cx / (3 * a) + x0, cy / (3 * a) + y0];
}

/** Closes a ring for GeoJSON (repeats first point if needed). */
export function closeRing(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) return ring;
  const f = ring[0], l = ring[ring.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? ring.slice() : [...ring, f];
}
