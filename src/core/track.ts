/**
 * GPS shift tracks: cleaning, distance, simplifying for sharing, and the ground a planter covered.
 * Pure.
 *
 * "Covered" is the walked path widened to the planter's swath (their tree spacing): a planter
 * working a line plants a strip about one spacing wide. It is an estimate of planted ground,
 * the same idea Blockline uses, not a count of trees.
 */
import { pointInPolygon } from './plan/geo';
import type { LngLat, Prescription } from './types';

export interface TrackPoint {
  /** Milliseconds since epoch. */
  t: number;
  lng: number;
  lat: number;
  /** Horizontal accuracy, metres. */
  acc?: number;
}

/** Local flat projection in metres around `origin` (fine for a block a few km across). */
function projector(origin: LngLat) {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  const ky = 110_574;
  return {
    to: (p: LngLat): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    from: (x: number, y: number): LngLat => [origin[0] + x / kx, origin[1] + y / ky],
  };
}

const metres = (a: TrackPoint, b: TrackPoint) => {
  const { to } = projector([a.lng, a.lat]);
  const [x, y] = to([b.lng, b.lat]);
  return Math.hypot(x, y);
};

export interface CleanOptions {
  /** Fixes worse than this are dropped. */
  maxAccuracyM?: number;
  /** Faster than this from the last kept fix is a GPS jump (or a truck ride), dropped. */
  maxSpeedMps?: number;
}

/** Drops poor fixes and jumps; keeps time order. */
export function cleanTrack(points: TrackPoint[], opts: CleanOptions = {}): TrackPoint[] {
  const maxAcc = opts.maxAccuracyM ?? 25;
  const maxSpeed = opts.maxSpeedMps ?? 4;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: TrackPoint[] = [];
  for (const p of sorted) {
    if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue;
    if (p.acc !== undefined && p.acc > maxAcc) continue;
    const last = out[out.length - 1];
    if (last) {
      const dt = (p.t - last.t) / 1000;
      if (dt <= 0) continue;
      if (metres(last, p) / dt > maxSpeed) continue;
    }
    out.push(p);
  }
  return out;
}

/** Breaks between fixes longer than this are not bridged (no signal, or the tracker paused). */
const MAX_GAP_MS = 2 * 60_000;
const MAX_GAP_M = 40;

/** The track split where it has gaps, as lines of [lng, lat]. */
export function trackLines(points: TrackPoint[]): LngLat[][] {
  const lines: LngLat[][] = [];
  let cur: LngLat[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const q = points[i - 1];
      if (p.t - q.t > MAX_GAP_MS || metres(q, p) > MAX_GAP_M) {
        if (cur.length) lines.push(cur);
        cur = [];
      }
    }
    cur.push([p.lng, p.lat]);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export function trackDistanceM(points: TrackPoint[]): number {
  let d = 0;
  for (const line of trackLines(points)) {
    const { to } = projector(line[0]);
    for (let i = 1; i < line.length; i++) {
      const [x1, y1] = to(line[i - 1]);
      const [x2, y2] = to(line[i]);
      d += Math.hypot(x2 - x1, y2 - y1);
    }
  }
  return d;
}

/** Douglas–Peucker: the line with no point further than `toleranceM` from the original. */
export function simplifyLine(line: LngLat[], toleranceM: number): LngLat[] {
  if (line.length <= 2) return [...line];
  const { to } = projector(line[0]);
  const xy = line.map(to);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > toleranceM) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** Swath for coverage: the prescription's spacing, else from its density, else 3 m. */
export function swathM(rx: Prescription | undefined): number {
  if (rx?.spacingM && rx.spacingM > 0) return rx.spacingM;
  if (rx?.densityPerHa && rx.densityPerHa > 0) return Math.sqrt(10_000 / rx.densityPerHa);
  return 3;
}

export interface Coverage {
  /** Ground covered, hectares. */
  ha: number;
  /** Covered hectares inside a polygon (e.g. the planter's piece). */
  haIn: (ring: LngLat[]) => number;
}

/**
 * Ground covered by the lines widened to `swath` metres, on a grid of cells (about a third of the
 * swath, at least 0.5 m). Overlapping passes are counted once.
 */
export function coverage(lines: LngLat[][], swath: number): Coverage {
  const pts = lines.flat();
  if (!pts.length || !(swath > 0)) return { ha: 0, haIn: () => 0 };
  const proj = projector(pts[0]);
  const xy = lines.map((l) => l.map(proj.to));
  const r = swath / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of xy.flat()) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  minX -= r; minY -= r; maxX += r; maxY += r;
  let cell = Math.max(0.5, swath / 3);
  // Keep the grid within ~4 million cells (4 MB) however long the shift was.
  while (((maxX - minX) / cell) * ((maxY - minY) / cell) > 4_000_000) cell *= 1.5;
  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const ny = Math.ceil((maxY - minY) / cell) + 1;
  const grid = new Uint8Array(nx * ny);
  const rc = r / cell;
  const stamp = (x: number, y: number) => {
    const cx = (x - minX) / cell, cy = (y - minY) / cell;
    for (let j = Math.max(0, Math.floor(cy - rc)); j <= Math.min(ny - 1, Math.ceil(cy + rc)); j++) {
      for (let i = Math.max(0, Math.floor(cx - rc)); i <= Math.min(nx - 1, Math.ceil(cx + rc)); i++) {
        const ddx = i + 0.5 - cx, ddy = j + 0.5 - cy;
        if (ddx * ddx + ddy * ddy <= rc * rc) grid[j * nx + i] = 1;
      }
    }
  };
  for (const line of xy) {
    stamp(line[0][0], line[0][1]);
    for (let k = 1; k < line.length; k++) {
      const [x1, y1] = line[k - 1], [x2, y2] = line[k];
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (cell / 2)));
      for (let s = 1; s <= steps; s++) stamp(x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps);
    }
  }
  let n = 0;
  for (let k = 0; k < grid.length; k++) n += grid[k];
  const cellHa = (cell * cell) / 10_000;
  return {
    ha: n * cellHa,
    haIn: (ring) => {
      if (ring.length < 3) return 0;
      let m = 0;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (!grid[j * nx + i]) continue;
          if (pointInPolygon(proj.from(minX + (i + 0.5) * cell, minY + (j + 0.5) * cell), ring)) m++;
        }
      }
      return m * cellHa;
    },
  };
}
