/// <reference types="jest" />
import type { Block, PlanContent } from '../core/types';
import { blockBounds, closeRing, ensureMinSize, padBounds, ringCentroid, toLngLatBounds } from './geo';

const block = (layers: Block['layers'] = []): Block => ({
  id: 'b1',
  name: 'Block 1',
  pricesCents: {},
  emergency: {},
  layers,
  createdAt: '2026-05-01T00:00:00Z',
});

const plan = (p: Partial<PlanContent> = {}): PlanContent => ({
  blockId: 'b1',
  day: '2026-05-01',
  planters: [],
  caches: [],
  pieces: [],
  assignments: [],
  hazards: [],
  ...p,
});

describe('blockBounds', () => {
  it('returns null when nothing is on the map', () => {
    expect(blockBounds(block(), null)).toBeNull();
    expect(blockBounds(block(), plan())).toBeNull();
  });

  it('covers raster corners', () => {
    const b = blockBounds(
      block([
        {
          id: 'r',
          kind: 'raster',
          name: 'r',
          imageUri: 'file:///x.png',
          corners: [
            [-120.1, 50.2],
            [-120.0, 50.21],
            [-119.99, 50.1],
            [-120.11, 50.09],
          ],
        },
      ]),
      null,
    );
    expect(b).toEqual([
      [-120.11, 50.09],
      [-119.99, 50.21],
    ]);
  });

  it('covers nested vector geometries (MultiPolygon, LineString, Point) and skips null geometry', () => {
    const b = blockBounds(
      block([
        {
          id: 'v',
          kind: 'vector',
          name: 'v',
          geojson: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: null, geometry: null },
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'MultiPolygon', coordinates: [[[[-121, 51], [-120.5, 51], [-120.5, 51.5], [-121, 51]]]] },
              },
              { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-121.2, 51.1], [-121.1, 51.2]] } },
              { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-120.4, 50.9, 1200] } },
            ],
          },
        },
      ]),
      null,
    );
    expect(b).toEqual([
      [-121.2, 50.9],
      [-120.4, 51.5],
    ]);
  });

  it('covers pieces, caches and hazards together with layers', () => {
    const b = blockBounds(
      block([{ id: 'v', kind: 'vector', name: 'v', geojson: { type: 'FeatureCollection', features: [] } }]),
      plan({
        pieces: [{ id: 'p', name: 'P1', polygon: [[-120, 50], [-119.9, 50], [-119.9, 50.1]] }],
        caches: [{ id: 'c', name: 'C1', position: [-120.2, 50.05], trees: [] }],
        hazards: [
          { id: 'h', kind: 'point', geometry: [[-119.8, 49.95]], note: 'wasps' },
          { id: 'h2', kind: 'area', geometry: [[-119.95, 50.2], [-119.9, 50.2], [-119.9, 50.15]], note: 'cliff' },
        ],
      }),
    );
    expect(b).toEqual([
      [-120.2, 49.95],
      [-119.8, 50.2],
    ]);
  });

  it('ignores invalid coordinates', () => {
    const b = blockBounds(
      block(),
      plan({
        caches: [
          { id: 'c', name: 'C1', position: [-120, 50], trees: [] },
          { id: 'bad', name: 'bad', position: [NaN, 50] as any, trees: [] },
          { id: 'bad2', name: 'bad2', position: [500, 50], trees: [] },
        ],
      }),
    );
    expect(b).toEqual([
      [-120, 50],
      [-120, 50],
    ]);
  });
});

describe('padBounds / ensureMinSize / toLngLatBounds', () => {
  it('pads roughly 1 km in each direction', () => {
    const [[w, s], [e, n]] = padBounds([[-120, 50], [-120, 50]], 1000);
    const latM = (n - s) * 111_320;
    const lngM = (e - w) * 111_320 * Math.cos((50 * Math.PI) / 180);
    expect(latM).toBeCloseTo(2000, 0);
    expect(lngM).toBeCloseTo(2000, 0);
  });

  it('expands a single point to a minimum size, leaves big boxes alone', () => {
    const small = ensureMinSize([[-120, 50], [-120, 50]], 300);
    expect((small[1][1] - small[0][1]) * 111_320).toBeCloseTo(300, 0);
    const big: [[number, number], [number, number]] = [[-121, 49], [-119, 51]];
    expect(ensureMinSize(big, 300)).toBe(big);
  });

  it('flattens to [w, s, e, n]', () => {
    expect(toLngLatBounds([[-121, 49], [-119, 51]])).toEqual([-121, 49, -119, 51]);
  });
});

describe('ringCentroid / closeRing', () => {
  it('finds the centre of a square', () => {
    const c = ringCentroid([[0, 0], [2, 0], [2, 2], [0, 2]])!;
    expect(c[0]).toBeCloseTo(1);
    expect(c[1]).toBeCloseTo(1);
  });
  it('falls back to the mean for degenerate rings', () => {
    expect(ringCentroid([[0, 0], [2, 2]])).toEqual([1, 1]);
    expect(ringCentroid([])).toBeNull();
  });
  it('closes open rings once', () => {
    expect(closeRing([[0, 0], [1, 0], [1, 1]])).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
    expect(closeRing([[0, 0], [1, 0], [1, 1], [0, 0]])).toHaveLength(4);
  });
});
