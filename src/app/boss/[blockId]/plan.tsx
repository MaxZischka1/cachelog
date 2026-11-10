import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { usePins } from '../../../ui/pins';
import { usePlanDraft } from '../../../ui/hooks/usePlanDraft';
import { Segmented } from '../../../ui/Pickers';
import { LoadListPanel, PlantersPanel } from '../../../ui/plan/PlantersPanel';
import { PlanMapEditor } from '../../../ui/plan/PlanMapEditor';
import { Screen } from '../../../ui/Screen';
import { TextField } from '../../../ui/NumberField';
import { setPlanNotes } from '../../../ui/planEdits';
import { colors, spacing } from '../../../ui/theme';

type Tab = 'map' | 'crew' | 'load';

/** Plan editor: map (caches, pieces, hazards), crew assignments, load list. Edits go to the draft. */
export default function PlanEditor() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const plan = usePlanDraft(blockId);
  const pins = usePins(blockId);
  const [tab, setTab] = useState<Tab>('map');

  // Open (or create) the draft as soon as the editor opens.
  useEffect(() => {
    if (!plan.loading && !plan.draft) plan.ensureDraft().catch((e) => showError('Could not start the draft', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.loading, plan.draft]);

  const content = plan.draft?.content;
  const reviewButton = (
    <Button
      title={plan.dirty ? `Review & publish (${plan.changes.length})` : 'No changes yet'}
      disabled={!plan.dirty}
      onPress={() => router.push(`/boss/${blockId}/review`)}
    />
  );

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: plan.block ? `Plan · ${plan.block.name}` : 'Plan' }} />
      <View style={styles.tabs}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'map', label: 'Map' },
            { value: 'crew', label: `Crew${content ? ` (${content.planters.length})` : ''}` },
            { value: 'load', label: 'Load list' },
          ]}
        />
      </View>
      {!plan.block || !content ? (
        <ActivityIndicator style={styles.flex} size="large" color={colors.primary} />
      ) : tab === 'map' ? (
        <PlanMapEditor block={plan.block} content={content} onEdit={plan.edit} footer={reviewButton} pins={pins.mapPins} />
      ) : tab === 'crew' ? (
        <Screen footer={reviewButton}>
          <PlantersPanel content={content} onEdit={plan.edit} />
        </Screen>
      ) : (
        <Screen footer={reviewButton}>
          <LoadListPanel content={content} />
          <NotesField value={content.notes ?? ''} onSave={(t) => plan.edit(setPlanNotes(t)).catch((e) => showError('Could not save notes', e))} />
        </Screen>
      )}
    </View>
  );
}

/** Day notes, saved on blur so typing doesn't create a draft write per keystroke. */
function NotesField({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <TextField
      label="Notes for the crew"
      value={text}
      onChangeText={setText}
      onBlur={() => {
        if (text !== value) onSave(text);
      }}
      placeholder="e.g. Truck leaves 6:15. Heli lift at 10."
      multiline
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  tabs: { padding: spacing.sm, backgroundColor: colors.bg },
});
