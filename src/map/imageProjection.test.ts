import { projectionAround, projectionFromCorners } from './imageProjection';
import type { LngLat } from '../core/types';

// Corners of the P20 GeoPDF map page (Alberta, slightly rotated from north).
const corners: [LngLat, LngLat, LngLat, LngLat] = [
  [-117.95262834999035, 57.0448298447658],
  [-117.92042164991335, 57.045590155658715],
  [-117.91828835129819, 57.018459844308786],
  [-117.95047164879799, 57.01770015526719],
];

describe('projectionFromCorners', () => {
  const p = projectionFromCorners(corners)!;

  it('maps the corners to the picture corners', () => {
    const want = [[0, 0], [1, 0], [1, 1], [0, 1]];
    corners.forEach((c, i) => {
      const [x, y] = p.toNorm(c);
      expect(x).toBeCloseTo(want[i][0], 4);
      expect(y).toBeCloseTo(want[i][1], 4);
    });
  });

  it('round-trips a point inside the map', () => {
    const ll: LngLat = [-117.935, 57.03];
    const back = p.toLngLat(p.toNorm(ll));
    expect(back[0]).toBeCloseTo(ll[0], 7);
    expect(back[1]).toBeCloseTo(ll[1], 7);
  });

  it('keeps the page shape (11x17 portrait)', () => {
    expect(p.aspect).toBeCloseTo(1224 / 792, 1);
    expect(p.metresPerWidth).toBeGreaterThan(1500);
    expect(p.metresPerWidth).toBeLessThan(2500);
  });
});

describe('projectionAround', () => {
  it('fits a square sheet around the points with them inside', () => {
    const pts: LngLat[] = [[-118.5, 54.1], [-118.49, 54.105]];
    const p = projectionAround(pts)!;
    for (const q of pts) {
      const [x, y] = p.toNorm(q);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
    expect(p.aspect).toBeCloseTo(1, 5);
    // north is up: the more northern point is higher on the sheet
    expect(p.toNorm(pts[1])[1]).toBeLessThan(p.toNorm(pts[0])[1]);
  });

  it('returns null with nothing to show', () => {
    expect(projectionAround([])).toBeNull();
  });
});
