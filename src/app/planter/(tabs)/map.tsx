import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bearingDeg, centroid, compass, distanceM, pointInPolygon } from '../../../core/plan';
import type { ID } from '../../../core/types';
import { BlockMap, useUserLocation } from '../../../map';
import { fmtDistance, fmtInt } from '../../../ui/format';
import { usePlanterData } from '../../../ui/hooks/usePlanter';
import { usePins } from '../../../ui/pins';
import { EmptyState } from '../../../ui/Section';
import { TopBar } from '../../../ui/planter/TopBar';
import { colors, font, radii, spacing } from '../../../ui/theme';

/** Offline map with my piece and cache highlighted, caches labelled with counts, and where I am. */
export default function PlanterMap() {
  const d = usePlanterData();
  // BlockMap runs its own watch for the blue dot; this second one gives us numbers for the distance card.
  const loc = useUserLocation();
  const pins = usePins(d.blockId);
  const insets = useSafeAreaInsets();

  const highlightIds = useMemo(() => [d.piece?.id, d.cache?.id].filter((x): x is ID => !!x), [d.piece, d.cache]);
  const cacheLabels = useMemo(() => {
    const out: Record<ID, string> = {};
    for (const c of d.plan?.caches ?? []) out[c.id] = `${c.name}: ${fmtInt(c.trees.reduce((s, t) => s + t.count, 0))}`;
    return out;
  }, [d.plan]);

  if (!d.block || !d.plan) {
    return (
      <View style={[styles.flex, styles.bg]}>
        <TopBar title="Map" />
        <EmptyState title="No plan on this phone" message="Import a plan from the Bag-up tab." />
      </View>
    );
  }

  const lines: string[] = [];
  if (loc.position) {
    if (d.piece && d.piece.polygon.length >= 3) {
      lines.push(pointInPolygon(loc.position, d.piece.polygon) ? `You're in ${d.piece.name}` : `${d.piece.name}: ${dir(loc.position, centroid(d.piece.polygon))}`);
    }
    if (d.cache) lines.push(`${d.cache.name}: ${dir(loc.position, d.cache.position)}`);
  } else {
    lines.push(loc.permission === 'denied' ? 'Location is off — allow it in Settings to see where you are.' : 'Waiting for GPS…');
  }

  return (
    <View style={styles.flex}>
      <BlockMap block={d.block} plan={d.plan} highlightIds={highlightIds} cacheLabels={cacheLabels} pins={pins.mapPins} showUserLocation style={styles.flex} />
      <View style={[styles.card, { top: insets.top + spacing.sm }]} pointerEvents="none">
        <Text style={styles.cardTitle}>{d.piece ? d.piece.name : d.block.name}</Text>
        {lines.map((l, i) => (
          <Text key={i} style={styles.line}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

function dir(from: [number, number], to: [number, number]): string {
  return `${fmtDistance(distanceM(from, to))} ${compass(bearingDeg(from, to))}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    position: 'absolute',
    left: spacing.lg,
    right: 72,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  bg: { backgroundColor: colors.bg },
  cardTitle: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  line: { fontSize: font.large, fontWeight: '700', color: colors.text },
});
