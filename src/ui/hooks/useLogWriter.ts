import { useCallback, useMemo } from 'react';
import { daySummary, makeEntry, voidEntry } from '../../core/tally';
import type { DayString, ID, LogEntry, PlanContent } from '../../core/types';
import { useBlock, useBump, useLatestVersion, useLog, useSettings, useStore } from '../store';

type EntryOf<T extends LogEntry['type']> = Extract<LogEntry, { type: T }>;
type Fields<T extends LogEntry['type']> = Omit<EntryOf<T>, 'id' | 'blockId' | 'day' | 'createdAt' | 'deviceId' | 'author' | 'type'>;

/** Append-only log writes for one block/day, stamped with this device and user. */
export function useLogWriter(blockId: ID | undefined, day: DayString) {
  const store = useStore();
  const bump = useBump();
  const { settings } = useSettings();

  const add = useCallback(
    async <T extends LogEntry['type']>(type: T, fields: Fields<T>): Promise<EntryOf<T>> => {
      if (!blockId) throw new Error('No block selected.');
      if (!settings) throw new Error('Set up this phone first (name and role).');
      const e = makeEntry(type, fields, { blockId, day, deviceId: settings.deviceId, author: settings.userName });
      await store.appendLog([e]);
      bump();
      return e;
    },
    [blockId, day, settings, store, bump],
  );

  const voidIt = useCallback(
    async (target: LogEntry, reason: string) => {
      if (!settings) throw new Error('Set up this phone first (name and role).');
      await store.appendLog([voidEntry(target, reason, { deviceId: settings.deviceId, author: settings.userName })]);
      bump();
    },
    [settings, store, bump],
  );

  return { add, voidIt };
}

/** Block + latest plan + the day's log + summary. The plan is re-dated to `day` so summaries line up. */
export function useDayData(blockId: ID | undefined, day: DayString) {
  const { data: block } = useBlock(blockId);
  const { data: latest } = useLatestVersion(blockId);
  const logQ = useLog(blockId, day);
  const log = logQ.data;

  const plan: PlanContent | null = useMemo(() => (latest ? { ...latest.content, day } : null), [latest, day]);
  const summary = useMemo(() => (plan && block && log ? daySummary(plan, block, log) : null), [plan, block, log]);
  return { block: block ?? null, latest: latest ?? null, plan, log: log ?? [], summary, loading: block === undefined || latest === undefined || log === undefined };
}
