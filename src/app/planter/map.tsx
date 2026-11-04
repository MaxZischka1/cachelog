import { Stack } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { bearingDeg, centroid, compass, distanceM, pointInPolygon } from '../../core/plan';
import type { ID } from '../../core/types';
import { BlockMap, useUserLocation } from '../../map';
import { fmtDistance, fmtInt } from '../../ui/format';
import { usePlanterData } from '../../ui/hooks/usePlanter';
import { Screen } from '../../ui/Screen';
import { EmptyState } from '../../ui/Section';
import { colors, font, radius, spacing } from '../../ui/theme';

/** Offline map with my piece and cache highlighted, caches labelled with counts, and where I am. */
export default function PlanterMap() {
  const d = usePlanterData();
  // BlockMap runs its own watch for the blue dot; this second one gives us numbers for the distance card.
  const loc = useUserLocation();

  const highlightIds = useMemo(() => [d.piece?.id, d.cache?.id].filter((x): x is ID => !!x), [d.piece, d.cache]);
  const cacheLabels = useMemo(() => {
    const out: Record<ID, string> = {};
    for (const c of d.plan?.caches ?? []) out[c.id] = `${c.name}: ${fmtInt(c.trees.reduce((s, t) => s + t.count, 0))}`;
    return out;
  }, [d.plan]);

  if (!d.block || !d.plan) {
    return (
      <Screen>
        <EmptyState title="No plan on this phone" message="Import a plan from the home screen." />
      </Screen>
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
      <Stack.Screen options={{ title: d.piece ? `Map · ${d.piece.name}` : 'Map' }} />
      <BlockMap block={d.block} plan={d.plan} highlightIds={highlightIds} cacheLabels={cacheLabels} showUserLocation style={styles.flex} />
      <View style={styles.card} pointerEvents="none">
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
    left: spacing.sm,
    right: 80,
    bottom: spacing.xl,
    backgroundColor: colors.bg,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  line: { fontSize: font.large, fontWeight: '800', color: colors.text },
});
