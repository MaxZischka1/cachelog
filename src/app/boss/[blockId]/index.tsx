import { router, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { today } from '../../../core/plan';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { fmtDateTime, fmtDay } from '../../../ui/format';
import { usePlanDraft } from '../../../ui/hooks/usePlanDraft';
import { Screen } from '../../../ui/Screen';
import { EmptyState, Muted } from '../../../ui/Section';
import { colors, font, spacing } from '../../../ui/theme';

/** Crew boss block home: today's plan status and the main actions. */
export default function BlockHome() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const { block, latest, draft, changes, dirty, loading } = usePlanDraft(blockId);
  const base = `/boss/${blockId}`;

  if (loading) return <Screen>{null}</Screen>;
  if (!block) return <Screen><EmptyState title="Block not found" /></Screen>;

  const staleDay = latest && !draft && latest.content.day !== today();

  return (
    <Screen>
      <Stack.Screen options={{ title: block.name, headerRight: () => <Button title="Edit" variant="ghost" size="small" onPress={() => router.push(`/boss/block-form?blockId=${blockId}`)} /> }} />
      <Button title="EMERGENCY" variant="danger" size="big" onPress={() => router.push(`/emergency?blockId=${blockId}`)} />

      <Card title="Today's plan" tone={dirty ? 'warning' : latest ? 'ok' : 'normal'}>
        {latest ? (
          <Text style={styles.big}>Published v{latest.version}</Text>
        ) : (
          <Text style={styles.big}>Nothing published yet</Text>
        )}
        {latest ? (
          <Muted>
            {fmtDay(latest.content.day)} · {fmtDateTime(latest.publishedAt)} by {latest.author}
            {latest.message ? ` — “${latest.message}”` : ''}
          </Muted>
        ) : null}
        {draft ? (
          <Text style={styles.status}>
            {dirty ? `Draft: ${changes.length} unpublished change${changes.length === 1 ? '' : 's'}` : 'Draft open, no changes yet'}
          </Text>
        ) : null}
        {staleDay ? <Text style={styles.status}>The published plan is for {fmtDay(latest.content.day)}. Tap Plan to start today’s.</Text> : null}
      </Card>

      <View style={styles.grid}>
        <Button size="big" title="Plan" subtitle={draft ? 'Continue draft' : latest ? 'Start from latest' : 'Start the first plan'} onPress={() => router.push(`${base}/plan`)} />
        <Button
          size="big"
          title="Review & publish"
          subtitle={dirty ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'No changes to publish'}
          disabled={!dirty}
          onPress={() => router.push(`${base}/review`)}
        />
        {latest ? (
          <Button size="big" variant="secondary" title="Quick change" subtitle="Edit one thing and publish" onPress={() => router.push(`${base}/quick`)} />
        ) : null}
        <Button size="big" variant="secondary" title="Share plan" subtitle={latest ? `Send v${latest.version} to the crew` : 'Publish first'} disabled={!latest} onPress={() => router.push(`${base}/share`)} />
        <Button size="big" variant="secondary" title="Tallies" subtitle="End of day, caches, earnings" disabled={!latest} onPress={() => router.push(`${base}/tallies`)} />
        <Button size="big" variant="secondary" title="Map layers" subtitle={`${block.layers.length} layer${block.layers.length === 1 ? '' : 's'}`} onPress={() => router.push(`${base}/layers`)} />
        <Button size="big" variant="ghost" title="History" subtitle="Versions, revert" disabled={!latest} onPress={() => router.push(`${base}/history`)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: font.title, fontWeight: '800', color: colors.text },
  status: { fontSize: font.body, fontWeight: '700', color: colors.warning },
  grid: { gap: spacing.md },
});
