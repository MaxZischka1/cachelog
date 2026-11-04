import type { Assignment, DayString, ID, PlanContent, SpeciesCount } from '../types';

export function emptyPlan(blockId: ID, day: DayString): PlanContent {
  return { blockId, day, planters: [], caches: [], pieces: [], assignments: [], hazards: [] };
}

/** Deep copy of plain JSON-like data (plan content, versions, blocks). */
export function deepCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as object)) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = deepCopy(v);
  }
  return out as T;
}

/** Stable JSON with sorted keys and undefined properties dropped; used for equality. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const keys = Object.keys(value as object)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Sum counts per species (merging duplicates), dropping zeros, sorted by species. */
export function sumSpecies(lists: SpeciesCount[][]): SpeciesCount[] {
  const totals = new Map<string, number>();
  for (const list of lists) {
    for (const { species, count } of list) {
      totals.set(species, (totals.get(species) ?? 0) + count);
    }
  }
  return [...totals.entries()]
    .filter(([, count]) => count !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([species, count]) => ({ species, count }));
}

/** Totals by species across all caches (truck / heli manifest), sorted by species code. */
export function loadList(plan: PlanContent): SpeciesCount[] {
  return sumSpecies(plan.caches.map((c) => c.trees));
}

/** The planter's assignment (first one if, unexpectedly, there are several). */
export function assignmentFor(plan: PlanContent, planterId: ID): Assignment | undefined {
  return plan.assignments.find((a) => a.planterId === planterId);
}
