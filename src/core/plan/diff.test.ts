import type { PlanContent } from '../types';
import { deepCopy } from './content';
import { diffPlans, fmtDay, fmtDistance, fmtHa, fmtNumber } from './diff';
import { ORIGIN, offsetM, rectM, samplePlan } from './testFixtures';

function edit(fn: (c: PlanContent) => void): { before: PlanContent; after: PlanContent } {
  const before = samplePlan();
  const after = deepCopy(before);
  fn(after);
  return { before, after };
}
const texts = (b: PlanContent | null, a: PlanContent) => diffPlans(b, a).map((c) => c.text);

describe('formatting helpers', () => {
  it('fmtNumber', () => {
    expect(fmtNumber(0)).toBe('0');
    expect(fmtNumber(900)).toBe('900');
    expect(fmtNumber(1200)).toBe('1,200');
    expect(fmtNumber(1234567)).toBe('1,234,567');
    expect(fmtNumber(-1500)).toBe('-1,500');
    expect(fmtNumber(2.5)).toBe('2.5');
  });
  it('fmtDistance', () => {
    expect(fmtDistance(5)).toBe('5 m');
    expect(fmtDistance(12)).toBe('10 m');
    expect(fmtDistance(48)).toBe('50 m');
    expect(fmtDistance(207)).toBe('210 m');
    expect(fmtDistance(994)).toBe('990 m');
    expect(fmtDistance(1240)).toBe('1.2 km');
    expect(fmtDistance(23_400)).toBe('23 km');
  });
  it('fmtHa', () => {
    expect(fmtHa(3.21)).toBe('3.2 ha');
    expect(fmtHa(0)).toBe('0.0 ha');
    expect(fmtHa(0.04)).toBe('0.04 ha');
  });
  it('fmtDay', () => {
    expect(fmtDay('2026-05-13')).toBe('Wed May 13');
    expect(fmtDay('not a day')).toBe('not a day');
  });
});

describe('diffPlans: no changes', () => {
  it('identical plans give no changes', () => {
    expect(diffPlans(samplePlan(), samplePlan())).toEqual([]);
  });
  it('ignores cache moves under 5 m and tiny polygon jitter', () => {
    const { before, after } = edit((c) => {
      c.caches[0].position = offsetM(c.caches[0].position, 3, 2);
      c.pieces[0].polygon = c.pieces[0].polygon.map((p) => offsetM(p, 1, -1));
      c.hazards[0].geometry = [offsetM(c.hazards[0].geometry[0], 2, 0)];
    });
    expect(diffPlans(before, after)).toEqual([]);
  });
  it('does not mutate inputs', () => {
    const { before, after } = edit((c) => c.caches.pop());
    const b = JSON.stringify(before);
    const a = JSON.stringify(after);
    diffPlans(before, after);
    expect(JSON.stringify(before)).toBe(b);
    expect(JSON.stringify(after)).toBe(a);
  });
});

