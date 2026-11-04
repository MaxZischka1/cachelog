/** Shared fixtures for core/plan tests. Not imported by app code. */
import type { Block, LngLat, PlanContent, PlanVersion } from '../types';

/** Point offset from `origin` by east/north metres (local flat approximation, fine for a few km). */
export function offsetM(origin: LngLat, eastM: number, northM: number): LngLat {
  const latRad = (origin[1] * Math.PI) / 180;
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = (Math.PI / 180) * 6378137 * Math.cos(latRad) / Math.sqrt(1 - 0.00669438 * Math.sin(latRad) ** 2);
  return [origin[0] + eastM / mPerDegLon, origin[1] + northM / mPerDegLat];
}

/** Rectangle ring of given size (metres) with its SW corner at `sw`. */
export function rectM(sw: LngLat, widthM: number, heightM: number): LngLat[] {
  return [sw, offsetM(sw, widthM, 0), offsetM(sw, widthM, heightM), offsetM(sw, 0, heightM)];
}

export const ORIGIN: LngLat = [-122.5, 54.0]; // near Prince George, BC

export function samplePlan(): PlanContent {
  return {
    blockId: 'blk1',
    day: '2026-05-12',
    planters: [
      { id: 'p1', name: 'Jess' },
      { id: 'p2', name: 'Sam' },
    ],
    caches: [
      { id: 'c1', name: 'Cache 1', position: offsetM(ORIGIN, 100, 100), trees: [{ species: 'Sx', count: 1200 }, { species: 'Pl', count: 600 }] },
      { id: 'c2', name: 'Cache 2', position: offsetM(ORIGIN, 600, 100), trees: [{ species: 'Sx', count: 800 }] },
    ],
    pieces: [
      { id: 'pc1', name: 'Piece 1', polygon: rectM(ORIGIN, 200, 100), prescription: { densityPerHa: 1600, spacingM: 2.5, species: ['Sx', 'Pl'] } },
      { id: 'pc2', name: 'Piece 2', polygon: rectM(offsetM(ORIGIN, 500, 0), 150, 140) },
    ],
    assignments: [
      { planterId: 'p1', pieceId: 'pc1', cacheId: 'c1' },
      { planterId: 'p2', pieceId: 'pc2' },
    ],
    hazards: [{ id: 'h1', kind: 'point', geometry: [offsetM(ORIGIN, 50, 50)], note: 'wasp nest' }],
  };
}

export function sampleBlock(): Block {
  return {
    id: 'blk1',
    name: 'Block 42',
    contract: 'C-2026-17',
    licensee: 'Canfor',
    pricesCents: { Sx: 18, Pl: 16 },
    emergency: { musterPoint: offsetM(ORIGIN, -200, -200), nearestHospital: 'UHNBC Prince George', radioChannel: 'RR 4' },
    layers: [
      { id: 'L1', kind: 'raster', name: 'Block map', imageUri: 'file:///map.png', corners: [ORIGIN, offsetM(ORIGIN, 1000, 0), offsetM(ORIGIN, 1000, -1000), offsetM(ORIGIN, 0, -1000)] },
      { id: 'L2', kind: 'vector', name: 'Boundary', geojson: { type: 'FeatureCollection', features: [] } },
    ],
    createdAt: '2026-05-01T12:00:00.000Z',
  };
}

export function sampleVersion(version = 1, content: PlanContent = samplePlan()): PlanVersion {
  return {
    blockId: 'blk1',
    version,
    parentVersion: version > 1 ? version - 1 : null,
    publishedAt: '2026-05-12T13:00:00.000Z',
    author: 'Max',
    content,
  };
}
