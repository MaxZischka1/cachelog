/** Clean up a finger-drawn outline: drop jitter, keep the shape. Pure. */

type P = [number, number];

function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker: keep only the points that bend the line by more than `tol`. */
export function simplifyLine<T extends P>(pts: T[], tol: number): T[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1, bestD = tol;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * A drag becomes a closed area: simplified, at least 3 corners, not closed twice. Returns null for
 * a scribble too small to be an area (under `minSpan` across).
 */
export function lassoToRing<T extends P>(pts: T[], tol: number, minSpan: number): T[] | null {
  if (pts.length < 3) return null;
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  if (Math.max(x2 - x1, y2 - y1) < minSpan) return null;
  let ring = simplifyLine(pts, tol);
  const a = ring[0], b = ring[ring.length - 1];
  if (ring.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol) ring = ring.slice(0, -1);
  return ring.length >= 3 ? ring : null;
}
