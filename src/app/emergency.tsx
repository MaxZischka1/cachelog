import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { bearingDeg, compass, distanceM } from '../core/plan';
import type { LngLat } from '../core/types';
import { useUserLocation } from '../map';
import { fmtDistance, fmtLngLat } from '../ui/format';
import { Screen } from '../ui/Screen';
import { EmptyState } from '../ui/Section';
import { useBlock, useSettings } from '../ui/store';
import { colors, font, radius, spacing } from '../ui/theme';

/** Emergency card. Works offline: everything comes from the local block. */
export default function EmergencyScreen() {
  const params = useLocalSearchParams<{ blockId?: string }>();
  const { settings } = useSettings();
  const blockId = params.blockId || settings?.activeBlockId;
  const { data: block } = useBlock(blockId);
  const loc = useUserLocation();

  if (!block) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Emergency' }} />
        <EmptyState title="No block selected" message="Open a block (or import a plan) to see its emergency info. Call for help on the radio." />
      </Screen>
    );
  }
  const e = block.emergency;
  const where = (p?: LngLat) => {
    if (!p) return 'Not set';
    if (!loc.position) return fmtLngLat(p);
    const d = distanceM(loc.position, p);
    return `${fmtDistance(d)} ${compass(bearingDeg(loc.position, p))}  ·  ${fmtLngLat(p)}`;
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: `Emergency · ${block.name}` }} />
      <Item label="Radio channel" value={e.radioChannel || 'Not set'} huge />
      <Item label="Muster point" value={where(e.musterPoint)} />
      <Item label="Helipad" value={where(e.helipad)} />
      <Item label="Evacuation route" value={e.evacRoute || 'Not set'} />
      <Item label="Nearest hospital" value={e.nearestHospital || 'Not set'} />
      {e.notes ? <Item label="Notes" value={e.notes} /> : null}
      <View style={styles.me}>
        <Text style={styles.meLabel}>My position (read this out on the radio)</Text>
        <Text style={styles.meValue}>
          {loc.position ? `${fmtLngLat(loc.position)}${loc.accuracyM != null ? `  ±${Math.round(loc.accuracyM)} m` : ''}` : loc.permission === 'denied' ? 'Location permission denied' : 'Waiting for GPS…'}
        </Text>
      </View>
    </Screen>
  );
}

function Item({ label, value, huge }: { label: string; value: string; huge?: boolean }) {
  return (
    <View style={styles.item}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, huge && styles.huge]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 1.5, borderColor: colors.danger, borderRadius: radius, padding: spacing.lg, gap: spacing.xs },
  label: { fontSize: font.body, fontWeight: '700', color: colors.danger, textTransform: 'uppercase' },
  value: { fontSize: font.large, fontWeight: '800', color: colors.text },
  huge: { fontSize: font.huge },
  me: { backgroundColor: colors.surface, borderRadius: radius, padding: spacing.lg, gap: spacing.xs },
  meLabel: { fontSize: font.body, fontWeight: '700', color: colors.text },
  meValue: { fontSize: font.large, fontWeight: '800', color: colors.text },
});
