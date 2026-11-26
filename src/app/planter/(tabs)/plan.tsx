import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { polygonAreaHa, today } from '../../../core/plan';
import { formatCount, pieceStatuses } from '../../../core/tally';
import type { PieceStatus } from '../../../core/types';
import { showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { fmtDateTime, fmtDay, fmtHa } from '../../../ui/format';
import { useImportFlow } from '../../../ui/hooks/useImportFlow';
import { useLogWriter } from '../../../ui/hooks/useLogWriter';
import { usePlanterData } from '../../../ui/hooks/usePlanter';
import { Segmented } from '../../../ui/Pickers';
import { blockDestination, openDirections } from '../../../ui/directions';
import { usePins } from '../../../ui/pins';
import { TopBar } from '../../../ui/planter/TopBar';
import { EmptyState } from '../../../ui/Section';
import { colors, font, radii, spacing, tabular } from '../../../ui/theme';

const STATUS: { label: string; value: PieceStatus }[] = [
  { label: 'Not started', value: 'not-started' },
  { label: 'Planting', value: 'in-progress' },
  { label: 'Done', value: 'complete' },
];

/** The crew boss's plan for today: my piece and its spec, the boss's notes, my cache, hazards. */
export default function Plan() {
  const d = usePlanterData();
  const pins = usePins(d.blockId);
  const flow = useImportFlow();
  const { add } = useLogWriter(d.blockId, today());

  if (d.loading) return <View style={styles.screen} />;
  if (!d.block || !d.latest || !d.plan) {
    return (
      <View style={styles.screen}>
        <TopBar title="Plan" />
        <EmptyState title="No plan yet" message="Import the plan file from your crew boss.">
          <Button title="Import plan file" size="big" busy={flow.busy} onPress={flow.pick} style={styles.wide} />
        </EmptyState>
      </View>
    );
  }

  const plan = d.plan;
  const piece = d.piece;
  const rx = piece?.prescription;
  const status: PieceStatus = piece ? pieceStatuses(plan, pins.log)[piece.id] ?? 'not-started' : 'not-started';
  const oldDay = plan.day !== today();
  const notes = [plan.notes?.trim(), piece?.notes?.trim()].filter((n): n is string => !!n);
  const dest = blockDestination(pins.open.map((s) => s.pin), piece);

  const setStatus = async (next: PieceStatus) => {
    if (!piece || next === status) return;
    try {
      await add('piece-status', { pieceId: piece.id, status: next });
    } catch (e) {
      showError('Could not save the status', e);
    }
  };

  return (
    <View style={styles.screen}>
      <TopBar title="Plan" subtitle={`${fmtDay(plan.day)} · ${d.block.name} · v${d.latest.version}`} blockId={d.blockId} />
      <ScrollView contentContainerStyle={styles.content}>
        {oldDay ? (
          <View style={styles.warn}>
            <Ionicons name="alert-circle" size={22} color={colors.warning} />
            <Text style={styles.warnText}>This plan is for {fmtDay(plan.day)}, not today. Get today's plan from your crew boss.</Text>
          </View>
        ) : null}

        <View>
          <Text style={styles.pieceName}>{piece ? piece.name : 'No piece assigned'}</Text>
          <Text style={styles.muted}>{piece ? `${fmtHa(polygonAreaHa(piece.polygon))} · ${d.planter?.name ?? ''}` : 'Check with your crew boss.'}</Text>
        </View>

        {rx && (rx.densityPerHa || rx.spacingM || rx.species?.length) ? (
          <View style={styles.spec}>
            <Spec label="Density" value={rx.densityPerHa ? `${formatCount(rx.densityPerHa)}` : '—'} unit={rx.densityPerHa ? '/ha' : ''} />
            <View style={styles.specRule} />
            <Spec label="Spacing" value={rx.spacingM ? String(rx.spacingM) : '—'} unit={rx.spacingM ? 'm' : ''} />
            <View style={styles.specRule} />
            <Spec label="Species" value={rx.species?.length ? rx.species.join(', ') : '—'} />
          </View>
        ) : null}

        {notes.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>From {d.latest.author}</Text>
            {notes.map((n, i) => (
              <Text key={i} style={styles.note}>
                {n}
              </Text>
            ))}
          </View>
        ) : null}

        <Pressable accessibilityRole="button" onPress={() => router.navigate('/planter/map')} style={({ pressed }) => [styles.card, styles.cacheRow, pressed && styles.pressed]}>
          <View style={styles.cacheIcon}>
            <Ionicons name="cube" size={22} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Your cache</Text>
            <Text style={styles.cacheName}>{d.cache ? d.cache.name : 'None assigned'}</Text>
            {d.cache?.trees.length ? <Text style={styles.muted}>{d.cache.trees.map((t) => `${formatCount(t.count)} ${t.species}`).join(' · ')}</Text> : null}
          </View>
          <Ionicons name="map-outline" size={22} color={colors.textMuted} />
        </Pressable>

        {dest ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Directions to ${dest.label}`}
            onPress={() => openDirections(dest).catch((e) => showError('Could not open Maps', e))}
            style={({ pressed }) => [styles.card, styles.cacheRow, pressed && styles.pressed]}
          >
            <View style={[styles.cacheIcon, styles.dirIcon]}>
              <Ionicons name="navigate" size={22} color={colors.text} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>Directions to the block</Text>
              <Text style={styles.muted} numberOfLines={1}>
                {dest.label} · opens Maps
              </Text>
            </View>
            <Ionicons name="open-outline" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}

        {plan.hazards.length ? (
          <View style={[styles.card, styles.hazards]}>
            <Text style={[styles.cardTitle, { color: colors.danger }]}>Hazards</Text>
            {plan.hazards.map((h) => (
              <View key={h.id} style={styles.hazard}>
                <Ionicons name="warning" size={20} color={colors.danger} />
                <Text style={styles.hazardText}>{h.note}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {piece ? (
          <View style={styles.gap}>
            <Text style={styles.sectionTitle}>Your piece</Text>
            <Segmented options={STATUS} value={status} onChange={setStatus} />
          </View>
        ) : null}

        <Pressable accessibilityRole="button" onPress={() => router.push(`/pins?blockId=${d.blockId}`)} style={({ pressed }) => [styles.card, styles.cacheRow, pressed && styles.pressed]}>
          <Ionicons name="flag" size={22} color={colors.warning} />
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>Crew pins</Text>
            <Text style={styles.muted}>{pins.open.length ? `${pins.open.length} open on the block` : 'Flag wasps, low caches, no-plant areas'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.meta}>
            Plan v{d.latest.version} · published {fmtDateTime(d.latest.publishedAt)} by {d.latest.author}
          </Text>
          <Button title="Import new plan" variant="secondary" busy={flow.busy} onPress={flow.pick} />
          <Button title={d.planter ? `Not ${d.planter.name}? Change` : 'Which planter am I?'} variant="ghost" size="small" onPress={() => router.push('/planter/who')} />
        </View>
      </ScrollView>
    </View>
  );
}

function Spec({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.specItem}>
      <Text style={styles.specLabel}>{label}</Text>
      <Text style={styles.specValue} numberOfLines={2}>
        {value}
        {unit ? <Text style={styles.specUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 80, gap: spacing.lg },
  flex: { flex: 1 },
  gap: { gap: spacing.sm },
  wide: { alignSelf: 'stretch' },
  pressed: { opacity: 0.8 },
  muted: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },

  warn: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningBg, borderRadius: radii.control, padding: spacing.md },
  warnText: { flex: 1, fontSize: font.body, color: colors.text, fontWeight: '600' },

  pieceName: { fontSize: font.huge, fontWeight: '800', color: colors.text, letterSpacing: -1 },

  spec: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radii.card, paddingVertical: spacing.lg },
  specItem: { flex: 1, paddingHorizontal: spacing.md, gap: 4 },
  specRule: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  specLabel: { fontSize: font.small - 1, color: colors.textMuted },
  specValue: { fontSize: font.large + 2, fontWeight: '700', color: colors.text, ...tabular },
  specUnit: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },

  card: { backgroundColor: colors.surface, borderRadius: radii.card, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  note: { fontSize: font.large, lineHeight: 28, color: colors.text, fontWeight: '500' },

  cacheRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cacheIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryMuted, alignItems: 'center', justifyContent: 'center' },
  dirIcon: { backgroundColor: '#0A84FF' },
  cacheName: { fontSize: font.title - 4, fontWeight: '800', color: colors.text },
  rowTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },

  hazards: { backgroundColor: colors.dangerBg },
  hazard: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  hazardText: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },

  sectionTitle: { fontSize: font.large, fontWeight: '700', color: colors.text },
  footer: { gap: spacing.sm, marginTop: spacing.md },
  meta: { fontSize: font.small - 1, color: colors.textFaint, textAlign: 'center' },
});
