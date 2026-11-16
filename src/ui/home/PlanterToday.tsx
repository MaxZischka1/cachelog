import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { crewMessages } from '../../core/messages';
import { polygonAreaHa, today } from '../../core/plan';
import { planterStats } from '../../core/stats';
import { pieceStatuses } from '../../core/tally';
import type { PieceStatus } from '../../core/types';
import { pieceRxFromSheet } from '../../import/pdfSheet';
import { choose, showError } from '../alerts';
import { Button } from '../Button';
import { fmtCountsInline, fmtDay, fmtDistance, fmtDollars, fmtDuration, fmtHa, fmtInt } from '../format';
import { useImportFlow } from '../hooks/useImportFlow';
import { useLogWriter } from '../hooks/useLogWriter';
import { usePlanterData } from '../hooks/usePlanter';
import { useSendUpdates } from '../hooks/useSendUpdates';
import { useShift } from '../hooks/useShift';
import { EmergencyBar, Hero, ListGroup, ListRow, Progress, Stat, StatRow } from '../kit';
import { usePins } from '../pins';
import { MorningBrief } from '../planter/MorningBrief';
import { Screen } from '../Screen';
import { EmptyState, Muted, Section } from '../Section';
import { useLog } from '../store';
import { colors, font, spacing } from '../theme';

const STATUS_LABEL: Record<PieceStatus, string> = { 'not-started': 'Not started', 'in-progress': 'In progress', complete: 'Complete' };

