import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { BlockMap } from '../../../map';
import { confirm, showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { usePlanDraft } from '../../../ui/hooks/usePlanDraft';
import { TextField } from '../../../ui/NumberField';
import { Screen } from '../../../ui/Screen';
import { EmptyState, Section } from '../../../ui/Section';
import { colors, font, radius, spacing } from '../../../ui/theme';

/** Review the draft as a plain-language diff + ghosted map, then publish a numbered version. */
export default function ReviewScreen() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const plan = usePlanDraft(blockId);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string[] | null>(null);

  const allIds = useMemo(() => [...new Set(plan.changes.flatMap((c) => c.ids))], [plan.changes]);
  const home = `/boss/${blockId}`;

  const doPublish = async () => {
    setBusy(true);
    try {
      const v = await plan.publishDraft(message);
      Alert.alert(`Published v${v.version}`, 'Send it to the crew now?', [
        { text: 'Later', style: 'cancel', onPress: () => router.dismissTo(home) },
        {
          text: 'Share plan',
          onPress: () => {
            router.dismissTo(home);
            router.push(`${home}/share`);
          },
        },
      ]);
    } catch (e) {
      showError('Could not publish', e);
    } finally {
      setBusy(false);
    }
  };

  const doDiscard = async () => {
    if (!(await confirm('Discard draft?', 'All unpublished changes will be lost. The published plan stays as it is.', 'Discard', true))) return;
    try {
      await plan.discard();
      router.dismissTo(home);
    } catch (e) {
      showError('Could not discard the draft', e);
    }
  };

  if (plan.loading) return <Screen>{null}</Screen>;
  if (!plan.block || !plan.draft) {
    return (
      <Screen>
        <EmptyState title="No draft" message="Open Plan to make changes first." />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <>
          <Button title={plan.latest ? `Publish v${plan.latest.version + 1}` : 'Publish v1'} size="big" disabled={!plan.dirty} busy={busy} onPress={doPublish} />
          <Button title="Discard draft" variant="ghost" onPress={doDiscard} />
        </>
      }
    >
      <Stack.Screen options={{ title: 'Review changes' }} />
      <View style={styles.mapWrap}>
        <BlockMap
          block={plan.block}
          plan={plan.draft.content}
          ghostPlan={plan.latest?.content ?? null}
          highlightIds={focus ?? allIds}
          showUserLocation={false}
          style={styles.map}
        />
      </View>
      <Section title={plan.latest ? `Changes since v${plan.latest.version}` : 'First version'} right={focus ? <Button title="Show all" size="small" variant="ghost" onPress={() => setFocus(null)} /> : undefined}>
        {plan.changes.length === 0 ? <EmptyState title="No changes" message="The draft matches the published plan." /> : null}
        {plan.changes.map((c, i) => (
          <Card key={i} onPress={c.ids.length ? () => setFocus(c.ids) : undefined} tone={focus && c.ids.every((id) => focus.includes(id)) ? 'ok' : 'normal'}>
            <Text style={styles.change}>{c.text}</Text>
          </Card>
        ))}
      </Section>
      <TextField label="Message for the crew (optional)" value={message} onChangeText={setMessage} placeholder="e.g. Jess moved to piece 6, wasps at cache 2" multiline />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapWrap: { height: 300, borderRadius: radius, overflow: 'hidden', borderWidth: 2, borderColor: colors.border },
  map: { flex: 1 },
  change: { fontSize: font.large, fontWeight: '700', color: colors.text },
});
