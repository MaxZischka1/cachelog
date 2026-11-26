import { useMemo } from 'react';
import { today } from '../../core/plan';
import { activeEntries } from '../../core/tally';
import type { BagUpEntry, Block, ID, LogEntry, VoidEntry } from '../../core/types';
import { earningsFor, shiftDay } from '../format';
import { useStoreQuery } from '../store';

export interface MyDay {
  /** Today's bag-ups that still count, oldest first. */
  bagups: BagUpEntry[];
  /** Today's bag-ups that were voided, with the void that cancelled them. */
  voided: { entry: BagUpEntry; void: VoidEntry }[];
  trees: number;
  cents: number;
  /** Trees bagged yesterday, across every block on this phone. null when nothing was logged. */
  yesterday: number | null;
  last: BagUpEntry | null;
}

/** The planter's own numbers for today (and yesterday, for pace), from every block on this phone. */
export function useMyDay(planterId: ID | undefined) {
  const day = today();
  const yday = shiftDay(day, -1);
  const q = useStoreQuery(async (s) => {
    const blocks = await s.listBlocks();
    const logs = await Promise.all(blocks.map((b) => s.listLog(b.id)));
    return { blocks: new Map(blocks.map((b) => [b.id, b] as const)), log: logs.flat() };
  }, []);

  const data = useMemo<MyDay | null>(() => {
    if (!q.data || !planterId) return null;
    const { blocks, log } = q.data;
    const isMine = (e: LogEntry): e is BagUpEntry => e.type === 'bagup' && e.planterId === planterId;
    const active = activeEntries(log);
    const bagups = active.filter((e): e is BagUpEntry => isMine(e) && e.day === day).sort(byTime);
    const activeIds = new Set(active.map((e) => e.id));
    const voids = log.filter((e): e is VoidEntry => e.type === 'void');
    const voided = log
      .filter((e): e is BagUpEntry => isMine(e) && e.day === day && !activeIds.has(e.id))
      .map((entry) => ({ entry, void: voids.find((v) => v.targetId === entry.id)! }))
      .filter((x) => !!x.void);
    const count = (list: BagUpEntry[]) => list.reduce((s, e) => s + e.trees.reduce((a, t) => a + t.count, 0), 0);
    const cents = bagups.reduce((s, e) => s + priced(e, blocks), 0);
    const ydayList = active.filter((e): e is BagUpEntry => isMine(e) && e.day === yday);
    return {
      bagups,
      voided,
      trees: count(bagups),
      cents,
      yesterday: ydayList.length ? count(ydayList) : null,
      last: bagups[bagups.length - 1] ?? null,
    };
  }, [q.data, planterId, day, yday]);

  return { data, loading: q.loading };
}

function byTime(a: LogEntry, b: LogEntry) {
  return a.createdAt.localeCompare(b.createdAt);
}

function priced(e: BagUpEntry, blocks: Map<ID, Block>) {
  const b = blocks.get(e.blockId);
  return b ? earningsFor(e.trees, b) : 0;
}
