import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { today } from '../../../core/plan';
import { formatCents, payrollCsv, piecesCsv, talliesCsv } from '../../../core/tally';
import { useImportFlow } from '../../../ui/hooks/useImportFlow';
import type { PieceStatus } from '../../../core/types';
import { choose, showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { DaySwitcher } from '../../../ui/DaySwitcher';
import { shareTextFile } from '../../../ui/files';
import { fmtCountsInline, fmtHa, fmtInt, safeFileName } from '../../../ui/format';
import { useDayData, useLogWriter } from '../../../ui/hooks/useLogWriter';
import { Screen } from '../../../ui/Screen';
import { EmptyState, Flag, InfoRow, Muted, Section } from '../../../ui/Section';
import { colors, font, spacing } from '../../../ui/theme';

const STATUS_LABEL: Record<PieceStatus, string> = { 'not-started': 'Not started', 'in-progress': 'In progress', complete: 'Complete' };

/** End of day: per-planter tallies, cache reconciliation, piece status, earnings, CSV export. */
export default function TalliesScreen() {
  const { blockId, day: dayParam } = useLocalSearchParams<{ blockId: string; day?: string }>();
  const [day, setDay] = useState(dayParam || today());
  const { block, plan, summary, log, loading } = useDayData(blockId, day);
  const { add } = useLogWriter(blockId, day);
  const flow = useImportFlow();

  if (loading) return <Screen>{null}</Screen>;
  if (!block || !plan || !summary) {
    return (
      <Screen>
        <EmptyState title="Publish a plan first" message="Tallies are entered against the planters and pieces in the published plan." />
      </Screen>
    );
  }

  const setStatus = async (pieceId: string, name: string) => {
    const status = await choose<PieceStatus>(name, 'Set piece status', [
      { label: 'Not started', value: 'not-started' },
      { label: 'In progress', value: 'in-progress' },
      { label: 'Complete', value: 'complete' },
    ]);
    if (!status) return;
    try {
      await add('piece-status', { pieceId, status });
    } catch (e) {
      showError('Could not save the status', e);
    }
  };

  const exportCsv = async () => {
    const which = await choose('Export CSV', 'Which file?', [
      { label: 'Tallies (planter, piece, species)', value: 'tallies' },
      { label: 'Payroll (planter, trees, $)', value: 'payroll' },
      { label: 'Piece completion', value: 'pieces' },
    ]);
    if (!which) return;
    try {
      const content = which === 'tallies' ? talliesCsv(plan, log) : which === 'payroll' ? payrollCsv(summary) : piecesCsv(summary);
      await shareTextFile(`${safeFileName(block.name)}-${day}-${which}.csv`, content, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch (e) {
      showError('Could not export', e);
    }
  };

  const base = `/boss/${blockId}`;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Tallies' }} />
      <DaySwitcher day={day} onChange={setDay} />

      <Card tone="ok">
        <InfoRow label="Trees tallied" value={fmtInt(summary.total)} big />
        <InfoRow label="Earnings" value={formatCents(summary.earningsCents)} big />
        {summary.bySpecies.length ? <Muted>{fmtCountsInline(summary.bySpecies)}</Muted> : null}
      </Card>

      <Section title="Planters">
        {summary.planters.length === 0 ? <EmptyState title="No planters in the plan" /> : null}
        {summary.planters.map((p) => (
          <Card key={p.planterId} onPress={() => router.push(`${base}/tally/${p.planterId}?day=${day}`)}>
            <View style={styles.rowBetween}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.big}>{fmtInt(p.totalTallied)}</Text>
            </View>
            <View style={styles.rowBetween}>
              <Muted>{p.tallied.length ? fmtCountsInline(p.tallied) : 'No tally yet — tap to enter'}</Muted>
              <Text style={styles.money}>{formatCents(p.earningsCents)}</Text>
            </View>
            {p.flags.map((f, i) => <Flag key={i} text={f} />)}
          </Card>
        ))}
      </Section>

      <Section title="Caches" right={<Button title="Log drop" size="small" variant="secondary" onPress={() => router.push(`${base}/drops?day=${day}`)} />}>
        {summary.caches.map((c) => (
          <Card key={c.cacheId} title={c.name} tone={c.flags.length ? 'warning' : 'normal'}>
            <InfoRow label="Planned" value={fmtCountsInline(c.planned)} />
            <InfoRow label="Dropped" value={fmtCountsInline(c.dropped)} />
            <InfoRow label="Bagged" value={fmtCountsInline(c.bagged)} />
            <InfoRow label="Remaining" value={fmtCountsInline(c.remaining)} />
            {c.flags.map((f, i) => <Flag key={i} text={f} />)}
          </Card>
        ))}
      </Section>

      <Section title="Pieces">
        {summary.pieces.map((p) => (
          <Card key={p.pieceId} onPress={() => setStatus(p.pieceId, p.name)} tone={p.status === 'complete' ? 'ok' : 'normal'}>
            <View style={styles.rowBetween}>
              <Text style={styles.name}>{p.name}</Text>
              <Flag text={STATUS_LABEL[p.status]} tone={p.status === 'complete' ? 'ok' : 'info'} />
            </View>
            <Muted>
              {fmtInt(p.tallied)} trees · {fmtHa(p.areaHa)}
              {p.areaHa > 0 && p.tallied > 0 ? ` · ${fmtInt(p.tallied / p.areaHa)}/ha` : ''} · tap to set status
            </Muted>
          </Card>
        ))}
      </Section>

      <Button title="Import crew updates" subtitle="Bag-ups, pins and piece status from a planter" size="big" variant="secondary" busy={flow.busy} onPress={flow.pick} />
      <Button title="Export CSV" size="big" variant="secondary" onPress={exportCsv} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  name: { fontSize: font.large, fontWeight: '800', color: colors.text, flexShrink: 1 },
  big: { fontSize: font.title, fontWeight: '800', color: colors.text },
  money: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
