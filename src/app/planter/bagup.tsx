import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { today } from '../../core/plan';
import { activeEntries } from '../../core/tally';
import type { BagUpEntry, ID, LogEntry, SpeciesCount } from '../../core/types';
import { showError } from '../../ui/alerts';
import { Button } from '../../ui/Button';
import { EntryList } from '../../ui/EntryList';
import { fmtCountsInline, fmtInt, speciesFromBlock } from '../../ui/format';
import { useLogWriter } from '../../ui/hooks/useLogWriter';
import { usePlanterData } from '../../ui/hooks/usePlanter';
import { ChipPicker } from '../../ui/Pickers';
import { Screen } from '../../ui/Screen';
import { EmptyState, Section } from '../../ui/Section';
import { cleanCounts, SpeciesCountsEditor, totalCount } from '../../ui/SpeciesCountsEditor';
import { useLog } from '../../ui/store';
import { colors, font } from '../../ui/theme';

/** Bundle sizes offered as big + buttons. */
const QUICK_ADDS = [15, 20, 25, 100];

/** Log a bag-up: which cache (defaults to mine) and trees by species. */
export default function BagUp() {
  const d = usePlanterData();
  const day = today();
  const { data: log } = useLog(d.blockId, day);
  const { add, voidIt } = useLogWriter(d.blockId, day);
  const [cacheId, setCacheId] = useState<ID | undefined>();
  const [trees, setTrees] = useState<SpeciesCount[]>([]);
  const [busy, setBusy] = useState(false);
  const species = useMemo(() => speciesFromBlock(d.block, d.plan), [d.block, d.plan]);

  const myBagups = useMemo(
    () => activeEntries(log ?? []).filter((e): e is BagUpEntry => e.type === 'bagup' && e.planterId === d.planter?.id),
    [log, d.planter],
  );
  const last = myBagups[myBagups.length - 1];
  const dayTotal = myBagups.reduce((s, e) => s + totalCount(e.trees), 0);

  // Defaults: my cache; species from my cache, else piece prescription, else block.
  useEffect(() => {
    if (!d.plan || cacheId) return;
    setCacheId(d.cache?.id ?? d.plan.caches[0]?.id);
    const sp = d.cache?.trees.map((t) => t.species) ?? d.piece?.prescription?.species ?? species.slice(0, 1);
    setTrees(sp.map((s) => ({ species: s, count: 0 })));
  }, [d.plan, d.cache, d.piece, cacheId, species]);

  if (!d.plan || !d.block) return <Screen><EmptyState title="Import a plan first" /></Screen>;
  if (!d.planter) return <Screen><EmptyState title="Pick which planter you are first" message="Go back and tap “Which planter am I?”." /></Screen>;
  const planterId = d.planter.id;

  const save = async () => {
    const clean = cleanCounts(trees);
    if (!cacheId) return showError('Pick a cache', 'Which cache did you bag up from?');
    if (clean.length === 0) return showError('No trees entered', 'Tap the + buttons or type a count.');
    setBusy(true);
    try {
      await add('bagup', { planterId, cacheId, trees: clean });
      setTrees(clean.map((t) => ({ species: t.species, count: 0 })));
      Alert.alert('Bag-up logged', `${fmtCountsInline(clean)}\nToday: ${fmtInt(dayTotal + totalCount(clean))}`);
    } catch (e) {
      showError('Could not log the bag-up', e);
    } finally {
      setBusy(false);
    }
  };

  const describe = (e: LogEntry) => (e.type === 'bagup' ? `${d.plan?.caches.find((c) => c.id === e.cacheId)?.name ?? 'Cache'}: ${fmtCountsInline(e.trees)}` : e.type);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Bag-up' }} />
      <Text style={styles.today}>Today: {fmtInt(dayTotal)} trees</Text>
      <Section title="From cache">
        <ChipPicker
          options={d.plan.caches.map((c) => ({ value: c.id, label: c.name, sublabel: c.id === d.cache?.id ? 'mine' : undefined }))}
          value={cacheId}
          onChange={setCacheId}
        />
      </Section>
      <Section title="Trees" right={last ? <Button title="Same as last" size="small" variant="secondary" onPress={() => { setTrees(last.trees.map((t) => ({ ...t }))); setCacheId(last.cacheId); }} /> : undefined}>
        <SpeciesCountsEditor value={trees} onChange={setTrees} speciesOptions={species} quickAdds={QUICK_ADDS} />
      </Section>
      <Button title={`Log bag-up (${fmtInt(totalCount(trees))})`} size="big" busy={busy} onPress={save} />
      <Section title="My bag-ups today">
        <EntryList log={log ?? []} filter={(e) => e.type === 'bagup' && e.planterId === planterId} describe={describe} onVoid={voidIt} emptyText="No bag-ups yet today." />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  today: { fontSize: font.title, fontWeight: '800', color: colors.text, textAlign: 'center' },
});
