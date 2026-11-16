/** The block boundary (cutblock layer) and where a point is relative to it. Pure. */
import { pointInPolygon, polygonAreaHa } from './plan/geo';
import type { Block, GeoJSONFeature, LngLat, VectorLayer } from './types';

/** The block's cutblock layer, if a GeoPDF with one was imported. */
export function cutblockOf(block: Block | null | undefined): VectorLayer | undefined {
  return block?.layers.find((l): l is VectorLayer => l.kind === 'vector' && l.role === 'cutblock');
}

/** Polygons ([outer, ...islands]) of a vector layer. */
export function layerPolygons(layer: VectorLayer): LngLat[][][] {
  const of = (f: GeoJSONFeature): LngLat[][][] => {
    const g = f.geometry;
    if (g?.type === 'Polygon') return [g.coordinates];
    if (g?.type === 'MultiPolygon') return g.coordinates;
    return [];
  };
  return (layer.geojson.features ?? []).flatMap(of).filter((p) => Array.isArray(p) && Array.isArray(p[0]) && p[0].length >= 3);
}

/** Metres from p to the nearest edge of a ring (flat-earth around p: fine at block scale). */
function edgeDistanceM(p: LngLat, ring: LngLat[]): number {
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110_574;
  const xy = ring.map(([lng, lat]): [number, number] => [(lng - p[0]) * kx, (lat - p[1]) * ky]);
  let best = Infinity;
  for (let i = 0; i < xy.length; i++) {
    const [ax, ay] = xy[i];
    const [bx, by] = xy[(i + 1) % xy.length];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export interface BlockPosition {
  /** inside: in the block; island: inside the block outline but in an unplanted island. */
  where: 'inside' | 'island' | 'outside';
  /** Distance to the nearest edge (block outline or island), metres. */
  edgeM: number;
}

/** Where `p` is relative to the block's cutblock. Null when the block has no cutblock. */
export function whereInBlock(p: LngLat, block: Block | null | undefined): BlockPosition | null {
  const layer = cutblockOf(block);
  if (!layer) return null;
  const polys = layerPolygons(layer);
  if (!polys.length) return null;
  const edgeM = Math.min(...polys.flatMap((rings) => rings.map((r) => edgeDistanceM(p, r))));
  for (const [outer, ...islands] of polys) {
    if (!pointInPolygon(p, outer)) continue;
    return { where: islands.some((r) => pointInPolygon(p, r)) ? 'island' : 'inside', edgeM };
  }
  return { where: 'outside', edgeM };
}

const ha = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 2 });

/** "49.97 ha, 2 islands (1.2 ha) left out". Null without an area. */
export function describeCutblock(layer: VectorLayer | undefined): string | null {
  if (!layer || layer.areaHa === undefined) return null;
  const islands = layerPolygons(layer).flatMap(([, ...holes]) => holes);
  if (!islands.length) return `${ha(layer.areaHa)} ha`;
  const islandHa = islands.reduce((s, r) => s + polygonAreaHa(r), 0);
  return `${ha(layer.areaHa)} ha, ${islands.length} island${islands.length === 1 ? '' : 's'} (${ha(islandHa)} ha) left out`;
}

/**
 * One line for the planter map, or null when there is nothing to say (inside the block, away from
 * an edge). Within GPS accuracy of an edge (at least 10 m) it says "at the edge" rather than guess.
 */
export function describeBlockPosition(pos: BlockPosition | null, accuracyM: number | null, fmtDistance: (m: number) => string): string | null {
  if (!pos) return null;
  const near = pos.edgeM <= Math.max(10, accuracyM ?? 0);
  if (pos.where === 'outside') return near ? 'At the block edge' : `Outside the block · ${fmtDistance(pos.edgeM)} to the edge`;
  if (pos.where === 'island') return near ? 'At the edge of an island (not planted)' : 'In an island inside the block: not planted';
  return null;
}
