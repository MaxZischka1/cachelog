import { router, Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../ui/Button';
import { useImportFlow } from '../../ui/hooks/useImportFlow';
import { Card } from '../../ui/Card';
import { Screen } from '../../ui/Screen';
import { EmptyState, Muted, Section } from '../../ui/Section';
import { useBlocks, useSettings } from '../../ui/store';
import { colors, font, spacing } from '../../ui/theme';

/** Crew boss home: blocks list. */
export default function BossHome() {
  const { data: blocks, loading } = useBlocks();
  const { settings, update } = useSettings();
  const flow = useImportFlow();

  const open = async (id: string) => {
    await update({ activeBlockId: id });
    router.push(`/boss/${id}`);
  };

  const emergencyBlock = settings?.activeBlockId ?? (blocks?.length === 1 ? blocks[0].id : undefined);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Blocks',
          headerRight: () => <Button title="Settings" variant="ghost" size="small" onPress={() => router.push('/settings')} />,
        }}
      />
      <Button
        title="EMERGENCY"
        variant="danger"
        size="big"
        onPress={() => router.push(emergencyBlock ? `/emergency?blockId=${emergencyBlock}` : '/emergency')}
      />
      <Section title={settings ? `Hi ${settings.userName}` : 'Blocks'}>
        {!loading && blocks && blocks.length === 0 ? (
          <EmptyState title="No blocks yet" message="Create the block you're planting: name, prices and emergency info." />
        ) : null}
        {(blocks ?? []).map((b) => (
          <Card key={b.id} title={b.name} onPress={() => open(b.id)} tone={b.id === settings?.activeBlockId ? 'ok' : 'normal'}>
            <View style={styles.meta}>
              {b.contract ? <Muted>Contract {b.contract}</Muted> : null}
              {b.licensee ? <Muted>{b.licensee}</Muted> : null}
            </View>
            <Text style={styles.prices}>
              {Object.entries(b.pricesCents)
                .map(([s, c]) => `${s} ${c}¢`)
                .join('  ·  ') || 'No prices set'}
            </Text>
          </Card>
        ))}
      </Section>
      <Button title="+ New block" size="big" variant="secondary" onPress={() => router.push('/boss/block-form')} />
      <Button
        title="Import a file"
        subtitle="A block map (PDF, GeoTIFF, KML), a plan, crew updates or a suggestion"
        variant="secondary"
        busy={flow.busy}
        onPress={flow.pick}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  prices: { fontSize: font.body, color: colors.text },
});