describe('diffPlans: caches', () => {
  it('cache-added', () => {
    const { before, after } = edit((c) =>
      c.caches.push({ id: 'c4', name: 'Cache 4', position: ORIGIN, trees: [{ species: 'Sx', count: 1200 }, { species: 'Pl', count: 600 }] }),
    );
    expect(diffPlans(before, after)).toEqual([{ kind: 'cache-added', text: 'Added Cache 4 (1,200 Sx, 600 Pl)', ids: ['c4'] }]);
  });
  it('cache-added with no trees', () => {
    const { before, after } = edit((c) => c.caches.push({ id: 'c4', name: 'Cache 4', position: ORIGIN, trees: [] }));
    expect(texts(before, after)).toEqual(['Added Cache 4 (no trees)']);
  });
  it('cache-removed', () => {
    const { before, after } = edit((c) => (c.caches = c.caches.filter((x) => x.id !== 'c2')));
    expect(diffPlans(before, after)).toEqual([{ kind: 'cache-removed', text: 'Removed Cache 2', ids: ['c2'] }]);
  });
  it('cache-moved with distance and compass direction', () => {
    const { before, after } = edit((c) => (c.caches[0].position = offsetM(c.caches[0].position, 208, 0)));
    expect(diffPlans(before, after)).toEqual([{ kind: 'cache-moved', text: 'Cache 1 moved 210 m E', ids: ['c1'] }]);
  });
  it('cache-moved NW in km', () => {
    const { before, after } = edit((c) => (c.caches[0].position = offsetM(c.caches[0].position, -1000, 1000)));
    expect(texts(before, after)).toEqual(['Cache 1 moved 1.4 km NW']);
  });
  it('cache-trees: changed, new and dropped species', () => {
    const { before, after } = edit((c) => {
      c.caches[0].trees = [{ species: 'Sx', count: 900 }, { species: 'Fd', count: 400 }];
    });
    expect(diffPlans(before, after)).toEqual([
      { kind: 'cache-trees', text: 'Cache 1: Sx 1,200 → 900, Fd 0 → 400, Pl 600 → 0', ids: ['c1'] },
    ]);
  });
  it('cache-trees: same totals split differently is no change', () => {
    const { before, after } = edit((c) => {
      c.caches[0].trees = [{ species: 'Pl', count: 600 }, { species: 'Sx', count: 700 }, { species: 'Sx', count: 500 }];
    });
    expect(diffPlans(before, after)).toEqual([]);
  });
  it('cache-renamed then later sentences use the new name', () => {
    const { before, after } = edit((c) => {
      c.caches[0].name = 'Road cache';
      c.caches[0].position = offsetM(c.caches[0].position, 0, -50);
    });
    expect(diffPlans(before, after)).toEqual([
      { kind: 'cache-renamed', text: 'Cache 1 renamed to Road cache', ids: ['c1'] },
      { kind: 'cache-moved', text: 'Road cache moved 50 m S', ids: ['c1'] },
    ]);
  });
  it('cache-notes added / changed / removed', () => {
    let d = edit((c) => (c.caches[0].notes = 'by the landing'));
    expect(diffPlans(d.before, d.after)).toEqual([{ kind: 'cache-notes', text: 'Cache 1 notes added: “by the landing”', ids: ['c1'] }]);
    const withNotes = samplePlan();
    withNotes.caches[0].notes = 'by the landing';
    const changed = deepCopy(withNotes);
    changed.caches[0].notes = 'behind the stump pile';
    expect(texts(withNotes, changed)).toEqual(['Cache 1 notes changed: “behind the stump pile”']);
    const removed = deepCopy(withNotes);
    delete removed.caches[0].notes;
    expect(texts(withNotes, removed)).toEqual(['Cache 1 notes removed']);
    d = edit((c) => (c.caches[0].notes = '   '));
    expect(diffPlans(d.before, d.after)).toEqual([]);
  });
  it('long notes are truncated', () => {
    const { before, after } = edit((c) => (c.caches[0].notes = 'x'.repeat(200)));
    const t = texts(before, after)[0];
    expect(t.length).toBeLessThan(100);
    expect(t).toContain('…');
  });
});

