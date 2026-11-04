/**
 * GeoJSON builders turning PlanContent into map sources. Pure (no RN imports).
 * Style values are baked into feature properties and read with ["get", ...] in layer paint.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { ID, LngLat, PieceStatus, PlanContent } from '../core/types';
import { closeRing, isValidLngLat, ringCentroid } from './geo';
import {
  CACHE_RADIUS,
  CACHE_RADIUS_HIGHLIGHT,
  HAZARD_RADIUS,
  HAZARD_RADIUS_HIGHLIGHT,
  pieceStyle,
} from './style';

export type FC = FeatureCollection<Geometry, Record<string, any>>;
export type SelectableKind = 'cache' | 'piece' | 'hazard';
export type Selection = { type: SelectableKind; id: ID };

export const emptyFC = (): FC => ({ type: 'FeatureCollection', features: [] });

function feature(geometry: Geometry, properties: Record<string, any>): Feature<Geometry, Record<string, any>> {
  return { type: 'Feature', geometry, properties };
}

function validRing(ring: LngLat[] | undefined): LngLat[] | null {
  const pts = (ring ?? []).filter(isValidLngLat);
  return pts.length >= 3 ? pts : null;
}

export interface PlanFeatures {
  pieces: FC;
  pieceLabels: FC;
  caches: FC;
  hazardPoints: FC;
  hazardAreas: FC;
}

export interface PlanFeatureOptions {
  statuses?: Record<ID, PieceStatus>;
  highlightIds?: ID[];
  cacheLabels?: Record<ID, string>;
}

export function cacheLabelText(name: string, extra: string | undefined): string {
  return extra && extra.trim() ? `${name}\n${extra}` : name;
}

export function buildPlanFeatures(plan: PlanContent | null, opts: PlanFeatureOptions = {}): PlanFeatures {
  const out: PlanFeatures = {
    pieces: emptyFC(),
    pieceLabels: emptyFC(),
    caches: emptyFC(),
    hazardPoints: emptyFC(),
    hazardAreas: emptyFC(),
  };
  if (!plan) return out;
  const hl = new Set(opts.highlightIds ?? []);

  for (const p of plan.pieces ?? []) {
    const ring = validRing(p.polygon);
    if (!ring) continue;
    const highlight = hl.has(p.id);
    const status: PieceStatus = opts.statuses?.[p.id] ?? 'not-started';
    const st = pieceStyle(status, highlight);
    out.pieces.features.push(
      feature({ type: 'Polygon', coordinates: [closeRing(ring)] }, { kind: 'piece', id: p.id, name: p.name, status, highlight, ...st }),
    );
    const c = ringCentroid(ring);
    if (c) out.pieceLabels.features.push(feature({ type: 'Point', coordinates: c }, { kind: 'piece', id: p.id, label: p.name, highlight }));
  }

  for (const c of plan.caches ?? []) {
    if (!isValidLngLat(c.position)) continue;
    const highlight = hl.has(c.id);
    out.caches.features.push(
      feature(
        { type: 'Point', coordinates: c.position },
        {
          kind: 'cache',
          id: c.id,
          name: c.name,
          label: cacheLabelText(c.name, opts.cacheLabels?.[c.id]),
          highlight,
          radius: highlight ? CACHE_RADIUS_HIGHLIGHT : CACHE_RADIUS,
        },
      ),
    );
  }

  for (const h of plan.hazards ?? []) {
    const highlight = hl.has(h.id);
    const base = { kind: 'hazard', id: h.id, label: h.note ?? '', highlight };
    if (h.kind === 'area') {
      const ring = validRing(h.geometry);
      if (!ring) continue;
      out.hazardAreas.features.push(
        feature({ type: 'Polygon', coordinates: [closeRing(ring)] }, { ...base, lineWidth: highlight ? 5 : 2.5 }),
      );
    } else {
      const p = h.geometry?.[0];
      if (!isValidLngLat(p)) continue;
      out.hazardPoints.features.push(
        feature({ type: 'Point', coordinates: p }, { ...base, radius: highlight ? HAZARD_RADIUS_HIGHLIGHT : HAZARD_RADIUS }),
      );
    }
  }
  return out;
}

/** Previous plan version for review: polygons (pieces + hazard areas) and points (caches + hazard points). Not selectable. */
export function buildGhostFeatures(plan: PlanContent | null | undefined): { polygons: FC; points: FC } {
  const polygons = emptyFC();
  const points = emptyFC();
  if (!plan) return { polygons, points };
  for (const p of plan.pieces ?? []) {
    const ring = validRing(p.polygon);
    if (ring) polygons.features.push(feature({ type: 'Polygon', coordinates: [closeRing(ring)] }, { kind: 'ghost', id: p.id }));
  }
  for (const h of plan.hazards ?? []) {
    if (h.kind === 'area') {
      const ring = validRing(h.geometry);
      if (ring) polygons.features.push(feature({ type: 'Polygon', coordinates: [closeRing(ring)] }, { kind: 'ghost', id: h.id }));
    } else if (isValidLngLat(h.geometry?.[0])) {
      points.features.push(feature({ type: 'Point', coordinates: h.geometry[0] }, { kind: 'ghost', id: h.id }));
    }
  }
  for (const c of plan.caches ?? []) {
    if (isValidLngLat(c.position)) points.features.push(feature({ type: 'Point', coordinates: c.position }, { kind: 'ghost', id: c.id }));
  }
  return { polygons, points };
}

/** In-progress polygon while drawing: shape (line for 2 pts, polygon for >=3) and vertex dots. */
export function buildDraftFeatures(points: LngLat[]): { shape: FC; vertices: FC } {
  const shape = emptyFC();
  const vertices = emptyFC();
  points.forEach((p, i) => vertices.features.push(feature({ type: 'Point', coordinates: p }, { index: i, first: i === 0 })));
  if (points.length === 2) shape.features.push(feature({ type: 'LineString', coordinates: points }, {}));
  if (points.length >= 3) shape.features.push(feature({ type: 'Polygon', coordinates: [closeRing(points)] }, {}));
  return { shape, vertices };
}

const KIND_PRIORITY: Record<SelectableKind, number> = { cache: 0, hazard: 1, piece: 2 };

/**
 * Picks the best selection from features under a tap: caches beat hazards beat pieces
 * (small targets win over the big polygon they sit in).
 */
export function selectionFromFeatures(features: { properties?: Record<string, any> | null }[]): Selection | null {
  let best: Selection | null = null;
  for (const f of features) {
    const kind = f.properties?.kind;
    const id = f.properties?.id;
    if ((kind === 'cache' || kind === 'hazard' || kind === 'piece') && typeof id === 'string') {
      if (!best || KIND_PRIORITY[kind as SelectableKind] < KIND_PRIORITY[best.type]) best = { type: kind, id };
    }
  }
  return best;
}
