import type { DayString, ID, LogEntry, VoidEntry } from '../types';
import { newId, nowIso } from './util';

/** The fields every log entry gets from makeEntry/voidEntry rather than from the caller. */
export type LogBaseFields = Pick<VoidEntry, 'id' | 'blockId' | 'day' | 'createdAt' | 'deviceId' | 'author'>;

/**
 * Drops voided entries and the voids themselves.
 *
 * A void can itself be voided ("undo the correction"): a void only takes effect if it is not
 * voided by an effective void. Voids pointing at unknown ids are simply dropped.
 * Order of the remaining entries is preserved.
 */
export function activeEntries(log: LogEntry[]): LogEntry[] {
  const voidsByTarget = new Map<ID, VoidEntry[]>();
  for (const e of log) {
    if (e.type !== 'void') continue;
    const list = voidsByTarget.get(e.targetId);
    if (list) list.push(e);
    else voidsByTarget.set(e.targetId, [e]);
  }

  const memo = new Map<ID, boolean>();
  const isVoided = (id: ID, visiting: Set<ID>): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return false; // cycle guard (cannot happen with real data)
    visiting.add(id);
    const voids = voidsByTarget.get(id) ?? [];
    const result = voids.some((v) => !isVoided(v.id, visiting));
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };

  return log.filter((e) => e.type !== 'void' && !isVoided(e.id, new Set()));
}

type EntryOf<T extends LogEntry['type']> = Extract<LogEntry, { type: T }>;

export function makeEntry<T extends LogEntry['type']>(
  type: T,
  fields: Omit<EntryOf<T>, keyof LogBaseFields | 'type'>,
  ctx: { blockId: ID; day: DayString; deviceId: string; author: string },
): EntryOf<T> {
  const entry = {
    ...(fields as object),
    type,
    id: newId(),
    blockId: ctx.blockId,
    day: ctx.day,
    createdAt: nowIso(),
    deviceId: ctx.deviceId,
    author: ctx.author,
  };
  return entry as unknown as EntryOf<T>;
}

/** Correction for `target`; lands on the same block and day as the entry it cancels. */
export function voidEntry(target: LogEntry, reason: string, ctx: { deviceId: string; author: string }): VoidEntry {
  return {
    type: 'void',
    id: newId(),
    blockId: target.blockId,
    day: target.day,
    createdAt: nowIso(),
    deviceId: ctx.deviceId,
    author: ctx.author,
    targetId: target.id,
    reason,
  };
}

/** Active entries for one block and day, in log order. */
export function entriesForDay(log: LogEntry[], blockId: ID, day: DayString): LogEntry[] {
  return activeEntries(log).filter((e) => e.blockId === blockId && e.day === day);
}

/** Stable sort by (day, createdAt), keeping log order for ties. */
export function chronological<E extends LogEntry>(entries: E[]): E[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (a.e.day !== b.e.day) return a.e.day < b.e.day ? -1 : 1;
      if (a.e.createdAt !== b.e.createdAt) return a.e.createdAt < b.e.createdAt ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.e);
}
