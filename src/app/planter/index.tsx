import { router, Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { today } from '../../core/plan';
import { pieceStatuses } from '../../core/tally';
import type { PieceStatus } from '../../core/types';
import { choose } from '../../ui/alerts';
import { useImportFlow } from '../../ui/hooks/useImportFlow';
import { useLogWriter } from '../../ui/hooks/useLogWriter';
import { useSendUpdates } from '../../ui/hooks/useSendUpdates';
import { usePins } from '../../ui/pins';
import { showError } from '../../ui/alerts';
import { Button } from '../../ui/Button';
import { usePlanterData } from '../../ui/hooks/usePlanter';
import { MorningBrief } from '../../ui/planter/MorningBrief';
import { Screen } from '../../ui/Screen';
import { EmptyState } from '../../ui/Section';
import { spacing } from '../../ui/theme';

/** Planter home: emergency, morning brief, and the day's actions. */
export default function PlanterHome() {
  const d = usePlanterData();
  const flow = useImportFlow();
  const pins = usePins(d.blockId);
  const updates = useSendUpdates(d.blockId);
  const { add } = useLogWriter(d.blockId, today());
  const busy = flow.busy;
  const doImport = flow.pick;

  const status: PieceStatus = d.plan && d.piece ? pieceStatuses(d.plan, pins.log)[d.piece.id] ?? 'not-started' : 'not-started';
  const STATUS_LABEL: Record<PieceStatus, string> = { 'not-started': 'Not started', 'in-progress': 'In progress', complete: 'Complete' };
  const setStatus = async () => {
    if (!d.piece) return;
    const next = await choose<PieceStatus>(d.piece.name, 'Where is your piece at?', [
      { label: 'Not started', value: 'not-started' },
      { label: 'In progress', value: 'in-progress' },
      { label: 'Complete', value: 'complete' },
    ]);
    if (!next || next === status) return;
    try {
      await add('piece-status', { pieceId: d.piece.id, status: next });
    } catch (e) {
      showError('Could not save the status', e);
    }
  };

  // A plan is loaded but this phone doesn't know which planter it is yet.
  useEffect(() => {
    if (!d.loading && d.plan && !d.planter && d.plan.planters.length > 0) router.push('/planter/who');
  }, [d.loading, d.plan, d.planter]);

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
        <View style={styles.row}>
          <Button
            style={styles.flex}
            title="Crew pins"
            subtitle={pins.open.length ? `${pins.open.length} open` : 'Flag something'}
            size="big"
            variant="secondary"
            onPress={() => router.push(`/pins?blockId=${d.blockId}`)}
          />
          {d.piece ? <Button style={styles.flex} title="My piece" subtitle={STATUS_LABEL[status]} size="big" variant="secondary" onPress={setStatus} /> : null}
        </View>
      </View>
      <MorningBrief block={d.block} version={d.latest} piece={d.piece} cache={d.cache} />
      <Button title="Send my updates to crew boss" subtitle="Bag-ups, pins and piece status" variant="secondary" busy={updates.sending} onPress={updates.send} />
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
