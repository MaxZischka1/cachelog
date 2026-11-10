import { mergePlans, rebaseDraft } from './merge';
import { makeSuggestion, parseSuggestion, serializeSuggestion, sniffFile, makePlanFile, serializePlanFile, parsePlanFile, PlanFileError } from './planFile';
import { quickPublish, startDraft, updateDraft, publish } from './versioning';
import { diffPlans } from './diff';
import { offsetM, ORIGIN, sampleBlock, samplePlan, sampleVersion } from './testFixtures';

describe('mergePlans', () => {
  test('keeps my edits and picks up their unrelated edits', () => {
    const base = samplePlan();
    const mine = samplePlan();
    mine.caches[0].trees = [{ species: 'Sx', count: 900 }];
    mine.caches.push({ id: 'c3', name: 'Cache 3', position: offsetM(ORIGIN, 300, 300), trees: [] });
    const theirs = samplePlan();
    theirs.assignments[1] = { planterId: 'p2', pieceId: 'pc1' };
    theirs.hazards = [];
    const { content, conflicts } = mergePlans(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(content.caches.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(content.caches[0].trees).toEqual([{ species: 'Sx', count: 900 }]);
    expect(content.assignments.find((a) => a.planterId === 'p2')?.pieceId).toBe('pc1');
    expect(content.hazards).toEqual([]);
  });

  test('same entity changed on both sides: mine wins and is reported', () => {
    const base = samplePlan();
    const mine = samplePlan();
    mine.caches[1].name = 'Landing cache';
    const theirs = samplePlan();
    theirs.caches[1].trees = [{ species: 'Sx', count: 100 }];
    const { content, conflicts } = mergePlans(base, mine, theirs);
    expect(content.caches[1].name).toBe('Landing cache');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatch(/Landing cache was changed on both sides/);
  });

  test('identical edits on both sides are not a conflict', () => {
    const base = samplePlan();
    const mine = samplePlan();
    mine.caches[1].name = 'X';
    const theirs = samplePlan();
    theirs.caches[1].name = 'X';
    expect(mergePlans(base, mine, theirs).conflicts).toEqual([]);
  });

  test('assignment to a piece the other side removed is dropped with a note', () => {
    const base = samplePlan();
    const mine = samplePlan();
    mine.assignments[0] = { planterId: 'p1', pieceId: 'pc2', cacheId: 'c2' };
    const theirs = samplePlan();
    theirs.pieces = theirs.pieces.filter((p) => p.id !== 'pc2');
    theirs.assignments = theirs.assignments.filter((a) => a.pieceId !== 'pc2');
    const { content, conflicts } = mergePlans(base, mine, theirs);
    expect(content.assignments.find((a) => a.planterId === 'p1')).toBeUndefined();
    expect(conflicts.join(' ')).toMatch(/Jess was assigned to a piece that no longer exists/);
  });

  test('no common base: union, mine wins on clashes', () => {
    const mine = samplePlan();
    mine.caches = [{ ...mine.caches[0], name: 'Mine' }];
    const theirs = samplePlan();
    const { content } = mergePlans(null, mine, theirs);
    expect(content.caches.map((c) => c.name)).toEqual(['Mine', 'Cache 2']);
  });
});

describe('rebaseDraft', () => {
  test('a quick change no longer strands the draft', () => {
    const v1 = sampleVersion(1);
    let draft = startDraft('blk1', v1);
    draft = updateDraft(draft, (c) => ({ ...c, notes: 'Start at the north end' }));
    const v2 = quickPublish(v1, (c) => ({ ...c, hazards: [] }), 'Max');
    const r = rebaseDraft(draft, v1, v2);
    expect(r.rebased).toBe(true);
    expect(r.draft.baseVersion).toBe(2);
    expect(r.draft.content.hazards).toEqual([]);
    expect(r.draft.content.notes).toBe('Start at the north end');
    // The review now shows only the draft's own change, and it publishes cleanly.
    expect(diffPlans(v2.content, r.draft.content)).toHaveLength(1);
    expect(publish(r.draft, v2, 'Max').version).toBe(3);
  });

  test('untouched when already on the latest version', () => {
    const v1 = sampleVersion(1);
    const draft = startDraft('blk1', v1);
    expect(rebaseDraft(draft, v1, v1).rebased).toBe(false);
  });
});

describe('suggestions and file sniffing', () => {
  test('round-trips a suggestion', () => {
    const draft = updateDraft(startDraft('blk1', sampleVersion(2)), (c) => ({ ...c, notes: 'Swap pieces' }));
    const s = parseSuggestion(serializeSuggestion(makeSuggestion(sampleBlock(), draft, 'Sam', ' try this ')));
    expect(s.baseVersion).toBe(2);
    expect(s.author).toBe('Sam');
    expect(s.message).toBe('try this');
    expect(s.content.notes).toBe('Swap pieces');
  });

  test('rejects non-suggestions and damaged content', () => {
    expect(() => parseSuggestion('{}')).toThrow(PlanFileError);
    const s: any = makeSuggestion(sampleBlock(), startDraft('blk1', sampleVersion()), 'Sam');
    s.content.caches[0].position = [999, 999];
    expect(() => parseSuggestion(JSON.stringify(s))).toThrow(/damaged/);
  });

  test('sniffFile tells the three file kinds apart', () => {
    const plan = serializePlanFile(makePlanFile(sampleBlock(), sampleVersion()));
    const sug = serializeSuggestion(makeSuggestion(sampleBlock(), startDraft('blk1', sampleVersion()), 'Sam'));
    expect(sniffFile(plan)).toBe('plan');
    expect(sniffFile(sug)).toBe('suggestion');
    expect(sniffFile('{"format":"cachelog-log","entries":[]}')).toBe('updates');
    expect(sniffFile('{"entries":[],"format":"cachelog-log"}')).toBe('updates');
    expect(sniffFile('hello')).toBe('unknown');
  });

  test('plan files carry crew pins and reject bad ones', () => {
    const pin = { id: 'pin1', type: 'pin', kind: 'hazard', position: ORIGIN, note: 'wasps', blockId: 'blk1', day: '2026-05-12', createdAt: '2026-05-12T15:00:00.000Z', deviceId: 'd', author: 'Jess' };
    const f: any = { ...makePlanFile(sampleBlock(), sampleVersion()), pins: [pin] };
    expect(parsePlanFile(serializePlanFile(f)).pins).toHaveLength(1);
    f.pins = [{ ...pin, kind: 'nonsense' }];
    expect(() => parsePlanFile(serializePlanFile(f))).toThrow(PlanFileError);
  });
});