describe('diffPlans: pieces', () => {
  it('piece-added with area', () => {
    const { before, after } = edit((c) =>
      c.pieces.push({ id: 'pc7', name: 'Piece 7', polygon: rectM(offsetM(ORIGIN, 0, 1000), 200, 160) }),
    );
    expect(diffPlans(before, after)).toEqual([{ kind: 'piece-added', text: 'Added Piece 7 (3.2 ha)', ids: ['pc7'] }]);
  });
  it('piece-added mentions density when set', () => {
    const { before, after } = edit((c) =>
      c.pieces.push({ id: 'pc7', name: 'Piece 7', polygon: rectM(ORIGIN, 200, 160), prescription: { densityPerHa: 1600 } }),
    );
    expect(texts(before, after)).toEqual(['Added Piece 7 (3.2 ha, 1,600/ha)']);
  });
  it('piece-removed', () => {
    const { before, after } = edit((c) => {
      c.pieces = c.pieces.filter((p) => p.id !== 'pc2');
      c.assignments = c.assignments.filter((a) => a.pieceId !== 'pc2');
    });
    expect(texts(before, after)).toEqual(['Sam unassigned', 'Removed Piece 2']);
  });
  it('piece-reshaped with before and after area', () => {
    const { before, after } = edit((c) => (c.pieces[1].polygon = rectM(offsetM(ORIGIN, 500, 0), 200, 130)));
    expect(diffPlans(before, after)).toEqual([{ kind: 'piece-reshaped', text: 'Piece 2 reshaped (2.1 → 2.6 ha)', ids: ['pc2'] }]);
  });
  it('piece-reshaped with same rounded area', () => {
    const { before, after } = edit((c) => (c.pieces[0].polygon = rectM(offsetM(ORIGIN, 20, 0), 200, 100)));
    expect(texts(before, after)).toEqual(['Piece 1 reshaped (still 2.0 ha)']);
  });
  it('piece-reshaped when a vertex is added', () => {
    const { before, after } = edit((c) => c.pieces[0].polygon.push(offsetM(ORIGIN, -1, 50)));
    expect(diffPlans(before, after).map((x) => x.kind)).toEqual(['piece-reshaped']);
  });
  it('piece-renamed', () => {
    const { before, after } = edit((c) => (c.pieces[0].name = 'Piece 1A'));
    expect(diffPlans(before, after)).toEqual([{ kind: 'piece-renamed', text: 'Piece 1 renamed to Piece 1A', ids: ['pc1'] }]);
  });
  it('piece-prescription changed / set / removed', () => {
    let d = edit((c) => (c.pieces[0].prescription = { densityPerHa: 1800, spacingM: 2.4, species: ['Sx'] }));
    expect(diffPlans(d.before, d.after)).toEqual([
      {
        kind: 'piece-prescription',
        text: 'Piece 1 prescription: density 1,600 → 1,800/ha, spacing 2.5 → 2.4 m, species Sx, Pl → Sx',
        ids: ['pc1'],
      },
    ]);
    d = edit((c) => (c.pieces[1].prescription = { densityPerHa: 1400, species: ['Fd'] }));
    expect(texts(d.before, d.after)).toEqual(['Piece 2 prescription: density set to 1,400/ha, species set to Fd']);
    d = edit((c) => delete c.pieces[0].prescription);
    expect(texts(d.before, d.after)).toEqual(['Piece 1 prescription: density removed, spacing removed, species removed']);
  });
  it('piece-notes', () => {
    const { before, after } = edit((c) => (c.pieces[0].notes = 'screef deep, lots of slash'));
    expect(diffPlans(before, after)).toEqual([
      { kind: 'piece-notes', text: 'Piece 1 notes added: “screef deep, lots of slash”', ids: ['pc1'] },
    ]);
  });
});

describe('diffPlans: planters and assignments', () => {
  it('assignment-changed piece', () => {
    const { before, after } = edit((c) => (c.assignments[1].pieceId = 'pc1'));
    expect(diffPlans(before, after)).toEqual([
      { kind: 'assignment-changed', text: 'Sam: Piece 2 → Piece 1', ids: ['p2', 'pc2', 'pc1'] },
    ]);
  });
  it('assignment-changed piece and cache together', () => {
    const { before, after } = edit((c) => (c.assignments[0] = { planterId: 'p1', pieceId: 'pc2', cacheId: 'c2' }));
    expect(texts(before, after)).toEqual(['Jess: Piece 1 → Piece 2, Cache 1 → Cache 2']);
  });
  it('assignment-changed cache only, incl. none', () => {
    let d = edit((c) => delete c.assignments[0].cacheId);
    expect(texts(d.before, d.after)).toEqual(['Jess: Cache 1 → no cache']);
    d = edit((c) => (c.assignments[1].cacheId = 'c2'));
    expect(texts(d.before, d.after)).toEqual(['Sam: no cache → Cache 2']);
  });
  it('assignment-added and assignment-removed', () => {
    let d = edit((c) => (c.assignments = c.assignments.filter((a) => a.planterId !== 'p2')));
    expect(diffPlans(d.before, d.after)).toEqual([{ kind: 'assignment-removed', text: 'Sam unassigned', ids: ['p2', 'pc2'] }]);
    const noJess = samplePlan();
    noJess.assignments = noJess.assignments.filter((a) => a.planterId !== 'p1');
    expect(diffPlans(noJess, samplePlan())).toEqual([
      { kind: 'assignment-added', text: 'Jess assigned to Piece 1 (Cache 1)', ids: ['p1', 'pc1', 'c1'] },
    ]);
    d = edit((c) => (c.assignments = c.assignments.filter((a) => a.planterId !== 'p1')));
    expect(texts(d.after, d.before)).toEqual(['Jess assigned to Piece 1 (Cache 1)']);
  });
  it('a renamed piece does not count as reassignment, and old names are used for "from"', () => {
    const { before, after } = edit((c) => {
      c.pieces[0].name = 'North slope';
      c.pieces[1].name = 'Gully';
      c.assignments[0].pieceId = 'pc2';
    });
    expect(texts(before, after)).toEqual([
      'Jess: Piece 1 → Gully',
      'Piece 1 renamed to North slope',
      'Piece 2 renamed to Gully',
    ]);
  });
  it('planter-added with assignment, grouped together', () => {
    const { before, after } = edit((c) => {
      c.planters.push({ id: 'p3', name: 'Alex' });
      c.assignments.push({ planterId: 'p3', pieceId: 'pc2' });
    });
    expect(diffPlans(before, after)).toEqual([
      { kind: 'planter-added', text: 'Added planter Alex', ids: ['p3'] },
      { kind: 'assignment-added', text: 'Alex assigned to Piece 2', ids: ['p3', 'pc2'] },
    ]);
  });
  it('planter-removed does not also say unassigned', () => {
    const { before, after } = edit((c) => {
      c.planters = c.planters.filter((p) => p.id !== 'p1');
      c.assignments = c.assignments.filter((a) => a.planterId !== 'p1');
    });
    expect(diffPlans(before, after)).toEqual([{ kind: 'planter-removed', text: 'Removed planter Jess', ids: ['p1'] }]);
  });
  it('planter-renamed', () => {
    const { before, after } = edit((c) => (c.planters[0].name = 'Jessica'));
    expect(diffPlans(before, after)).toEqual([{ kind: 'planter-renamed', text: 'Planter Jess renamed to Jessica', ids: ['p1'] }]);
  });
});

