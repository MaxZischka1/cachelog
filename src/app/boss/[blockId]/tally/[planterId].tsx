import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { assignmentFor, today } from '../../../../core/plan';
import { formatCents } from '../../../../core/tally';
import type { ID, LogEntry, SpeciesCount } from '../../../../core/types';
import { showError } from '../../../../ui/alerts';
import { Button } from '../../../../ui/Button';
import { Card } from '../../../../ui/Card';
import { EntryList } from '../../../../ui/EntryList';
import { fmtCountsInline, fmtDay, fmtInt, speciesFromBlock } from '../../../../ui/format';
import { useDayData, useLogWriter } from '../../../../ui/hooks/useLogWriter';
import { ChipPicker } from '../../../../ui/Pickers';
import { Screen } from '../../../../ui/Screen';
import { EmptyState, Flag, InfoRow, Section } from '../../../../ui/Section';
import { cleanCounts, SpeciesCountsEditor, totalCount } from '../../../../ui/SpeciesCountsEditor';

/** Tally entry for one planter: piece + trees by species. Corrections = void + new entry. */
export default function PlanterTally() {
  const { blockId, planterId, day: dayParam } = useLocalSearchParams<{ blockId: string; planterId: string; day?: string }>();
  const day = dayParam || today();
  const { block, plan, summary, log } = useDayData(blockId, day);
  const { add, voidIt } = useLogWriter(blockId, day);
  const [pieceId, setPieceId] = useState<ID | undefined>();
  const [trees, setTrees] = useState<SpeciesCount[]>([]);
  const [busy, setBusy] = useState(false);

  const planter = plan?.planters.find((p) => p.id === planterId);
  const pd = summary?.planters.find((p) => p.planterId === planterId);
  const species = useMemo(() => speciesFromBlock(block, plan), [block, plan]);

  // Defaults: assigned piece, and the species the piece's prescription (or the block) uses.
  useEffect(() => {
    if (!plan || pieceId) return;
    const a = assignmentFor(plan, planterId);
    setPieceId(a?.pieceId ?? plan.pieces[0]?.id);
    const rx = plan.pieces.find((p) => p.id === a?.pieceId)?.prescription?.species;
    setTrees((rx?.length ? rx : species.slice(0, 1)).map((s) => ({ species: s, count: 0 })));
  }, [plan, planterId, pieceId, species]);

  if (!plan || !block) return <Screen>{null}</Screen>;
  if (!planter) return <Screen><EmptyState title="Planter not in this plan" /></Screen>;

  const save = async () => {
    const clean = cleanCounts(trees);
    if (!pieceId) return showError('Pick a piece', 'Which piece were these trees planted in?');
    if (clean.length === 0) return showError('No trees entered', 'Enter a count for at least one species.');
    setBusy(true);
    try {
      await add('tally', { planterId, pieceId, trees: clean });
      setTrees(clean.map((t) => ({ species: t.species, count: 0 })));
      Alert.alert('Tally saved', `${planter.name}: ${fmtCountsInline(clean)}`);
    } catch (e) {
      showError('Could not save the tally', e);
    } finally {
      setBusy(false);
    }
  };

  const describe = (e: LogEntry) => {
    if (e.type === 'tally') return `Tally ${plan.pieces.find((p) => p.id === e.pieceId)?.name ?? 'piece'}: ${fmtCountsInline(e.trees)}`;
    if (e.type === 'bagup') return `Bag-up at ${plan.caches.find((c) => c.id === e.cacheId)?.name ?? 'cache'}: ${fmtCountsInline(e.trees)}`;
    return e.type;
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: `${planter.name} · ${fmtDay(day)}` }} />
      {pd ? (
        <Card tone={pd.flags.length ? 'warning' : 'ok'}>
          <InfoRow label="Tallied today" value={fmtInt(pd.totalTallied)} big />
          <InfoRow label="Earnings" value={formatCents(pd.earningsCents)} />
          {pd.bagged.length ? <InfoRow label="Bagged" value={fmtCountsInline(pd.bagged)} /> : null}
          {pd.flags.map((f, i) => <Flag key={i} text={f} />)}
        </Card>
      ) : null}

      <Section title="Piece">
        <ChipPicker options={plan.pieces.map((p) => ({ value: p.id, label: p.name }))} value={pieceId} onChange={setPieceId} />
      </Section>
      <Section title="Trees planted">
        <SpeciesCountsEditor value={trees} onChange={setTrees} speciesOptions={species} />
      </Section>
      <Button title={`Save tally (${fmtInt(totalCount(trees))})`} size="big" busy={busy} onPress={save} />

      <Section title="Entries today">
        <EntryList
          log={log}
          filter={(e) => (e.type === 'tally' || e.type === 'bagup') && e.planterId === planterId}
          describe={describe}
          onVoid={voidIt}
          emptyText="No tallies or bag-ups yet."
        />
      </Section>
    </Screen>
  );
}
