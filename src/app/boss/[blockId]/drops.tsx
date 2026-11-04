import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { today } from '../../../core/plan';
import type { ID, LogEntry, SpeciesCount } from '../../../core/types';
import { showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { EntryList } from '../../../ui/EntryList';
import { fmtCountsInline, fmtDay, fmtInt, speciesFromBlock } from '../../../ui/format';
import { useDayData, useLogWriter } from '../../../ui/hooks/useLogWriter';
import { ChipPicker } from '../../../ui/Pickers';
import { Screen } from '../../../ui/Screen';
import { EmptyState, Muted, Section } from '../../../ui/Section';
import { cleanCounts, SpeciesCountsEditor, totalCount } from '../../../ui/SpeciesCountsEditor';

/** Log trees actually dropped at a cache (truck / heli delivery). */
export default function DropsScreen() {
  const { blockId, day: dayParam } = useLocalSearchParams<{ blockId: string; day?: string }>();
  const day = dayParam || today();
  const { block, plan, log } = useDayData(blockId, day);
  const { add, voidIt } = useLogWriter(blockId, day);
  const [cacheId, setCacheId] = useState<ID | undefined>();
  const [trees, setTrees] = useState<SpeciesCount[]>([]);
  const [busy, setBusy] = useState(false);
  const species = useMemo(() => speciesFromBlock(block, plan), [block, plan]);

  useEffect(() => {
    if (plan && !cacheId && plan.caches[0]) setCacheId(plan.caches[0].id);
  }, [plan, cacheId]);

  if (!plan || !block) return <Screen>{null}</Screen>;
  if (plan.caches.length === 0) return <Screen><EmptyState title="No caches in the plan" /></Screen>;

  const cache = plan.caches.find((c) => c.id === cacheId);

  const save = async () => {
    const clean = cleanCounts(trees);
    if (!cacheId || !cache) return showError('Pick a cache', 'Which cache were the trees dropped at?');
    if (clean.length === 0) return showError('No trees entered', 'Enter a count for at least one species.');
    setBusy(true);
    try {
      await add('cache-drop', { cacheId, trees: clean });
      setTrees([]);
      Alert.alert('Drop logged', `${cache.name}: ${fmtCountsInline(clean)}`);
    } catch (e) {
      showError('Could not save the drop', e);
    } finally {
      setBusy(false);
    }
  };

  const describe = (e: LogEntry) => (e.type === 'cache-drop' ? `${plan.caches.find((c) => c.id === e.cacheId)?.name ?? 'Cache'}: ${fmtCountsInline(e.trees)}` : e.type);

  return (
    <Screen>
      <Stack.Screen options={{ title: `Cache drops · ${fmtDay(day)}` }} />
      <Section title="Cache">
        <ChipPicker
          options={plan.caches.map((c) => ({ value: c.id, label: c.name }))}
          value={cacheId}
          onChange={(id) => {
            setCacheId(id);
            setTrees([]);
          }}
        />
        {cache ? <Muted>Planned: {fmtCountsInline(cache.trees)}</Muted> : null}
      </Section>
      <Section title="Trees dropped" right={cache && cache.trees.length ? <Button title="Same as planned" size="small" variant="secondary" onPress={() => setTrees(cache.trees.map((t) => ({ ...t })))} /> : undefined}>
        <SpeciesCountsEditor value={trees} onChange={setTrees} speciesOptions={species} />
      </Section>
      <Button title={`Log drop (${fmtInt(totalCount(trees))})`} size="big" busy={busy} onPress={save} />
      <Section title="Drops today">
        <EntryList log={log} filter={(e) => e.type === 'cache-drop'} describe={describe} onVoid={voidIt} emptyText="No drops logged yet." />
      </Section>
    </Screen>
  );
}
