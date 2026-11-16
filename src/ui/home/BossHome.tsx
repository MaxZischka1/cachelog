import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cutblockOf } from '../../core/cutblock';
import { today } from '../../core/plan';
import { crewStats } from '../../core/stats';
import type { Block, LogEntry, PlanVersion } from '../../core/types';
import { fmtDay, fmtInt } from '../format';
import { useImportFlow } from '../hooks/useImportFlow';
import { EmergencyBar, Hero, ListGroup, ListRow, Stat, StatRow } from '../kit';
import { Screen } from '../Screen';
import { EmptyState, Muted, Section } from '../Section';
import { useSettings, useStoreQuery } from '../store';
import { colors, font } from '../theme';

/** Crew boss home: the crew's day at a glance, then the blocks. */
export function BossHome() {
  const { settings, update } = useSettings();
  const flow = useImportFlow();
  const { data, loading } = useStoreQuery(async (s) => {
    const blocks = await s.listBlocks();
    const rows = await Promise.all(blocks.map(async (b) => ({ block: b, latest: await s.getLatestVersion(b.id), log: await s.listLog(b.id) })));
    return rows as { block: Block; latest: PlanVersion | null; log: LogEntry[] }[];
  }, []);

  const day = today();
  const crew = useMemo(() => {
    if (!data) return null;
    return crewStats(data.flatMap((r) => r.log), new Map(data.map((r) => [r.block.id, r.block])), day);
  }, [data, day]);

  const open = async (id: string) => {
    await update({ activeBlockId: id });
    router.push(`/boss/${id}`);
  };
  const blocks = data ?? [];
  const emergencyBlock = settings?.activeBlockId ?? (blocks.length === 1 ? blocks[0].block.id : undefined);
  const active = blocks.find((r) => r.block.id === settings?.activeBlockId);

  return (
    <Screen tab>
      <EmergencyBar onPress={() => router.push(emergencyBlock ? `/emergency?blockId=${emergencyBlock}` : '/emergency')} />

      <Hero eyebrow={`Today · ${fmtDay(day)}`} title={settings ? `Hi ${settings.userName.split(' ')[0]}` : undefined}>
        <StatRow>
          <Stat label="trees today" value={fmtInt(crew?.crew.today?.trees ?? 0)} />
          <Stat label="planters today" value={String(crew?.planters.filter((p) => p.stats.today).length ?? 0)} />
          <Stat label="season" value={fmtInt(crew?.crew.totalTrees ?? 0)} />
        </StatRow>
        {active ? <Muted>{`Working on ${active.block.name}${active.latest ? ` · plan v${active.latest.version}` : ' · no plan published yet'}`}</Muted> : null}
      </Hero>

      <Section title="Blocks">
        {!loading && blocks.length === 0 ? (
          <EmptyState title="No blocks yet" message="Import the block map from the licensee (PDF, GeoTIFF, KML) or create a block by hand." />
        ) : null}
        {blocks.length ? (
          <ListGroup>
            {blocks.map(({ block: b, latest }) => {
              const cut = cutblockOf(b);
              const meta = [
                b.id === settings?.activeBlockId ? 'Active' : null,
                latest ? `v${latest.version}` : 'No plan yet',
                cut?.areaHa !== undefined ? `${cut.areaHa} ha` : null,
                b.sheet?.prescriptions[0]?.species ?? null,
              ].filter(Boolean);
              return <ListRow key={b.id} icon={b.id === settings?.activeBlockId ? 'leaf' : 'leaf-outline'} title={b.name} subtitle={meta.join(' · ')} onPress={() => open(b.id)} />;
            })}
          </ListGroup>
        ) : null}
      </Section>

      <ListGroup>
        <ListRow icon="document-attach-outline" title="Import a file" subtitle="Block map (PDF, GeoTIFF, KML), crew updates, a plan or a suggestion" onPress={flow.pick} disabled={flow.busy} />
        <ListRow icon="add-circle-outline" title="New block" subtitle="Name, prices and emergency info" onPress={() => router.push('/boss/block-form')} />
      </ListGroup>
      {flow.busy ? <Text style={styles.busy}>Importing…</Text> : null}
      <View />
    </Screen>
  );
}

const styles = StyleSheet.create({
  busy: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
});
