/**
 * Projection between lon/lat and a flat map picture, for the Avenza-style map: the picture is a
 * georeferenced map image (GeoPDF/GeoTIFF) or, without one, a blank sheet fitted around the plan.
 * Positions on the picture are normalised: (0,0) top-left, (1,1) bottom-right. Pure.
 */
import type { LngLat } from '../core/types';
import { applyAffine, fitAffine, type Affine } from '../import/affine';
import { fromWgs84, localUtmFor, toWgs84 } from '../import/crs';

export type Norm = [number, number];

export interface ImageProjection {
  toNorm: (ll: LngLat) => Norm;
  toLngLat: (p: Norm) => LngLat;
  /** Height / width of the picture in ground metres, so the view keeps the right shape. */
  aspect: number;
  /** Ground metres per unit of normalised width, for scale-aware drawing. */
  metresPerWidth: number;
}

function build(frame: string, ground: [number, number][], norm: Norm[]): ImageProjection | null {
  const fwd: Affine | null = fitAffine(ground, norm);
  const inv: Affine | null = fitAffine(norm, ground);
  if (!fwd || !inv) return null;
  const o = applyAffine(inv, [0, 0]), r = applyAffine(inv, [1, 0]), b = applyAffine(inv, [0, 1]);
  const w = Math.hypot(r[0] - o[0], r[1] - o[1]);
  const h = Math.hypot(b[0] - o[0], b[1] - o[1]);
  return {
    toNorm: (ll) => applyAffine(fwd, fromWgs84(frame, ll)),
    toLngLat: (p) => toWgs84(frame, applyAffine(inv, p)),
    aspect: h / w,
    metresPerWidth: w,
  };
}

/** From a raster layer's corners: top-left, top-right, bottom-right, bottom-left. */
export function projectionFromCorners(corners: [LngLat, LngLat, LngLat, LngLat]): ImageProjection | null {
  const c: LngLat = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2];
  const frame = localUtmFor(c);
  const ground = corners.map((p) => fromWgs84(frame, p));
  return build(frame, ground, [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

/** A north-up sheet around these points with a margin; null when there are no points. */
export function projectionAround(points: LngLat[], marginFraction = 0.15, minSizeM = 300): ImageProjection | null {
  const pts = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return null;
  const c: LngLat = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const frame = localUtmFor(c);
  const xy = pts.map((p) => fromWgs84(frame, p));
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of xy) {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const half = Math.max(x2 - x1, y2 - y1, minSizeM) * (0.5 + marginFraction);
  const ground: [number, number][] = [[cx - half, cy + half], [cx + half, cy + half], [cx + half, cy - half], [cx - half, cy - half]];
  return build(frame, ground, [[0, 0], [1, 0], [1, 1], [0, 1]]);
}
