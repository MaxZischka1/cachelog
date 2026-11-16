import { polygonAreaHa } from './plan';
import { cleanTrack, coverage, simplifyLine, swathM, trackDistanceM, trackLines, type TrackPoint } from './track';
import type { LngLat } from './types';

// Metres east/north of a point near Fort McMurray -> lng/lat.
const O: LngLat = [-114.66, 56.415];
const KX = 111_320 * Math.cos((O[1] * Math.PI) / 180), KY = 110_574;
const at = (e: number, n: number): LngLat => [O[0] + e / KX, O[1] + n / KY];
const pt = (t: number, e: number, nn: number, acc = 5): TrackPoint => ({ t: t * 1000, lng: at(e, nn)[0], lat: at(e, nn)[1], acc });

test('cleanTrack drops bad fixes and jumps', () => {
  const raw = [pt(0, 0, 0), pt(10, 10, 0), pt(20, 20, 0, 80), pt(30, 500, 0), pt(40, 30, 0), pt(35, 25, 0)];
  expect(cleanTrack(raw).map((p) => Math.round((p.lng - O[0]) * KX))).toEqual([0, 10, 25, 30]);
});

test('distance, and gaps are not bridged', () => {
  const walk = [pt(0, 0, 0), pt(30, 30, 0), pt(60, 30, 40)];
  expect(trackDistanceM(walk)).toBeCloseTo(70, 0);
  // Ten minutes without a fix, 30 m away: two lines, the gap is not distance walked.
  const gap = [pt(0, 0, 0), pt(10, 10, 0), pt(610, 40, 0)];
  expect(trackLines(gap)).toHaveLength(2);
  expect(trackDistanceM(gap)).toBeCloseTo(10, 0);
});

test('simplifyLine keeps the shape within tolerance', () => {
  const line = Array.from({ length: 101 }, (_, i) => at(i, i % 2 ? 0.3 : 0)); // straight, with 30 cm jitter
  const s = simplifyLine([...line, at(100, 50)], 1);
  expect(s.length).toBe(3);
});

test('coverage: a 100 m line at 4 m swath is ~0.04 ha; passes overlap once', () => {
  const one = coverage([[at(0, 0), at(100, 0)]], 4);
  expect(one.ha).toBeGreaterThan(0.039);
  expect(one.ha).toBeLessThan(0.0425);
  const twice = coverage([[at(0, 0), at(100, 0), at(0, 0)]], 4);
  expect(twice.ha).toBeCloseTo(one.ha, 3);
  // Lines 4 m apart across a 100 m x 40 m piece cover it (about 0.4 ha).
  const lines: LngLat[][] = [];
  for (let y = 2; y < 40; y += 4) lines.push([at(0, y), at(100, y)]);
  const piece = [at(0, 0), at(100, 0), at(100, 40), at(0, 40)];
  const c = coverage(lines, 4);
  expect(c.haIn(piece) / polygonAreaHa(piece)).toBeGreaterThan(0.95);
  expect(c.haIn([at(200, 0), at(300, 0), at(300, 10)])).toBe(0);
});

test('swath from spacing, density or default', () => {
  expect(swathM({ spacingM: 2.5 })).toBe(2.5);
  expect(swathM({ densityPerHa: 625 })).toBe(4);
  expect(swathM(undefined)).toBe(3);
});
