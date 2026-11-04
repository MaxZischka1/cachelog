import type { PlanContent } from '../types';
import { assignmentFor, emptyPlan, loadList } from './content';
import { dayString, newId, nowIso, today } from './ids';
import { PublishConflictError, hasChanges, publish, quickPublish, revertTo, startDraft, updateDraft } from './versioning';
import { ORIGIN, sampleVersion, samplePlan } from './testFixtures';

const frozen = <T>(x: T): T => {
  const walk = (v: unknown) => {
    if (v && typeof v === 'object') {
      Object.freeze(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(x);
  return x;
};

describe('ids & time', () => {
  it('newId is 16 URL-safe chars and unique', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
  it('newId falls back to Math.random without crypto', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    try {
      expect(newId()).toMatch(/^[A-Za-z0-9_-]{16}$/);
    } finally {
      if (desc) Object.defineProperty(globalThis, 'crypto', desc);
      else delete (globalThis as { crypto?: unknown }).crypto;
    }
  });
  it('newId falls back when getRandomValues throws', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: () => { throw new Error('not supported'); } },
      configurable: true,
      writable: true,
    });
    try {
      expect(newId()).toMatch(/^[A-Za-z0-9_-]{16}$/);
    } finally {
      if (desc) Object.defineProperty(globalThis, 'crypto', desc);
    }
  });
  it('nowIso and today', () => {
    const t = nowIso();
    expect(new Date(t).toISOString()).toBe(t);
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dayString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('plan content helpers', () => {
  it('emptyPlan', () => {
    expect(emptyPlan('b', '2026-05-12')).toEqual({ blockId: 'b', day: '2026-05-12', planters: [], caches: [], pieces: [], assignments: [], hazards: [] });
  });
  it('loadList sums across caches, merges duplicates, sorted by species', () => {
    const p = samplePlan();
    p.caches.push({ id: 'c3', name: 'Cache 3', position: ORIGIN, trees: [{ species: 'Fd', count: 300 }, { species: 'Sx', count: 100 }, { species: 'Sx', count: 50 }] });
    expect(loadList(p)).toEqual([
      { species: 'Fd', count: 300 },
      { species: 'Pl', count: 600 },
      { species: 'Sx', count: 2150 },
    ]);
    expect(loadList(emptyPlan('b', '2026-05-12'))).toEqual([]);
  });
  it('assignmentFor', () => {
    expect(assignmentFor(samplePlan(), 'p1')).toEqual({ planterId: 'p1', pieceId: 'pc1', cacheId: 'c1' });
    expect(assignmentFor(samplePlan(), 'nobody')).toBeUndefined();
  });
});

describe('drafts', () => {
  it('startDraft from nothing is an empty plan for the given day', () => {
    const d = startDraft('blk1', null, '2026-05-12');
    expect(d.baseVersion).toBeNull();
    expect(d.content).toEqual(emptyPlan('blk1', '2026-05-12'));
    expect(startDraft('blk1', null).content.day).toBe(today());
  });
  it('startDraft copies latest content and can move it to a new day', () => {
    const v = frozen(sampleVersion(3));
    const d = startDraft('blk1', v, '2026-05-13');
    expect(d.baseVersion).toBe(3);
    expect(d.content.day).toBe('2026-05-13');
    expect(d.content.caches).toEqual(v.content.caches);
    expect(d.content.caches).not.toBe(v.content.caches);
    expect(startDraft('blk1', v).content.day).toBe('2026-05-12');
  });
  it('startDraft rejects a version from another block', () => {
    expect(() => startDraft('other', sampleVersion(1))).toThrow();
  });
  it('updateDraft is immutable even if the edit mutates', () => {
    const d0 = frozen(startDraft('blk1', sampleVersion(1)));
    const d1 = updateDraft(d0, (c) => {
      c.caches[0].trees[0].count = 5; // mutation of the copy is allowed
      return c;
    });
    expect(d0.content.caches[0].trees[0].count).toBe(1200);
    expect(d1.content.caches[0].trees[0].count).toBe(5);
    expect(d1.baseVersion).toBe(1);
    expect(d1).not.toBe(d0);
  });
  it('updateDraft bumps updatedAt', () => {
    const d0 = { ...startDraft('blk1', null), updatedAt: '2000-01-01T00:00:00.000Z' };
    expect(updateDraft(d0, (c) => c).updatedAt > d0.updatedAt).toBe(true);
  });
  it('hasChanges', () => {
    const v = sampleVersion(1);
    const d = startDraft('blk1', v);
    expect(hasChanges(d, v)).toBe(false);
    expect(hasChanges(updateDraft(d, (c) => ({ ...c, notes: 'x' })), v)).toBe(true);
    expect(hasChanges(startDraft('blk1', v, '2026-05-13'), v)).toBe(true);
    // undefined vs absent optional field is not a change
    expect(hasChanges(updateDraft(d, (c) => ({ ...c, notes: undefined })), v)).toBe(false);
    const empty = startDraft('blk1', null);
    expect(hasChanges(empty, null)).toBe(false);
    expect(hasChanges(updateDraft(empty, (c) => ({ ...c, planters: [{ id: 'p', name: 'P' }] })), null)).toBe(true);
  });
});

describe('publish', () => {
  it('first publish is version 1 with no parent', () => {
    const d = updateDraft(startDraft('blk1', null, '2026-05-12'), () => samplePlan());
    const v = publish(d, null, 'Max', 'First plan');
    expect(v).toMatchObject({ blockId: 'blk1', version: 1, parentVersion: null, author: 'Max', message: 'First plan' });
    expect(v.quick).toBeUndefined();
    expect(v.content).toEqual(samplePlan());
    expect(Date.parse(v.publishedAt)).not.toBeNaN();
  });
  it('next publish is latest+1 with parent and deep-copied content', () => {
    const v1 = frozen(sampleVersion(1));
    const d = frozen(updateDraft(startDraft('blk1', v1), (c) => ({ ...c, notes: 'rain' })));
    const v2 = publish(d, v1, 'Max');
    expect(v2.version).toBe(2);
    expect(v2.parentVersion).toBe(1);
    expect(v2.content.notes).toBe('rain');
    expect(v2.content).not.toBe(d.content);
    expect(v2.content.caches[0]).not.toBe(d.content.caches[0]);
    expect('message' in v2).toBe(false);
  });
  it('conflict when someone published in between', () => {
    const v1 = sampleVersion(1);
    const d = startDraft('blk1', v1);
    const v2 = sampleVersion(2);
    expect(() => publish(d, v2, 'Max')).toThrow(PublishConflictError);
    try {
      publish(d, v2, 'Max');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).toBe('PublishConflictError');
      expect((e as Error).message).toMatch(/version 2/);
    }
  });
  it('conflict when draft has no base but a version exists, or vice versa', () => {
    expect(() => publish(startDraft('blk1', null), sampleVersion(1), 'Max')).toThrow(PublishConflictError);
    expect(() => publish(startDraft('blk1', sampleVersion(1)), null, 'Max')).toThrow(PublishConflictError);
  });
});

describe('quickPublish', () => {
  it('applies a single change on top of latest, marked quick', () => {
    const v3 = frozen(sampleVersion(3));
    const v4 = quickPublish(
      v3,
      (c: PlanContent) => ({ ...c, assignments: c.assignments.map((a) => (a.planterId === 'p2' ? { ...a, pieceId: 'pc1' } : a)) }),
      'Max',
      'Sam to Piece 1',
    );
    expect(v4).toMatchObject({ version: 4, parentVersion: 3, quick: true, message: 'Sam to Piece 1' });
    expect(assignmentFor(v4.content, 'p2')?.pieceId).toBe('pc1');
    expect(assignmentFor(v3.content, 'p2')?.pieceId).toBe('pc2');
  });
  it('edit receives a copy (mutating edits are safe)', () => {
    const v1 = sampleVersion(1);
    const v2 = quickPublish(v1, (c) => {
      c.caches[0].position = ORIGIN;
      return c;
    }, 'Max');
    expect(v1.content.caches[0].position).not.toEqual(ORIGIN);
    expect(v2.content.caches[0].position).toEqual(ORIGIN);
  });
});

describe('revertTo', () => {
  it('creates a new version with the old content; history untouched', () => {
    const v1 = frozen(sampleVersion(1));
    const v2 = frozen(quickPublish(v1, (c) => ({ ...c, caches: [] }), 'Max'));
    const v3 = revertTo(v1, v2, 'Max');
    expect(v3).toMatchObject({ version: 3, parentVersion: 2, author: 'Max', message: 'Reverted to version 1' });
    expect(v3.content).toEqual(v1.content);
    expect(v3.content).not.toBe(v1.content);
    expect(v3.quick).toBeUndefined();
    expect(v2.content.caches).toEqual([]);
  });
  it('rejects other blocks and future versions', () => {
    const v2 = sampleVersion(2);
    expect(() => revertTo({ ...sampleVersion(1), blockId: 'x' }, v2, 'Max')).toThrow();
    expect(() => revertTo(sampleVersion(5), v2, 'Max')).toThrow();
  });
});
