import { cutblockOf, describeBlockPosition, describeCutblock, whereInBlock } from './cutblock';
import type { Block, LngLat, VectorLayer } from './types';

// A block about 1.1 km x 1.1 km with a 110 m island in the middle.
const ring = (w: number, s: number, e: number, n: number): LngLat[] => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const OUTER = ring(-117, 54, -116.983, 54.01);
const ISLAND = ring(-116.992, 54.0045, -116.9903, 54.0055);
const cutblock: VectorLayer = {
  id: 'c', kind: 'vector', name: 'Cutblock', role: 'cutblock', areaHa: 106.9,
  geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [OUTER, ISLAND] } }] },
};
const block = (layers: Block['layers']): Block => ({ id: 'b', name: 'B', pricesCents: {}, emergency: {}, layers, createdAt: '' });
const B = block([{ id: 'v', kind: 'vector', name: 'Roads', geojson: { type: 'FeatureCollection', features: [] } }, cutblock]);
const m = (v: number) => `${Math.round(v)} m`;

test('cutblockOf finds the outline among the layers', () => {
  expect(cutblockOf(B)?.id).toBe('c');
  expect(cutblockOf(block([]))).toBeUndefined();
  expect(whereInBlock([-116.99, 54.002], block([]))).toBeNull();
});

test('inside, in an island, outside, with distance to the nearest edge', () => {
  const inside = whereInBlock([-116.995, 54.002], B)!;
  expect(inside.where).toBe('inside');
  expect(inside.edgeM).toBeGreaterThan(200);
  expect(whereInBlock([-116.9911, 54.005], B)!.where).toBe('island');
  const out = whereInBlock([-116.99, 54.0118], B)!; // 0.0018° north of the top edge ≈ 200 m
  expect(out.where).toBe('outside');
  expect(out.edgeM).toBeGreaterThan(190);
  expect(out.edgeM).toBeLessThan(210);
});

test('what the planter map says', () => {
  expect(describeBlockPosition(whereInBlock([-116.995, 54.002], B), 5, m)).toBeNull();
  expect(describeBlockPosition(whereInBlock([-116.99, 54.0118], B), 5, m)).toMatch(/^Outside the block · (19\d|20\d) m to the edge$/);
  // Within GPS accuracy of the edge: no guessing which side.
  expect(describeBlockPosition(whereInBlock([-116.99, 54.0101], B), 15, m)).toBe('At the block edge');
  expect(describeBlockPosition(whereInBlock([-116.9911, 54.005], B), 5, m)).toBe('In an island inside the block: not planted');
  expect(describeBlockPosition(null, 5, m)).toBeNull();
});

test('describeCutblock', () => {
  expect(describeCutblock(cutblock)).toMatch(/^106\.9 ha, 1 island \(1\.\d+ ha\) left out$/);
  expect(describeCutblock({ ...cutblock, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [OUTER] } }] } })).toBe('106.9 ha');
  expect(describeCutblock(undefined)).toBeNull();
});