/** Planter home: today's trees and piece up top, one main action, the rest as quiet rows. */
export function PlanterToday() {
  const d = usePlanterData();
  const flow = useImportFlow();
  const pins = usePins(d.blockId);
  const updates = useSendUpdates(d.blockId);
  const { add } = useLogWriter(d.blockId, today());
  const { data: log } = useLog(d.blockId);
  const shift = useShift({ blockId: d.blockId, planterId: d.planter?.id, piece: d.piece });

  const day = today();
  const stats = useMemo(
    () => (d.planter && d.block ? planterStats(log ?? [], d.planter.id, new Map([[d.block.id, d.block]]), day) : null),
    [log, d.planter, d.block, day],
  );
  const lastMessage = useMemo(() => {
    const m = crewMessages(log ?? []);
    return m[m.length - 1];
  }, [log]);
  const status: PieceStatus = d.plan && d.piece ? pieceStatuses(d.plan, pins.log)[d.piece.id] ?? 'not-started' : 'not-started';

  // A plan is loaded but this phone doesn't know which planter it is yet. Ask once: the data
  // reloads several times while a plan imports, and each reload must not push another copy.
  const askedWho = useRef(false);
  useEffect(() => {
    if (d.planter) askedWho.current = false;
    else if (!askedWho.current && !d.loading && d.plan && d.plan.planters.length > 0) {
      askedWho.current = true;
      router.push('/planter/who');
    }
  }, [d.loading, d.plan, d.planter]);

  const emergency = <EmergencyBar onPress={() => router.push(d.blockId ? `/emergency?blockId=${d.blockId}` : '/emergency')} />;

  if (d.loading) return <Screen tab>{null}</Screen>;

  if (!d.block || !d.latest) {
    return (
      <Screen tab>
        {emergency}
        <EmptyState title="No plan on this phone yet" message="Ask your crew boss to AirDrop today’s plan, then import it here." />
        <Button title="Import plan file" size="big" busy={flow.busy} onPress={flow.pick} />
      </Screen>
    );
  }

  const setStatus = async () => {
    if (!d.piece) return;
    const next = await choose<PieceStatus>(d.piece.name, 'Where is your piece at?', [
      { label: 'Not started', value: 'not-started' },
      { label: 'In progress', value: 'in-progress' },
      { label: 'Complete', value: 'complete' },
    ]);
    if (!next || next === status) return;
    try {
      await add('piece-status', { pieceId: d.piece.id, status: next });
    } catch (e) {
      showError('Could not save the status', e);
    }
  };

  const startShift = async () => {
    const mode = await choose('Track my shift', 'Records your path while the phone is in your pocket. It stays on this phone unless you send it.', [
      { label: 'Precise (more battery)', value: 'precise' as const },
      { label: 'Battery saver', value: 'saver' as const },
    ]);
    if (mode) await shift.start(mode);
  };

  const trees = stats?.today?.trees ?? 0;
  const pieceHa = d.piece && d.piece.polygon.length >= 3 ? polygonAreaHa(d.piece.polygon) : 0;
  const rx = d.piece?.prescription ?? (d.piece ? pieceRxFromSheet(d.block.sheet) : undefined);
  // Trees the piece needs: area x density, when both are known.
  const pieceTarget = pieceHa && rx?.densityPerHa ? Math.round(pieceHa * rx.densityPerHa) : 0;
  const covered = shift.summary.inPieceHa;

  return (
    <Screen tab>
      {emergency}

      <Hero eyebrow={`Today · ${fmtDay(day)}`}>
        <View style={styles.heroTop}>
          <View style={styles.flex}>
            <Text style={styles.big} accessibilityLabel={`${trees} trees today`}>
              {fmtInt(trees)}
            </Text>
            <Text style={styles.bigLabel}>trees today{stats?.today?.source === 'tally' ? ' (tallied)' : ''}</Text>
          </View>
          {stats?.today?.cents ? (
            <View style={styles.right}>
              <Text style={styles.money}>{fmtDollars(stats.today.cents)}</Text>
              <Text style={styles.bigLabel}>est.</Text>
            </View>
          ) : null}
        </View>
        {d.piece ? (
          <View style={styles.piece}>
            <Text style={styles.pieceName}>
              {d.piece.name}
              {d.cache ? <Text style={styles.pieceMeta}>{`  ·  ${d.cache.name}`}</Text> : null}
            </Text>
            {pieceTarget ? (
              <>
                <Progress value={trees / pieceTarget} />
                <Muted>{`${fmtInt(trees)} of about ${fmtInt(pieceTarget)} for the piece (${fmtHa(pieceHa)} at ${fmtInt(rx!.densityPerHa!)}/ha)`}</Muted>
              </>
            ) : (
              <Muted>{fmtHa(pieceHa)}</Muted>
            )}
          </View>
        ) : (
          <Muted>You’re not assigned to a piece in this plan.</Muted>
        )}
        <Button title="Log bag-up" size="big" onPress={() => router.push('/planter/bagup')} />
      </Hero>

      <Section title="Shift">
        {shift.tracking ? (
          <>
            <StatRow>
              <Stat label="on shift" value={fmtDuration(shift.summary.durationMs)} />
              <Stat label="walked" value={fmtDistance(shift.summary.distanceM)} />
              <Stat label={covered !== null ? 'of piece covered' : 'covered'} value={covered !== null && pieceHa ? `${Math.round((covered / pieceHa) * 100)}%` : fmtHa(shift.summary.coveredHa)} />
            </StatRow>
            {!shift.recording ? <Muted>Tracking paused by the phone. Tap Resume to carry on.</Muted> : null}
            <View style={styles.row}>
              {!shift.recording ? <Button style={styles.flex} title="Resume" variant="secondary" busy={shift.busy} onPress={() => shift.start(shift.open?.mode ?? 'precise')} /> : null}
              <Button style={styles.flex} title="Stop tracking" variant="secondary" busy={shift.busy} onPress={shift.stop} />
            </View>
          </>
        ) : (
          <ListGroup>
            <ListRow
              icon="navigate-circle-outline"
              title="Track my shift"
              subtitle={shift.summary.distanceM > 0 ? `Today so far: ${fmtDistance(shift.summary.distanceM)}, ${fmtHa(shift.summary.coveredHa)} covered` : 'See the ground you cover. Stays on this phone.'}
              onPress={startShift}
            />
          </ListGroup>
        )}
      </Section>

      <Section title="My day">
        <ListGroup>
          {d.piece ? <ListRow icon="flag-outline" title="My piece" value={STATUS_LABEL[status]} onPress={setStatus} /> : null}
          {d.cache ? <ListRow icon="cube-outline" title={d.cache.name} subtitle={fmtCountsInline(d.cache.trees)} onPress={() => router.push('/map')} /> : null}
          <ListRow icon="pin-outline" title="Crew pins" subtitle={pins.open.length ? `${pins.open.length} open` : 'Flag a hazard or ask for trees'} badge={pins.open.length} onPress={() => router.push(`/pins?blockId=${d.blockId}`)} />
          <ListRow icon="chatbubble-ellipses-outline" title="Messages" subtitle={lastMessage ? `${lastMessage.author}: ${lastMessage.text}` : 'Nothing yet'} onPress={() => router.push('/messages')} />
          <ListRow icon="paper-plane-outline" title="Send my updates" subtitle="Bag-ups, pins, messages and status, to the crew boss" onPress={updates.send} disabled={updates.sending} />
        </ListGroup>
      </Section>

      <Section title="Brief">
        <MorningBrief block={d.block} version={d.latest} piece={d.piece} cache={d.cache} />
      </Section>

      <ListGroup>
        <ListRow icon="download-outline" title="Import new plan" onPress={flow.pick} disabled={flow.busy} />
        <ListRow icon="person-outline" title={d.planter ? `Not ${d.planter.name}?` : 'Which planter am I?'} onPress={() => router.push('/planter/who')} />
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.md },
  heroTop: { flexDirection: 'row', alignItems: 'flex-end' },
  right: { alignItems: 'flex-end' },
  big: { fontSize: font.huge + 12, fontWeight: '800', color: colors.text, letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  bigLabel: { fontSize: font.body, color: colors.textMuted },
  money: { fontSize: font.title, fontWeight: '800', color: colors.primary, fontVariant: ['tabular-nums'] },
  piece: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  pieceName: { fontSize: font.large, fontWeight: '700', color: colors.text },
  pieceMeta: { fontSize: font.body, fontWeight: '500', color: colors.textMuted },
});
