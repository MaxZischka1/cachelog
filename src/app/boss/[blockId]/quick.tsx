import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { diffPlans, quickPublish } from '../../../core/plan';
import type { PlanContent } from '../../../core/types';
import { showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { TextField } from '../../../ui/NumberField';
import { Segmented } from '../../../ui/Pickers';
import { PlantersPanel } from '../../../ui/plan/PlantersPanel';
import { PlanMapEditor } from '../../../ui/plan/PlanMapEditor';
import { Screen } from '../../../ui/Screen';
import { Sheet } from '../../../ui/Sheet';
import { useBlock, useBump, useDraft, useLatestVersion, useSettings, useStore } from '../../../ui/store';
import { colors, font, spacing } from '../../../ui/theme';

type Tab = 'map' | 'crew';

/**
 * Mid-day change: edit the published plan directly (no draft), then quick-publish.
 * The working copy lives only in this screen until published.
 */
export default function QuickChange() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const store = useStore();
  const bump = useBump();
  const { settings } = useSettings();
  const { data: block } = useBlock(blockId);
  const { data: latest } = useLatestVersion(blockId);
  const { data: draft } = useDraft(blockId);
  const [working, setWorking] = useState<PlanContent | null>(null);
  const [tab, setTab] = useState<Tab>('map');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Start from the latest published plan once (don't reset while editing).
  useEffect(() => {
    if (latest && !working) setWorking(latest.content);
  }, [latest, working]);

  const changes = useMemo(() => (latest && working ? diffPlans(latest.content, working) : []), [latest, working]);
  const edit = async (fn: (c: PlanContent) => PlanContent) => setWorking((w) => (w ? fn(w) : w));

  const doPublish = async () => {
    if (!latest || !working) return;
    setBusy(true);
    try {
      const current = await store.getLatestVersion(blockId);
      if (!current || current.version !== latest.version) {
        throw new Error(`v${current?.version} was published while you were editing. Close this screen and make the change again.`);
      }
      const v = quickPublish(latest, () => working, settings?.userName ?? 'Crew boss', message.trim() || changes.map((c) => c.text).join('; '));
      await store.addVersion(v);
      bump();
      setConfirmOpen(false);
      const home = `/boss/${blockId}`;
      Alert.alert(
        `Published v${v.version}`,
        draft ? 'Note: your open draft was started from an older version. Discard it before publishing a full plan.' : 'Send it to the crew now?',
        [
          { text: 'Later', style: 'cancel', onPress: () => router.dismissTo(home) },
          {
            text: 'Share plan',
            onPress: () => {
              router.dismissTo(home);
              router.push(`${home}/share`);
            },
          },
        ],
      );
    } catch (e) {
      showError('Could not publish', e);
    } finally {
      setBusy(false);
    }
  };

  if (!block || !latest || !working) {
    return <ActivityIndicator style={styles.flex} size="large" color={colors.primary} />;
  }

  const footer = (
    <Button
      title={changes.length ? `Publish change (${changes.length})` : 'Make one change'}
      disabled={changes.length === 0}
      onPress={() => setConfirmOpen(true)}
    />
  );

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: `Quick change · v${latest.version}` }} />
      <View style={styles.tabs}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'map', label: 'Map' },
            { value: 'crew', label: 'Crew' },
          ]}
        />
      </View>
      {tab === 'map' ? (
        <PlanMapEditor block={block} content={working} onEdit={edit} footer={footer} banner={draft ? 'You also have an open draft; it will need to be discarded after this.' : undefined} />
      ) : (
        <Screen footer={footer}>
          <PlantersPanel content={working} onEdit={edit} />
        </Screen>
      )}

      <Sheet
        visible={confirmOpen}
        title={`Publish v${latest.version + 1}?`}
        onClose={() => setConfirmOpen(false)}
        actions={<Button title="Publish now" size="big" busy={busy} onPress={doPublish} />}
      >
        {changes.map((c, i) => (
          <Text key={i} style={styles.change}>
            • {c.text}
          </Text>
        ))}
        <TextField label="Message (optional)" value={message} onChangeText={setMessage} placeholder="Defaults to the change list" />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  tabs: { padding: spacing.sm },
  change: { fontSize: font.large, fontWeight: '700', color: colors.text },
});
