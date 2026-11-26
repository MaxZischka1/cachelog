import { lassoToRing, simplifyLine } from './simplify';

type P = [number, number];

describe('simplifyLine', () => {
  it('drops jitter along a straight line', () => {
    const pts: P[] = Array.from({ length: 50 }, (_, i) => [i, i % 2 ? 0.3 : -0.3]);
    expect(simplifyLine(pts, 1)).toEqual([pts[0], pts[49]]);
  });

  it('keeps real corners', () => {
    const pts: P[] = [[0, 0], [5, 0.2], [10, 0], [10, 5], [10.1, 10], [0, 10]];
    const out = simplifyLine(pts, 1);
    expect(out).toContainEqual([10, 0]);
    expect(out).toContainEqual([0, 10]);
  });
});

describe('lassoToRing', () => {
  // A shaky finger circle, 100 px across, 200 samples.
  const circle: P[] = Array.from({ length: 200 }, (_, i) => {
    const a = (i / 199) * Math.PI * 2;
    const r = 50 + (i % 3) * 0.4;
    return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
  });

  it('turns a drag into a closed area with far fewer corners', () => {
    const ring = lassoToRing(circle, 2, 20)!;
    expect(ring.length).toBeGreaterThanOrEqual(8);
    expect(ring.length).toBeLessThan(40);
    const [a, b] = [ring[0], ring[ring.length - 1]];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(2); // not closed twice
  });

  it('rejects a tap-sized scribble', () => {
    expect(lassoToRing([[0, 0], [3, 2], [1, 4], [2, 1]], 1, 20)).toBeNull();
  });

  it('rejects fewer than 3 points', () => {
    expect(lassoToRing([[0, 0], [50, 50]], 1, 20)).toBeNull();
  });
});
