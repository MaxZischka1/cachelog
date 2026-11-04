import type { LngLat } from '../types';
import { bearingDeg, centroid, compass, distanceM, pointInPolygon, polygonAreaHa } from './geo';
import { ORIGIN, offsetM, rectM } from './testFixtures';

/** Exact WGS84 area (m²) of a lat/lon rectangle, from the authalic-latitude formula. */
function ellipsoidRectAreaM2(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const e = Math.sqrt(e2);
  const b2 = a * a * (1 - e2);
  const q = (deg: number) => {
    const s = Math.sin((deg * Math.PI) / 180);
    return s / (1 - e2 * s * s) + (1 / (2 * e)) * Math.log((1 + e * s) / (1 - e * s));
  };
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  return Math.abs((dl * b2) / 2 * (q(lat2) - q(lat1)));
}

describe('distanceM', () => {
  it('is 0 for the same point', () => {
    expect(distanceM(ORIGIN, ORIGIN)).toBe(0);
  });
  it('one degree of latitude ≈ 111.2 km (mean sphere)', () => {
    expect(distanceM([0, 0], [0, 1])).toBeCloseTo(111195, -1);
  });
  it('London to Paris ≈ 343.5 km (within 0.5%)', () => {
    const d = distanceM([-0.1278, 51.5074], [2.3522, 48.8566]);
    expect(Math.abs(d - 343_500) / 343_500).toBeLessThan(0.005);
  });
  it('matches local metre offsets on a block-sized scale (within 0.5%)', () => {
    const b = offsetM(ORIGIN, 3000, 4000);
    expect(Math.abs(distanceM(ORIGIN, b) - 5000) / 5000).toBeLessThan(0.005);
  });
  it('is symmetric', () => {
    const a: LngLat = [-120.1, 53.2];
    const b: LngLat = [-119.7, 53.9];
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 6);
  });
});

