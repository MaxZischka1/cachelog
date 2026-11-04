/// <reference types="jest" />
import type { PlanContent } from '../core/types';
import { buildDraftFeatures, buildGhostFeatures, buildPlanFeatures, cacheLabelText, selectionFromFeatures } from './features';
import { CACHE_RADIUS, CACHE_RADIUS_HIGHLIGHT, COLORS, pieceStyle } from './style';

const plan: PlanContent = {
  blockId: 'b1',
  day: '2026-05-01',
  planters: [],
  assignments: [],
  pieces: [
    { id: 'p1', name: 'Piece 1', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { id: 'p2', name: 'Piece 2', polygon: [[2, 0], [3, 0], [3, 1]] },
    { id: 'p3', name: 'Piece 3', polygon: [[4, 0], [5, 0], [5, 1]] },
    { id: 'bad', name: 'Too few', polygon: [[0, 0], [1, 1]] },
  ],
  caches: [
    { id: 'c1', name: 'Cache 1', position: [0.5, 0.5], trees: [] },
    { id: 'c2', name: 'Cache 2', position: [2.5, 0.5], trees: [] },
  ],
  hazards: [
    { id: 'h1', kind: 'point', geometry: [[0.2, 0.2]], note: 'wasp nest' },
    { id: 'h2', kind: 'area', geometry: [[6, 0], [7, 0], [7, 1]], note: 'cliff' },
    { id: 'h3', kind: 'area', geometry: [[6, 0]], note: 'broken' },
  ],
};

describe('pieceStyle', () => {
  it('maps statuses to outline / light fill / solid green', () => {
    expect(pieceStyle('not-started', false).fillOpacity).toBeLessThan(0.05);
    expect(pieceStyle(undefined, false)).toEqual(pieceStyle('not-started', false));
    const ip = pieceStyle('in-progress', false);
    const done = pieceStyle('complete', false);
    expect(ip.fillOpacity).toBeGreaterThan(0.1);
    expect(done.fillOpacity).toBeGreaterThan(ip.fillOpacity);
    expect(done.fillColor).toBe(COLORS.completeFill);
  });
  it('thickens the outline when highlighted', () => {
    expect(pieceStyle('complete', true).lineWidth).toBeGreaterThan(pieceStyle('complete', false).lineWidth);
  });
});

describe('buildPlanFeatures', () => {
  it('returns empty collections for a null plan', () => {
    const f = buildPlanFeatures(null);
    expect(f.pieces.features).toHaveLength(0);
    expect(f.caches.features).toHaveLength(0);
  });

  it('builds closed piece polygons with status styling and skips invalid pieces', () => {
    const f = buildPlanFeatures(plan, { statuses: { p2: 'in-progress', p3: 'complete' }, highlightIds: ['p1'] });
    expect(f.pieces.features.map((x) => x.properties.id)).toEqual(['p1', 'p2', 'p3']);
    const [p1, p2, p3] = f.pieces.features;
    expect((p1.geometry as any).coordinates[0]).toHaveLength(5);
    expect(p1.properties).toMatchObject({ kind: 'piece', status: 'not-started', highlight: true, lineWidth: 6 });
    expect(p2.properties).toMatchObject({ status: 'in-progress', fillColor: COLORS.inProgressFill });
    expect(p3.properties).toMatchObject({ status: 'complete', fillColor: COLORS.completeFill, highlight: false });
    expect(f.pieceLabels.features[0].properties.label).toBe('Piece 1');
    const c = (f.pieceLabels.features[0].geometry as any).coordinates;
    expect(c[0]).toBeCloseTo(0.5);
    expect(c[1]).toBeCloseTo(0.5);
  });

  it('labels caches with extra text and enlarges highlighted ones', () => {
    const f = buildPlanFeatures(plan, { cacheLabels: { c1: '900 Sx left' }, highlightIds: ['c2'] });
    expect(f.caches.features[0].properties).toMatchObject({ kind: 'cache', id: 'c1', label: 'Cache 1\n900 Sx left', radius: CACHE_RADIUS });
    expect(f.caches.features[1].properties).toMatchObject({ label: 'Cache 2', radius: CACHE_RADIUS_HIGHLIGHT, highlight: true });
  });

  it('splits hazards into points and areas, dropping broken areas', () => {
    const f = buildPlanFeatures(plan);
    expect(f.hazardPoints.features.map((x) => x.properties.id)).toEqual(['h1']);
    expect(f.hazardAreas.features.map((x) => x.properties.id)).toEqual(['h2']);
    expect(f.hazardPoints.features[0].properties.label).toBe('wasp nest');
  });
});

describe('cacheLabelText', () => {
  it('ignores blank extras', () => {
    expect(cacheLabelText('C', '  ')).toBe('C');
    expect(cacheLabelText('C', undefined)).toBe('C');
  });
});

describe('buildGhostFeatures', () => {
  it('collects polygons and points marked as ghost', () => {
    const g = buildGhostFeatures(plan);
    expect(g.polygons.features).toHaveLength(4); // 3 pieces + 1 area hazard
    expect(g.points.features).toHaveLength(3); // 1 point hazard + 2 caches
    expect(g.points.features.every((f) => f.properties.kind === 'ghost')).toBe(true);
    expect(buildGhostFeatures(null).points.features).toHaveLength(0);
  });
});

describe('buildDraftFeatures', () => {
  it('shows only vertices for one point, a line for two, a polygon for three', () => {
    expect(buildDraftFeatures([[0, 0]]).shape.features).toHaveLength(0);
    expect(buildDraftFeatures([[0, 0], [1, 0]]).shape.features[0].geometry.type).toBe('LineString');
    const d = buildDraftFeatures([[0, 0], [1, 0], [1, 1]]);
    expect(d.shape.features[0].geometry.type).toBe('Polygon');
    expect(d.vertices.features).toHaveLength(3);
    expect(d.vertices.features[0].properties.first).toBe(true);
  });
});

describe('selectionFromFeatures', () => {
  it('prefers caches over hazards over pieces and ignores others', () => {
    const feats = [
      { properties: { kind: 'piece', id: 'p1' } },
      { properties: { kind: 'ghost', id: 'x' } },
      { properties: { kind: 'hazard', id: 'h1' } },
      { properties: { kind: 'cache', id: 'c1' } },
    ];
    expect(selectionFromFeatures(feats)).toEqual({ type: 'cache', id: 'c1' });
    expect(selectionFromFeatures(feats.slice(0, 3))).toEqual({ type: 'hazard', id: 'h1' });
    expect(selectionFromFeatures([{ properties: null }, { properties: { kind: 'ghost', id: 'x' } }])).toBeNull();
    expect(selectionFromFeatures([])).toBeNull();
  });
});
