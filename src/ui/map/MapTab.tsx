import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { describeBlockPosition, whereInBlock } from '../../core/cutblock';
import { bearingDeg, centroid, compass, distanceM, pointInPolygon, today } from '../../core/plan';
import { activeEntries } from '../../core/tally';
import type { ID, TrackEntry } from '../../core/types';
import { BlockMap, useUserLocation } from '../../map';
import { Button } from '../Button';
import { fmtDistance, fmtHa, fmtInt } from '../format';
import { usePlanterData } from '../hooks/usePlanter';
import { useShift } from '../hooks/useShift';
import { usePins } from '../pins';
import { Screen } from '../Screen';
import { EmptyState } from '../Section';
import { useBlock, useLatestVersion, useLog, useSettings } from '../store';
import { colors, font, radius, spacing } from '../theme';

/** The block map: for a planter, their piece, cache, track and where they are; for a boss, the active block and today's crew tracks. */
export function MapTab() {
  const { settings } = useSettings();
  if (!settings) return <Screen tab>{null}</Screen>;
  return settings.role === 'crew-boss' ? <BossMap blockId={settings.activeBlockId} /> : <PlanterMap />;
}

function PlanterMap() {
  const d = usePlanterData();
  // BlockMap runs its own watch for the blue dot; this second one gives us numbers for the card.
  const loc = useUserLocation();
  const pins = usePins(d.blockId);
  const shift = useShift({ blockId: d.blockId, planterId: d.planter?.id, piece: d.piece });

  const highlightIds = useMemo(() => [d.piece?.id, d.cache?.id].filter((x): x is ID => !!x), [d.piece, d.cache]);
  const cacheLabels = useMemo(() => {
    const out: Record<ID, string> = {};
    for (const c of d.plan?.caches ?? []) out[c.id] = `${c.name}: ${fmtInt(c.trees.reduce((s, t) => s + t.count, 0))}`;
    return out;
  }, [d.plan]);
  const tracks = useMemo(() => (shift.summary.lines.length ? [{ lines: shift.summary.lines, mine: true }] : []), [shift.summary.lines]);

  if (!d.block || !d.plan) {
    return (
      <Screen tab>
        <EmptyState title="No plan on this phone" message="Import a plan from the Today tab." />
      </Screen>
    );
  }

  const lines: string[] = [];
  // From the cutblock outline read off the block's map, when there is one.
  const edge = loc.position ? describeBlockPosition(whereInBlock(loc.position, d.block), loc.accuracyM, fmtDistance) : null;
  if (edge) lines.push(edge);
  if (loc.position) {
    if (d.piece && d.piece.polygon.length >= 3) {
      lines.push(pointInPolygon(loc.position, d.piece.polygon) ? `You're in ${d.piece.name}` : `${d.piece.name}: ${dir(loc.position, centroid(d.piece.polygon))}`);
    }
    if (d.cache) lines.push(`${d.cache.name}: ${dir(loc.position, d.cache.position)}`);
  } else {
    lines.push(loc.permission === 'denied' ? 'Location is off. Allow it in Settings to see where you are.' : 'Waiting for GPS…');
  }
  if (shift.tracking) lines.push(`Tracking · ${fmtDistance(shift.summary.distanceM)} · ${fmtHa(shift.summary.coveredHa)} covered`);

  return (
    <View style={styles.flex}>
      <BlockMap block={d.block} plan={d.plan} highlightIds={highlightIds} cacheLabels={cacheLabels} pins={pins.mapPins} tracks={tracks} showUserLocation style={styles.flex} />
      <View style={styles.card} pointerEvents="none">
        {lines.map((l, i) => (
          <Text key={i} style={[styles.line, i > 0 && styles.lineSmall]}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

function BossMap({ blockId }: { blockId: ID | undefined }) {
  const { data: block } = useBlock(blockId);
  const { data: latest } = useLatestVersion(blockId);
  const { data: log } = useLog(blockId, today());
  const pins = usePins(blockId);
  const tracks = useMemo(
    () => activeEntries(log ?? []).filter((e): e is TrackEntry => e.type === 'track').map((t) => ({ lines: t.lines })),
    [log],
  );

  if (!blockId || !block) {
    return (
      <Screen tab>
        <EmptyState title="No block open" message="Open a block from the Blocks tab to see its map here." />
      </Screen>
    );
  }
  return (
    <View style={styles.flex}>
      <BlockMap block={block} plan={latest?.content ?? null} pins={pins.mapPins} tracks={tracks} showUserLocation style={styles.flex} />
      <View style={styles.bossBar}>
        <View style={styles.flex}>
          <Text style={styles.line}>{block.name}</Text>
          <Text style={styles.lineSmall}>{latest ? `Plan v${latest.version}` : 'No plan yet'}{tracks.length ? ` · ${tracks.length} crew track${tracks.length === 1 ? '' : 's'} today` : ''}</Text>
        </View>
        <Button title="Open" size="small" onPress={() => router.push(`/boss/${blockId}`)} />
      </View>
    </View>
  );
}

function dir(from: [number, number], to: [number, number]): string {
  return `${fmtDistance(distanceM(from, to))} ${compass(bearingDeg(from, to))}`;
}

const card = {
  position: 'absolute' as const,
  left: spacing.md,
  bottom: spacing.lg,
  backgroundColor: colors.surface,
  borderRadius: radius,
  borderWidth: 1,
  borderColor: colors.hairline,
  padding: spacing.md,
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { ...card, right: 80, gap: spacing.xs },
  bossBar: { ...card, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  line: { fontSize: font.large, fontWeight: '800', color: colors.text },
  lineSmall: { fontSize: font.body, fontWeight: '600', color: colors.textMuted },
});
