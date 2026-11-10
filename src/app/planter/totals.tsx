import { Stack } from 'expo-router';
import React, { useMemo } from 'react';
import { today } from '../../core/plan';
import { activeEntries, formatCents, seasonTotal } from '../../core/tally';
import { Button } from '../../ui/Button';
import { useSendUpdates } from '../../ui/hooks/useSendUpdates';
import type { Block, ID, LogEntry, SpeciesCount } from '../../core/types';
import { Card } from '../../ui/Card';
import { earningsFor, fmtCountsInline, fmtDay, fmtInt, sumCounts } from '../../ui/format';
import { usePlanterData } from '../../ui/hooks/usePlanter';
import { Screen } from '../../ui/Screen';
import { EmptyState, InfoRow, Muted, Section } from '../../ui/Section';
import { useStoreQuery } from '../../ui/store';

interface Totals {
  trees: SpeciesCount[];
  count: number;
  cents: number;
}

function totalsFor(entries: LogEntry[], planterId: ID, type: 'bagup' | 'tally', blocks: Map<ID, Block>): Totals {
  const mine = activeEntries(entries).filter((e) => e.type === type && e.planterId === planterId) as Extract<LogEntry, { type: 'bagup' | 'tally' }>[];
  let cents = 0;
  for (const e of mine) {
    const b = blocks.get(e.blockId);
    if (b) cents += earningsFor(e.trees, b);
  }
  const trees = sumCounts(mine.map((e) => e.trees));
  return { trees, count: trees.reduce((s, t) => s + t.count, 0), cents };
}

/** My day and season: bagged (from this phone's bag-ups) and tallied (if the crew boss's tallies are on this phone). */
export default function PlanterTotals() {
  const d = usePlanterData();
  const planterId = d.planter?.id;
  const day = today();
  const updates = useSendUpdates(d.blockId);

  // Season = every block on this phone.
  const { data } = useStoreQuery(async (s) => {
    const blocks = await s.listBlocks();
    const logs = await Promise.all(blocks.map((b) => s.listLog(b.id)));
    return { blocks: new Map(blocks.map((b) => [b.id, b] as const)), log: logs.flat() };
  }, []);

  const t = useMemo(() => {
    if (!data || !planterId) return null;
    const todayLog = data.log.filter((e) => e.day === day);
    const days = new Set(activeEntries(data.log).filter((e) => (e.type === 'bagup' || e.type === 'tally') && e.planterId === planterId).map((e) => e.day));
    return {
      dayBag: totalsFor(todayLog, planterId, 'bagup', data.blocks),
      dayTally: totalsFor(todayLog, planterId, 'tally', data.blocks),
      seasonBag: totalsFor(data.log, planterId, 'bagup', data.blocks),
      seasonTallied: seasonTotal(data.log, planterId),
      seasonTally: totalsFor(data.log, planterId, 'tally', data.blocks),
      days: days.size,
    };
  }, [data, planterId, day]);

  if (!d.planter) return <Screen><EmptyState title="Pick which planter you are first" /></Screen>;
  if (!t) return <Screen>{null}</Screen>;

  const avg = t.days > 0 ? Math.round(t.seasonBag.count / t.days) : 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'My totals' }} />
      <Section title={`Today · ${fmtDay(day)}`}>
        <Card tone="ok">
          <InfoRow label="Bagged" value={fmtInt(t.dayBag.count)} big />
          <InfoRow label="Est. earnings" value={formatCents(t.dayBag.cents)} big />
          {t.dayBag.trees.length ? <Muted>{fmtCountsInline(t.dayBag.trees)}</Muted> : null}
          {t.dayTally.count > 0 ? <InfoRow label="Tallied" value={`${fmtInt(t.dayTally.count)} · ${formatCents(t.dayTally.cents)}`} /> : null}
        </Card>
      </Section>
      <Section title="Season (this phone)">
        <Card>
          <InfoRow label="Bagged" value={fmtInt(t.seasonBag.count)} big />
          <InfoRow label="Est. earnings" value={formatCents(t.seasonBag.cents)} />
          <InfoRow label="Days logged" value={String(t.days)} />
          {t.days > 0 ? <InfoRow label="Average / day" value={fmtInt(avg)} /> : null}
          {t.seasonTallied > 0 ? <InfoRow label="Tallied (paid)" value={`${fmtInt(t.seasonTallied)} · ${formatCents(t.seasonTally.cents)}`} /> : null}
        </Card>
      </Section>
      <Button title="Send my updates to crew boss" size="big" busy={updates.sending} onPress={updates.send} />
      <Muted>AirDrop the file to your crew boss at the end of the day. Sending it twice is fine.</Muted>
      <Muted>Estimates use the tree prices in the plan file and your bag-ups. Pay is based on the crew boss’s tallies.</Muted>
    </Screen>
  );
}
