import { router, Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { showError } from '../../ui/alerts';
import { Button } from '../../ui/Button';
import { usePlanterData, useImportPlan } from '../../ui/hooks/usePlanter';
import { MorningBrief } from '../../ui/planter/MorningBrief';
import { Screen } from '../../ui/Screen';
import { EmptyState } from '../../ui/Section';
import { spacing } from '../../ui/theme';

/** Planter home: emergency, morning brief, and the day's actions. */
export default function PlanterHome() {
  const d = usePlanterData();
  const importPlan = useImportPlan();
  const [busy, setBusy] = useState(false);

  // A plan is loaded but this phone doesn't know which planter it is yet.
  useEffect(() => {
    if (!d.loading && d.plan && !d.planter && d.plan.planters.length > 0) router.push('/planter/who');
  }, [d.loading, d.plan, d.planter]);

  const doImport = async () => {
    setBusy(true);
    try {
      const r = await importPlan();
      if (r.status === 'skipped') Alert.alert('Plan not imported', r.message);
      if (r.status === 'imported') {
        const v = r.file.version;
        const what = r.replaced ? `Updated ${r.file.block.name} from v${r.replaced.version} to v${v.version}.` : `Imported ${r.file.block.name} v${v.version}.`;
        const maps = r.droppedMaps.length ? `\n\nMissing map images: ${r.droppedMaps.join(', ')}. Ask your crew boss to share again.` : '';
        Alert.alert('Plan imported', what + maps);
        // the effect above routes to "who am I" if needed
      }
    } catch (e) {
      showError('Could not import the plan', e);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <Stack.Screen
      options={{
        title: d.planter ? d.planter.name : 'Cachelog',
        headerRight: () => <Button title="Settings" variant="ghost" size="small" onPress={() => router.push('/settings')} />,
      }}
    />
  );

  const emergency = (
    <Button title="EMERGENCY" variant="danger" size="big" onPress={() => router.push(d.blockId ? `/emergency?blockId=${d.blockId}` : '/emergency')} />
  );

  if (d.loading) return <Screen>{header}</Screen>;

  if (!d.block || !d.latest) {
    return (
      <Screen>
        {header}
        {emergency}
        <EmptyState title="No plan on this phone yet" message="Ask the crew boss to AirDrop today’s plan, then import it here." />
        <Button title="Import plan file" size="big" busy={busy} onPress={doImport} />
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      {emergency}
      <View style={styles.actions}>
        <Button title="Log bag-up" size="big" onPress={() => router.push('/planter/bagup')} />
        <View style={styles.row}>
          <Button style={styles.flex} title="Map" size="big" variant="secondary" onPress={() => router.push('/planter/map')} />
          <Button style={styles.flex} title="My totals" size="big" variant="secondary" onPress={() => router.push('/planter/totals')} />
        </View>
      </View>
      <MorningBrief block={d.block} version={d.latest} piece={d.piece} cache={d.cache} />
      <Button title="Import new plan" variant="secondary" busy={busy} onPress={doImport} />
      <Button title={d.planter ? `Not ${d.planter.name}? Change` : 'Which planter am I?'} variant="ghost" onPress={() => router.push('/planter/who')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
});
