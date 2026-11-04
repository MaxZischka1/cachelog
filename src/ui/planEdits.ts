/** Small immutable edit helpers for PlanContent, used with updateDraft / quickPublish. */
import type { Assignment, Cache, Hazard, ID, PlanContent, Piece, Planter } from '../core/types';

function upsert<T extends { id: ID }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

export const upsertCache = (cache: Cache) => (c: PlanContent): PlanContent => ({ ...c, caches: upsert(c.caches, cache) });

export const removeCache = (id: ID) => (c: PlanContent): PlanContent => ({
  ...c,
  caches: c.caches.filter((x) => x.id !== id),
  assignments: c.assignments.map((a) => (a.cacheId === id ? { ...a, cacheId: undefined } : a)),
});

export const upsertPiece = (piece: Piece) => (c: PlanContent): PlanContent => ({ ...c, pieces: upsert(c.pieces, piece) });

export const addPieces = (pieces: Piece[]) => (c: PlanContent): PlanContent => ({ ...c, pieces: [...c.pieces, ...pieces] });

export const removePiece = (id: ID) => (c: PlanContent): PlanContent => ({
  ...c,
  pieces: c.pieces.filter((x) => x.id !== id),
  assignments: c.assignments.filter((a) => a.pieceId !== id),
});

export const upsertHazard = (h: Hazard) => (c: PlanContent): PlanContent => ({ ...c, hazards: upsert(c.hazards, h) });

export const removeHazard = (id: ID) => (c: PlanContent): PlanContent => ({ ...c, hazards: c.hazards.filter((x) => x.id !== id) });

export const upsertPlanter = (p: Planter) => (c: PlanContent): PlanContent => ({ ...c, planters: upsert(c.planters, p) });

export const removePlanter = (id: ID) => (c: PlanContent): PlanContent => ({
  ...c,
  planters: c.planters.filter((x) => x.id !== id),
  assignments: c.assignments.filter((a) => a.planterId !== id),
});

/** Set (or clear, when pieceId is undefined) a planter's assignment. */
export const setAssignment = (planterId: ID, pieceId: ID | undefined, cacheId: ID | undefined) => (c: PlanContent): PlanContent => {
  const rest = c.assignments.filter((a) => a.planterId !== planterId);
  if (!pieceId) return { ...c, assignments: rest };
  const a: Assignment = cacheId ? { planterId, pieceId, cacheId } : { planterId, pieceId };
  // keep order stable
  const i = c.assignments.findIndex((x) => x.planterId === planterId);
  if (i === -1) return { ...c, assignments: [...rest, a] };
  const copy = c.assignments.slice();
  copy[i] = a;
  return { ...c, assignments: copy };
};

export const setPlanNotes = (notes: string) => (c: PlanContent): PlanContent => ({ ...c, notes: notes.trim() ? notes : undefined });

/** Next default name like "Cache 4" given existing names. */
export function nextName(prefix: string, existing: { name: string }[]): string {
  let max = 0;
  const re = new RegExp(`^${prefix}\\s+(\\d+)$`, 'i');
  for (const e of existing) {
    const m = re.exec(e.name.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix} ${Math.max(max, existing.length) + 1}`;
}