describe('diffPlans: hazards, day, notes', () => {
  it('hazard-added point and area', () => {
    const { before, after } = edit((c) => {
      c.hazards.push({ id: 'h2', kind: 'point', geometry: [ORIGIN], note: 'bear sign' });
      c.hazards.push({ id: 'h3', kind: 'area', geometry: rectM(ORIGIN, 50, 50), note: 'cliff band' });
    });
    expect(diffPlans(before, after)).toEqual([
      { kind: 'hazard-added', text: 'New hazard: bear sign', ids: ['h2'] },
      { kind: 'hazard-added', text: 'New hazard area: cliff band', ids: ['h3'] },
    ]);
  });
  it('hazard-removed', () => {
    const { before, after } = edit((c) => (c.hazards = []));
    expect(diffPlans(before, after)).toEqual([{ kind: 'hazard-removed', text: 'Hazard removed: wasp nest', ids: ['h1'] }]);
  });
  it('hazard-changed: note, move, both, area reshape', () => {
    let d = edit((c) => (c.hazards[0].note = 'wasp nest (flagged)'));
    expect(diffPlans(d.before, d.after)).toEqual([
      { kind: 'hazard-changed', text: 'Hazard changed: wasp nest → wasp nest (flagged)', ids: ['h1'] },
    ]);
    d = edit((c) => (c.hazards[0].geometry = [offsetM(c.hazards[0].geometry[0], 30, 30)]));
    expect(texts(d.before, d.after)).toEqual(['Hazard moved 40 m NE: wasp nest']);
    d = edit((c) => {
      c.hazards[0].geometry = [offsetM(c.hazards[0].geometry[0], 0, -100)];
      c.hazards[0].note = 'two wasp nests';
    });
    expect(texts(d.before, d.after)).toEqual(['Hazard changed: wasp nest → two wasp nests, moved 100 m S']);
    const withArea = samplePlan();
    withArea.hazards.push({ id: 'h3', kind: 'area', geometry: rectM(ORIGIN, 50, 50), note: 'cliff band' });
    const reshaped = deepCopy(withArea);
    reshaped.hazards[1].geometry = rectM(ORIGIN, 80, 50);
    expect(texts(withArea, reshaped)).toEqual(['Hazard area changed: cliff band']);
  });
  it('unnamed hazard', () => {
    const { before, after } = edit((c) => c.hazards.push({ id: 'h9', kind: 'point', geometry: [ORIGIN], note: ' ' }));
    expect(texts(before, after)).toEqual(['New hazard: unnamed hazard']);
  });
  it('day-changed comes first, notes-changed last', () => {
    const { before, after } = edit((c) => {
      c.day = '2026-05-13';
      c.notes = 'Heli at 7, bring rain gear';
      c.caches[0].trees = [{ species: 'Sx', count: 1000 }, { species: 'Pl', count: 600 }];
      c.assignments[1].pieceId = 'pc1';
      c.hazards.push({ id: 'h2', kind: 'point', geometry: [ORIGIN], note: 'cliff' });
      c.pieces[0].name = 'Piece 1A';
    });
    expect(diffPlans(before, after)).toEqual([
      { kind: 'day-changed', text: 'Plan day: Tue May 12 → Wed May 13', ids: [] },
      { kind: 'assignment-changed', text: 'Sam: Piece 2 → Piece 1A', ids: ['p2', 'pc2', 'pc1'] },
      { kind: 'cache-trees', text: 'Cache 1: Sx 1,200 → 1,000', ids: ['c1'] },
      { kind: 'piece-renamed', text: 'Piece 1 renamed to Piece 1A', ids: ['pc1'] },
      { kind: 'hazard-added', text: 'New hazard: cliff', ids: ['h2'] },
      { kind: 'notes-changed', text: 'Plan notes added: “Heli at 7, bring rain gear”', ids: [] },
    ]);
  });
  it('notes removed', () => {
    const b = samplePlan();
    b.notes = 'old';
    expect(diffPlans(b, samplePlan())).toEqual([{ kind: 'notes-changed', text: 'Plan notes removed', ids: [] }]);
  });
});