describe('bearingDeg / compass', () => {
  it('cardinal directions', () => {
    expect(bearingDeg(ORIGIN, offsetM(ORIGIN, 0, 1000))).toBeCloseTo(0, 0);
    expect(bearingDeg(ORIGIN, offsetM(ORIGIN, 1000, 0))).toBeCloseTo(90, 0);
    expect(bearingDeg(ORIGIN, offsetM(ORIGIN, 0, -1000))).toBeCloseTo(180, 0);
    expect(bearingDeg(ORIGIN, offsetM(ORIGIN, -1000, 0))).toBeCloseTo(270, 0);
  });
  it('NE at 45°', () => {
    expect(bearingDeg(ORIGIN, offsetM(ORIGIN, 1000, 1000))).toBeCloseTo(45, 0);
  });
  it('always in [0, 360)', () => {
    const b = bearingDeg(ORIGIN, offsetM(ORIGIN, -1, 1000));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
  it('compass sectors and wrap-around', () => {
    expect(compass(0)).toBe('N');
    expect(compass(22)).toBe('N');
    expect(compass(23)).toBe('NE');
    expect(compass(90)).toBe('E');
    expect(compass(135)).toBe('SE');
    expect(compass(180)).toBe('S');
    expect(compass(225)).toBe('SW');
    expect(compass(270)).toBe('W');
    expect(compass(315)).toBe('NW');
    expect(compass(338)).toBe('N');
    expect(compass(359.9)).toBe('N');
    expect(compass(-90)).toBe('W');
    expect(compass(450)).toBe('E');
  });
});

describe('polygonAreaHa', () => {
  it.each([
    [0, 0],
    [49.5, -116],
    [54, -122.5],
    [60, -128],
  ])('lat/lon rectangle at lat %d matches exact ellipsoid area within 0.1%%', (lat, lon) => {
    const lon2 = lon + 0.04; // ~2.6 km at 54°N
    const lat2 = lat + 0.03; // ~3.3 km
    const ring: LngLat[] = [[lon, lat], [lon2, lat], [lon2, lat2], [lon, lat2]];
    const exactHa = ellipsoidRectAreaM2(lon, lat, lon2, lat2) / 10000;
    expect(Math.abs(polygonAreaHa(ring) - exactHa) / exactHa).toBeLessThan(0.001);
  });
  it('1 km × 1 km square ≈ 100 ha', () => {
    expect(polygonAreaHa(rectM(ORIGIN, 1000, 1000))).toBeCloseTo(100, 0);
  });
  it('right triangle is half the rectangle', () => {
    const r = rectM(ORIGIN, 400, 300);
    expect(polygonAreaHa([r[0], r[1], r[2]])).toBeCloseTo(6, 1);
  });
  it('is independent of winding and of a repeated closing point', () => {
    const r = rectM(ORIGIN, 300, 200);
    const a = polygonAreaHa(r);
    expect(polygonAreaHa([...r].reverse())).toBeCloseTo(a, 8);
    expect(polygonAreaHa([...r, r[0]])).toBeCloseTo(a, 8);
    expect(a).toBeCloseTo(6, 1);
  });
  it('concave (L-shaped) polygon', () => {
    // 200x200 square minus a 100x100 corner = 3 ha
    const o = ORIGIN;
    const ring = [o, offsetM(o, 200, 0), offsetM(o, 200, 100), offsetM(o, 100, 100), offsetM(o, 100, 200), offsetM(o, 0, 200)];
    expect(polygonAreaHa(ring)).toBeCloseTo(3, 2);
  });
  it('degenerate rings have zero area', () => {
    expect(polygonAreaHa([])).toBe(0);
    expect(polygonAreaHa([ORIGIN, offsetM(ORIGIN, 10, 0)])).toBe(0);
  });
  it('works across the antimeridian', () => {
    const ring: LngLat[] = [[179.99, 0], [-179.99, 0], [-179.99, 0.01], [179.99, 0.01]];
    const exactHa = ellipsoidRectAreaM2(179.99, 0, 180.01, 0.01) / 10000;
    expect(Math.abs(polygonAreaHa(ring) - exactHa) / exactHa).toBeLessThan(0.001);
  });
});

describe('centroid', () => {
  it('centre of a rectangle', () => {
    const c = centroid(rectM(ORIGIN, 400, 200));
    expect(distanceM(c, offsetM(ORIGIN, 200, 100))).toBeLessThan(0.5);
  });
  it('area-weighted for an L shape', () => {
    const o = ORIGIN;
    const ring = [o, offsetM(o, 200, 0), offsetM(o, 200, 100), offsetM(o, 100, 100), offsetM(o, 100, 200), offsetM(o, 0, 200)];
    // pieces: 200x100 at (100,50) area 2; 100x100 at (50,150) area 1 -> (83.3, 83.3)
    expect(distanceM(centroid(ring), offsetM(o, 250 / 3, 250 / 3))).toBeLessThan(0.5);
  });
  it('degenerate input falls back sensibly', () => {
    expect(centroid([ORIGIN])).toEqual(ORIGIN);
    const line = [ORIGIN, offsetM(ORIGIN, 100, 0)];
    expect(distanceM(centroid(line), offsetM(ORIGIN, 50, 0))).toBeLessThan(0.5);
  });
});

describe('pointInPolygon', () => {
  const ring = rectM(ORIGIN, 200, 100);
  it('inside / outside', () => {
    expect(pointInPolygon(offsetM(ORIGIN, 100, 50), ring)).toBe(true);
    expect(pointInPolygon(offsetM(ORIGIN, 250, 50), ring)).toBe(false);
    expect(pointInPolygon(offsetM(ORIGIN, 100, -10), ring)).toBe(false);
  });
  it('concave notch is outside', () => {
    const o = ORIGIN;
    const L = [o, offsetM(o, 200, 0), offsetM(o, 200, 100), offsetM(o, 100, 100), offsetM(o, 100, 200), offsetM(o, 0, 200)];
    expect(pointInPolygon(offsetM(o, 150, 150), L)).toBe(false);
    expect(pointInPolygon(offsetM(o, 50, 150), L)).toBe(true);
  });
  it('handles a closed ring and degenerate rings', () => {
    expect(pointInPolygon(offsetM(ORIGIN, 100, 50), [...ring, ring[0]])).toBe(true);
    expect(pointInPolygon(ORIGIN, [ORIGIN, offsetM(ORIGIN, 1, 1)])).toBe(false);
  });
});
