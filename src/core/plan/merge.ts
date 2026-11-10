import type { Assignment, Cache, Draft, Hazard, ID, Piece, PlanContent, PlanVersion, Planter } from '../types';
import { deepCopy, deepEqual } from './content';
import { nowIso } from './ids';

/**
 * Three-way merge of plan content, entity by entity (like git, but per cache / piece / planter /
 * hazard / assignment rather than per line).
 *
 *  - base:   the version both sides started from (null: nothing was published)
 *  - mine:   the content that wins when both sides changed the same thing
 *  - theirs: the other side (usually the latest published plan)
 *
 * For each entity: if mine left it as it was in base, take theirs (including a removal);
 * otherwise take mine. When both changed the same entity differently, mine wins and the
 * entity is reported in `conflicts` so a person can check it.
 */
export interface MergeResult {
  content: PlanContent;
  /** Plain-language notes, e.g. "Cache 3 was changed on both sides; kept your version". */
  conflicts: string[];
}

type Named = { id: ID; name?: string; note?: string };

function mergeList<T>(
  base: T[],
  mine: T[],
  theirs: T[],
  key: (t: T) => ID,
  describe: (t: T) => string,
  conflicts: string[],
): T[] {
  const b = new Map(base.map((x) => [key(x), x] as const));
  const m = new Map(mine.map((x) => [key(x), x] as const));
  const t = new Map(theirs.map((x) => [key(x), x] as const));
  const out: T[] = [];
  const seen = new Set<ID>();

  const resolve = (id: ID): T | undefined => {
    const bx = b.get(id);
    const mx = m.get(id);
    const tx = t.get(id);
    const mineChanged = !deepEqual(mx ?? null, bx ?? null);
    const theirsChanged = !deepEqual(tx ?? null, bx ?? null);
    if (!mineChanged) return tx;
    if (theirsChanged && !deepEqual(mx ?? null, tx ?? null)) {
      const subject = describe((mx ?? tx ?? bx) as T);
      conflicts.push(
        mx === undefined
          ? `${subject} was removed here but changed in the other plan; kept it removed`
          : tx === undefined
            ? `${subject} was changed here but removed in the other plan; kept it`
            : `${subject} was changed on both sides; kept this version`,
      );
    }
    return mx;
  };

  // Their order first (it is the published order), then anything only mine has.
  for (const x of theirs) {
    const id = key(x);
    seen.add(id);
    const r = resolve(id);
    if (r !== undefined) out.push(r);
  }
  for (const x of mine) {
    const id = key(x);
    if (seen.has(id)) continue;
    seen.add(id);
    const r = resolve(id);
    if (r !== undefined) out.push(r);
  }
  return out;
}

const named = (kind: string) => (x: Named) => x.name ?? (x.note ? `${kind} “${x.note}”` : kind);

export function mergePlans(base: PlanContent | null, mine: PlanContent, theirs: PlanContent): MergeResult {
  const conflicts: string[] = [];
  const b: PlanContent = base ?? { ...theirs, planters: [], caches: [], pieces: [], assignments: [], hazards: [], notes: undefined };

  const planters = mergeList<Planter>(b.planters, mine.planters, theirs.planters, (x) => x.id, named('Planter'), conflicts);
  const caches = mergeList<Cache>(b.caches, mine.caches, theirs.caches, (x) => x.id, named('Cache'), conflicts);
  const pieces = mergeList<Piece>(b.pieces, mine.pieces, theirs.pieces, (x) => x.id, named('Piece'), conflicts);
  const hazards = mergeList<Hazard>(b.hazards, mine.hazards, theirs.hazards, (x) => x.id, named('Hazard'), conflicts);

  const nameOf = (id: ID) =>
    [...mine.planters, ...theirs.planters, ...b.planters].find((p) => p.id === id)?.name ?? 'A planter';
  let assignments = mergeList<Assignment>(
    b.assignments,
    mine.assignments,
    theirs.assignments,
    (x) => x.planterId,
    (x) => `${nameOf(x.planterId)}'s assignment`,
    conflicts,
  );

  // Keep the result consistent: drop assignments that point at things the merge removed.
  const planterIds = new Set(planters.map((p) => p.id));
  const pieceIds = new Set(pieces.map((p) => p.id));
  const cacheIds = new Set(caches.map((c) => c.id));
  assignments = assignments
    .filter((a) => {
      const ok = planterIds.has(a.planterId) && pieceIds.has(a.pieceId);
      if (!ok && planterIds.has(a.planterId)) conflicts.push(`${nameOf(a.planterId)} was assigned to a piece that no longer exists; now unassigned`);
      return ok;
    })
    .map((a) => (a.cacheId && !cacheIds.has(a.cacheId) ? { planterId: a.planterId, pieceId: a.pieceId } : a));

  const pick = <K extends 'day' | 'notes'>(k: K): PlanContent[K] => {
    const mineChanged = !deepEqual(mine[k] ?? null, b[k] ?? null);
    return mineChanged ? mine[k] : theirs[k];
  };
  if (base && !deepEqual(mine.notes ?? null, b.notes ?? null) && !deepEqual(theirs.notes ?? null, b.notes ?? null) && mine.notes !== theirs.notes) {
    conflicts.push('The day notes were changed on both sides; kept this version');
  }

  const content: PlanContent = deepCopy({
    blockId: theirs.blockId,
    day: base ? pick('day') : mine.day,
    planters,
    caches,
    pieces,
    assignments,
    hazards,
    notes: base ? pick('notes') : mine.notes ?? theirs.notes,
  });
  return { content, conflicts };
}

/**
 * Move a draft onto the latest published version, keeping the draft's own edits.
 * `base` is the version the draft was started from (null if it can't be found or nothing was published).
 * Returns the draft untouched when it is already based on `latest`.
 */
export function rebaseDraft(draft: Draft, base: PlanVersion | null, latest: PlanVersion | null): { draft: Draft; conflicts: string[]; rebased: boolean } {
  const latestVersion = latest?.version ?? null;
  if (draft.baseVersion === latestVersion || !latest) return { draft, conflicts: [], rebased: false };
  const { content, conflicts } = mergePlans(base?.content ?? null, draft.content, latest.content);
  return { draft: { blockId: draft.blockId, baseVersion: latest.version, content, updatedAt: nowIso() }, conflicts, rebased: true };
}