describe('diffPlans: first publish (before = null)', () => {
  it('small plan lists everything as added', () => {
    expect(texts(null, samplePlan())).toEqual([
      'Added planter Jess',
      'Jess assigned to Piece 1 (Cache 1)',
      'Added planter Sam',
      'Sam assigned to Piece 2',
      'Added Cache 1 (1,200 Sx, 600 Pl)',
      'Added Cache 2 (800 Sx)',
      'Added Piece 1 (2.0 ha, 1,600/ha)',
      'Added Piece 2 (2.1 ha)',
      'New hazard: wasp nest',
    ]);
  });
  it('empty plan gives no changes', () => {
    expect(diffPlans(null, { ...samplePlan(), planters: [], caches: [], pieces: [], assignments: [], hazards: [] })).toEqual([]);
  });
  it('large plan collapses categories but keeps every hazard', () => {
    const c = samplePlan();
    c.planters = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Planter ${i}` }));
    c.caches = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      name: `Cache ${i}`,
      position: offsetM(ORIGIN, i * 100, 0),
      trees: [{ species: 'Sx', count: 1200 }, { species: 'Pl', count: 600 }],
    }));
    c.pieces = Array.from({ length: 6 }, (_, i) => ({ id: `pc${i}`, name: `Piece ${i}`, polygon: rectM(offsetM(ORIGIN, 0, i * 200), 100, 100) }));
    c.assignments = c.planters.map((p, i) => ({ planterId: p.id, pieceId: `pc${i % 4}` }));
    c.hazards = Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, kind: 'point' as const, geometry: [ORIGIN], note: `hazard ${i}` }));
    c.notes = 'Safety meeting at 6:30';
    const changes = diffPlans(null, c);
    expect(changes.slice(0, 4)).toEqual([
      { kind: 'planter-added', text: 'Added 12 planters', ids: c.planters.map((p) => p.id) },
      expect.objectContaining({ kind: 'assignment-added', text: '12 planters assigned to 4 pieces' }),
      { kind: 'cache-added', text: 'Added 8 caches (9,600 Sx, 4,800 Pl)', ids: c.caches.map((x) => x.id) },
      { kind: 'piece-added', text: 'Added 6 pieces (6.0 ha)', ids: c.pieces.map((x) => x.id) },
    ]);
    expect(changes.filter((x) => x.kind === 'hazard-added')).toHaveLength(7);
    expect(changes[changes.length - 1]).toEqual({ kind: 'notes-changed', text: 'Plan notes added: “Safety meeting at 6:30”', ids: [] });
    expect(changes).toHaveLength(12);
  });
});
