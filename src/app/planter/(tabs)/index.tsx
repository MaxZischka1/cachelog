import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { today } from '../../../core/plan';
import { formatCents, formatCount } from '../../../core/tally';
import type { BagUpEntry, ID, LogEntry } from '../../../core/types';
import { choose, showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { fmtDay, fmtTime, speciesFromBlock } from '../../../ui/format';
import { useImportFlow } from '../../../ui/hooks/useImportFlow';
import { useLogWriter } from '../../../ui/hooks/useLogWriter';
import { useMyDay } from '../../../ui/hooks/useMyDay';
import { usePlanterData } from '../../../ui/hooks/usePlanter';
import { useSendUpdates } from '../../../ui/hooks/useSendUpdates';
import { NumberField } from '../../../ui/NumberField';
import { TopBar } from '../../../ui/planter/TopBar';
import { EmptyState } from '../../../ui/Section';
import { Sheet, TextPromptSheet } from '../../../ui/Sheet';
import { colors, font, radii, spacing, tabular, touch } from '../../../ui/theme';

/** Bundle-of-trees amounts offered as one-tap buttons. */
const AMOUNTS = [100, 200, 300, 400];
const UNDO_MS = 6000;

/**
 * Today: the planter's numbers and the bag-up log. Picking a species then tapping an amount logs
 * straight away (two taps); "same as last" is one. Mistakes are undone, never confirmed up front.
 */
export default function Today() {
  const d = usePlanterData();
  const day = today();
  const my = useMyDay(d.planter?.id);
  const { add, voidIt } = useLogWriter(d.blockId, day);
  const updates = useSendUpdates(d.blockId);
  const flow = useImportFlow();

  const speciesOptions = useMemo(() => {
    const fromCache = d.cache?.trees.map((t) => t.species) ?? [];
    const fromPiece = d.piece?.prescription?.species ?? [];
    const all = [...fromCache, ...fromPiece, ...speciesFromBlock(d.block, d.plan)];
    return [...new Set(all)];
  }, [d.cache, d.piece, d.block, d.plan]);

  const [species, setSpecies] = useState<string | undefined>();
  const [cacheId, setCacheId] = useState<ID | undefined>();
  const [undo, setUndo] = useState<BagUpEntry | null>(null);
  const [custom, setCustom] = useState(false);
  const [customCount, setCustomCount] = useState<number | undefined>();
  const [voidTarget, setVoidTarget] = useState<LogEntry | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const last = my.data?.last ?? null;
  useEffect(() => {
    if (!species && speciesOptions.length) setSpecies(last?.trees[0]?.species ?? speciesOptions[0]);
  }, [species, speciesOptions, last]);
  useEffect(() => {
    if (!cacheId && d.plan) setCacheId(d.cache?.id ?? d.plan.caches[0]?.id);
  }, [cacheId, d.plan, d.cache]);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  if (d.loading) return <View style={styles.screen} />;

  if (!d.block || !d.plan) {
    return (
      <View style={styles.screen}>
        <TopBar title="Today" />
        <EmptyState title="No plan on this phone yet" message="Ask your crew boss to AirDrop today's plan, then import it here.">
          <Button title="Import plan file" size="big" busy={flow.busy} onPress={flow.pick} style={styles.wide} />
        </EmptyState>
      </View>
    );
  }

  if (!d.planter) {
    return (
      <View style={styles.screen}>
        <TopBar title="Today" subtitle={d.block.name} blockId={d.blockId} />
        <EmptyState title="Which planter are you?" message="Pick your name once and this phone shows your piece, cache and numbers.">
          <Button title="Pick my name" size="big" onPress={() => router.push('/planter/who')} style={styles.wide} />
        </EmptyState>
      </View>
    );
  }

  const planterId = d.planter.id;
  const cache = d.plan.caches.find((c) => c.id === cacheId) ?? null;

  const log = async (count: number, sp: string | undefined = species) => {
    if (!sp) return showError('Pick a species', 'Tap the species you bagged up.');
    if (!cacheId) return showError('No cache in this plan', 'Ask the crew boss to add a cache.');
    try {
      const e = await add('bagup', { planterId, cacheId, trees: [{ species: sp, count }] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setUndo(e);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
    } catch (err) {
      showError('Could not log the bag-up', err);
    }
  };

  const undoLast = async () => {
    const e = undo;
    setUndo(null);
    if (!e) return;
    try {
      await voidIt(e, 'Undone right after logging');
    } catch (err) {
      showError('Could not undo', err);
    }
  };

  const pickCache = async () => {
    const id = await choose(
      'Bagging up from',
      undefined,
      d.plan!.caches.map((c) => ({ label: c.id === d.cache?.id ? `${c.name} (yours)` : c.name, value: c.id })),
    );
    if (id) setCacheId(id);
  };

  const day$ = my.data ? formatCents(my.data.cents) : '$0.00';
  const trees = my.data?.trees ?? 0;
  const vs = my.data?.yesterday != null ? trees - my.data.yesterday : null;
  const lastTrees = last?.trees[0];
  const subtitle = [fmtDay(day), d.piece?.name, d.block.name].filter(Boolean).join(' · ');

  return (
    <View style={styles.screen}>
      <TopBar title="Today" subtitle={subtitle} blockId={d.blockId} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroNumber} accessibilityLabel={`${trees} trees today`}>
            {formatCount(trees)}
          </Text>
          <Text style={styles.heroLabel}>trees today</Text>
        </View>

        <View style={styles.stats}>
          <Stat value={day$} label="earned" />
          <Stat value={String(my.data?.bagups.length ?? 0)} label="bag-ups" />
          <Stat
            value={vs == null ? '—' : `${vs >= 0 ? '+' : '−'}${formatCount(Math.abs(vs))}`}
            label="vs yesterday"
            tone={vs == null ? undefined : vs >= 0 ? 'up' : 'down'}
          />
        </View>

        {lastTrees ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Log ${lastTrees.count} ${lastTrees.species} again`}
            onPress={() => log(lastTrees.count, lastTrees.species)}
            style={({ pressed }) => [styles.repeat, pressed && styles.pressed]}
          >
            <View style={styles.flex}>
              <Text style={styles.repeatLabel}>Same as last</Text>
              <Text style={styles.repeatValue}>
                +{formatCount(lastTrees.count)} {lastTrees.species}
              </Text>
            </View>
            <View style={styles.repeatGo}>
              <Ionicons name="add" size={34} color={colors.primary} />
            </View>
          </Pressable>
        ) : null}

        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>{lastTrees ? 'Different bag-up' : 'Log a bag-up'}</Text>
            <Pressable accessibilityRole="button" onPress={pickCache} hitSlop={10} style={styles.cacheLink}>
              <Ionicons name="cube-outline" size={16} color={colors.textMuted} />
              <Text style={styles.cacheText}>{cache ? `from ${cache.name}` : 'pick cache'}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.chips}>
            {speciesOptions.map((s) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: s === species }}
                onPress={() => setSpecies(s)}
                style={[styles.chip, s === species && styles.chipOn]}
              >
                <Text style={[styles.chipText, s === species && styles.chipTextOn]}>{s}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.amounts}>
            {AMOUNTS.map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={`Log ${n} ${species ?? ''}`}
                onPress={() => log(n)}
                style={({ pressed }) => [styles.amount, pressed && styles.amountPressed]}
              >
                <Text style={styles.amountText}>+{n}</Text>
              </Pressable>
            ))}
          </View>
          <Button title="Other amount" variant="ghost" size="small" onPress={() => { setCustomCount(undefined); setCustom(true); }} />
        </View>

        <View style={styles.logHead}>
          <Text style={styles.sectionTitle}>Bag-ups</Text>
          <Pressable onPress={() => router.push('/planter/totals')} hitSlop={10} style={styles.cacheLink}>
            <Text style={styles.link}>Season</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
        </View>
        <View style={styles.log}>
          {my.data && my.data.bagups.length === 0 && my.data.voided.length === 0 ? (
            <Text style={styles.muted}>Nothing yet today. Your first bag-up shows here.</Text>
          ) : null}
          {[...(my.data?.bagups ?? []).map((e) => ({ e, voided: false })), ...(my.data?.voided ?? []).map((v) => ({ e: v.entry, voided: true }))]
            .sort((a, b) => b.e.createdAt.localeCompare(a.e.createdAt))
            .map(({ e, voided }) => (
              <Pressable
                key={e.id}
                accessibilityRole="button"
                accessibilityHint={voided ? undefined : 'Void this bag-up'}
                disabled={voided}
                onPress={() => setVoidTarget(e)}
                style={styles.row}
              >
                <Text style={styles.rowTime}>{fmtTime(e.createdAt)}</Text>
                <Text style={[styles.rowText, voided && styles.rowVoid]} numberOfLines={1}>
                  +{e.trees.map((t) => `${formatCount(t.count)} ${t.species}`).join(', ')}
                </Text>
                {voided ? <Text style={styles.voidTag}>VOID</Text> : <Text style={styles.rowCache}>{d.plan!.caches.find((c) => c.id === e.cacheId)?.name ?? ''}</Text>}
              </Pressable>
            ))}
        </View>

        <Button title="Send my day to the crew boss" variant="secondary" busy={updates.sending} onPress={updates.send} />
      </ScrollView>

      {undo ? (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={22} color={colors.ok} />
          <Text style={styles.toastText} numberOfLines={1}>
            Logged +{formatCount(undo.trees[0]?.count ?? 0)} {undo.trees[0]?.species}
          </Text>
          <Pressable accessibilityRole="button" onPress={undoLast} hitSlop={10} style={styles.toastBtn}>
            <Text style={styles.toastUndo}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      <Sheet
        visible={custom}
        title={`Other amount${species ? ` · ${species}` : ''}`}
        onClose={() => setCustom(false)}
        actions={
          <Button
            title={customCount ? `Log +${formatCount(customCount)}` : 'Log'}
            size="big"
            disabled={!customCount}
            onPress={() => {
              setCustom(false);
              if (customCount) log(customCount);
            }}
          />
        }
      >
        <NumberField value={customCount} onChange={setCustomCount} placeholder="Trees" suffix="trees" big autoFocus />
      </Sheet>

      <TextPromptSheet
        visible={!!voidTarget}
        title="Void this bag-up?"
        message="It stays in your log, struck out, but no longer counts. Say why:"
        placeholder="e.g. logged twice"
        confirmLabel="Void bag-up"
        destructive
        onCancel={() => setVoidTarget(null)}
        onSubmit={(reason) => {
          const t = voidTarget;
          setVoidTarget(null);
          if (t) voidIt(t, reason).catch((err) => showError('Could not void the bag-up', err));
        }}
      />
    </View>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'up' | 'down' }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone === 'up' && { color: colors.ok }, tone === 'down' && { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  flex: { flex: 1 },
  wide: { alignSelf: 'stretch' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },

  hero: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.sm },
  heroNumber: { fontSize: font.hero, fontWeight: '800', color: colors.text, letterSpacing: -2, ...tabular },
  heroLabel: { fontSize: font.large, fontWeight: '600', color: colors.textMuted },

  stats: { flexDirection: 'row', marginTop: -spacing.sm },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: font.title - 4, fontWeight: '700', color: colors.text, ...tabular },
  statLabel: { fontSize: font.small - 1, color: colors.textMuted },

  repeat: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 92,
    borderRadius: radii.card,
    backgroundColor: colors.primary,
    paddingLeft: spacing.xl,
    paddingRight: spacing.md,
  },
  repeatLabel: { fontSize: font.small, fontWeight: '700', color: colors.primaryText, opacity: 0.75 },
  repeatValue: { fontSize: font.title, fontWeight: '800', color: colors.primaryText, letterSpacing: -0.5, ...tabular },
  repeatGo: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryText, alignItems: 'center', justifyContent: 'center' },

  panel: { backgroundColor: colors.surface, borderRadius: radii.card, padding: spacing.lg, gap: spacing.md },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  cacheLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  cacheText: { fontSize: font.small, color: colors.textMuted, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.text },
  chipText: { fontSize: font.body, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.bg },
  amounts: { flexDirection: 'row', gap: spacing.sm },
  amount: { flex: 1, height: touch.big, borderRadius: radii.control, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  amountPressed: { backgroundColor: colors.primaryMuted },
  amountText: { fontSize: font.large + 2, fontWeight: '800', color: colors.text, ...tabular },

  logHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  sectionTitle: { fontSize: font.large, fontWeight: '700', color: colors.text },
  link: { fontSize: font.body, fontWeight: '600', color: colors.primary },
  log: { backgroundColor: colors.surface, borderRadius: radii.card, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, marginTop: -spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTime: { width: 72, fontSize: font.small, color: colors.textMuted, ...tabular },
  rowText: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text, ...tabular },
  rowVoid: { textDecorationLine: 'line-through', color: colors.textFaint },
  rowCache: { fontSize: font.small, color: colors.textMuted },
  voidTag: { fontSize: 12, fontWeight: '800', color: colors.danger, letterSpacing: 1 },
  muted: { fontSize: font.small, color: colors.textMuted, paddingVertical: spacing.md },

  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    minHeight: 56,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  toastText: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  toastBtn: { height: 56, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  toastUndo: { fontSize: font.body, fontWeight: '800', color: colors.primary },
});
