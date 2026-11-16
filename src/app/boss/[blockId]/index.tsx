import { router, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { today } from '../../../core/plan';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { fmtDateTime, fmtDay } from '../../../ui/format';
import { useImportFlow } from '../../../ui/hooks/useImportFlow';
import { usePlanDraft } from '../../../ui/hooks/usePlanDraft';
import { pinText, usePins } from '../../../ui/pins';
import { Screen } from '../../../ui/Screen';
import { SheetCard } from '../../../ui/SheetCard';
import { EmptyState, Muted, Section } from '../../../ui/Section';
import { colors, font, spacing } from '../../../ui/theme';

/**
 * Crew boss block home, laid out in the order of the day:
 * plan it, send it, hear back from the crew, close out the day.
 */
export default function BlockHome() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const { block, latest, draft, changes, dirty, loading } = usePlanDraft(blockId);
  const pins = usePins(blockId);
  const flow = useImportFlow({ blockId });
  const base = `/boss/${blockId}`;

  if (loading) return <Screen>{null}</Screen>;
  if (!block) return <Screen><EmptyState title="Block not found" /></Screen>;

  const staleDay = latest && !draft && latest.content.day !== today();
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

  return (
    <Screen>
      <Stack.Screen options={{ title: block.name, headerRight: () => <Button title="Edit" variant="ghost" size="small" onPress={() => router.push(`/boss/block-form?blockId=${blockId}`)} /> }} />
      <Button title="EMERGENCY" variant="danger" size="big" onPress={() => router.push(`/emergency?blockId=${blockId}`)} />

      <Card title="Today's plan" tone={dirty ? 'warning' : latest ? 'ok' : 'normal'}>
        <Text style={styles.big}>{latest ? `Published v${latest.version}` : 'Nothing published yet'}</Text>
        {latest ? (
          <Muted>
            {fmtDay(latest.content.day)} · {fmtDateTime(latest.publishedAt)} by {latest.author}
            {latest.message ? ` — “${latest.message}”` : ''}
          </Muted>
        ) : null}
        {draft ? <Text style={styles.status}>{dirty ? `Draft: ${n(changes.length, 'unpublished change')}` : 'Draft open, no changes yet'}</Text> : null}
        {staleDay ? <Text style={styles.status}>The published plan is for {fmtDay(latest.content.day)}. Tap Plan to start today’s.</Text> : null}
      </Card>

      {block.sheet ? <SheetCard sheet={block.sheet} /> : null}

      <Section title="1 · Plan">
        <View style={styles.grid}>
          <Button size="big" title="Plan" subtitle={draft ? 'Continue draft' : latest ? 'Start from latest' : 'Start the first plan'} onPress={() => router.push(`${base}/plan`)} />
          <Button size="big" title="Review & publish" subtitle={dirty ? n(changes.length, 'change') : 'No changes to publish'} disabled={!dirty} onPress={() => router.push(`${base}/review`)} />
          {latest ? <Button variant="secondary" title="Quick change" subtitle="Edit one thing and publish right away" onPress={() => router.push(`${base}/quick`)} /> : null}
        </View>
      </Section>

      <Section title="2 · Crew">
        <View style={styles.grid}>
          <Button size="big" variant="secondary" title="Share plan" subtitle={latest ? `Send v${latest.version} and the crew's pins` : 'Publish first'} disabled={!latest} onPress={() => router.push(`${base}/share`)} />
          <Button
            size="big"
            variant="secondary"
            title={pins.open.length ? `Crew pins (${pins.open.length} open)` : 'Crew pins'}
            subtitle={pins.open.length ? pinText(pins.open[0].pin) : 'Nothing flagged'}
            onPress={() => router.push(`/pins?blockId=${blockId}`)}
          />
          <Button variant="secondary" title="Import a file" subtitle="A map for this block, crew updates, a suggestion or a newer plan" busy={flow.busy} onPress={flow.pick} />
        </View>
      </Section>

      <Section title="3 · End of day">
        <View style={styles.grid}>
          <Button size="big" variant="secondary" title="Tallies" subtitle="Tallies, caches, earnings, CSV" disabled={!latest} onPress={() => router.push(`${base}/tallies`)} />
        </View>
      </Section>

      <Section title="Block setup">
        <View style={styles.grid}>
          <Button variant="ghost" title="Map layers" subtitle={n(block.layers.length, 'layer')} onPress={() => router.push(`${base}/layers`)} />
          <Button variant="ghost" title="History" subtitle="Past versions, revert" disabled={!latest} onPress={() => router.push(`${base}/history`)} />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: font.title, fontWeight: '800', color: colors.text },
  status: { fontSize: font.body, fontWeight: '700', color: colors.warning },
  grid: { gap: spacing.md },
});
