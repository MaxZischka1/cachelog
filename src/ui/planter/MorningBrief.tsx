import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { polygonAreaHa, today } from '../../core/plan';
import type { Block, Cache, Piece, PlanVersion } from '../../core/types';
import { pieceRxFromSheet } from '../../import/pdfSheet';
import { Card } from '../Card';
import { fmtCountsInline, fmtDateTime, fmtDay, fmtHa } from '../format';
import { Body, InfoRow, Muted } from '../Section';
import { colors, font, spacing } from '../theme';

/** Planter's morning brief: my piece, my cache, prescription, hazards, plan version. */
export function MorningBrief({ block, version, piece, cache }: { block: Block; version: PlanVersion; piece: Piece | null; cache: Cache | null }) {
  const plan = version.content;
  // The piece's own prescription, else the one printed on the block's map sheet.
  const rx = piece?.prescription ?? (piece ? pieceRxFromSheet(block.sheet) : undefined);
  const stock = block.sheet?.prescriptions.find((p) => p.stockType)?.stockType;
  const oldDay = plan.day !== today();

  return (
    <View style={styles.wrap}>
      {oldDay ? (
        <Card tone="warning">
          <Body bold>This plan is for {fmtDay(plan.day)}, not today. Ask the crew boss for today’s plan file.</Body>
        </Card>
      ) : null}

      <Card title="My piece" tone={piece ? 'ok' : 'warning'}>
        {piece ? (
          <>
            <Text style={styles.huge}>{piece.name}</Text>
            <InfoRow label="Area" value={fmtHa(polygonAreaHa(piece.polygon))} />
            {rx?.densityPerHa ? <InfoRow label="Density" value={`${rx.densityPerHa.toLocaleString('en-US')} /ha`} /> : null}
            {rx?.spacingM ? <InfoRow label="Spacing" value={`${rx.spacingM} m`} /> : null}
            {rx?.species?.length ? <InfoRow label="Species" value={rx.species.join(', ')} /> : null}
            {stock ? <InfoRow label="Stock" value={stock} /> : null}
            {piece.notes ? <Body>{piece.notes}</Body> : null}
          </>
        ) : (
          <Body>You’re not assigned to a piece in this plan. Check with the crew boss.</Body>
        )}
      </Card>

      <Card title="My cache">
        {cache ? (
          <>
            <Text style={styles.huge}>{cache.name}</Text>
            <Body>{fmtCountsInline(cache.trees)}</Body>
            {cache.notes ? <Muted>{cache.notes}</Muted> : null}
          </>
        ) : (
          <Body>No cache assigned.</Body>
        )}
      </Card>

      {plan.hazards.length > 0 ? (
        <Card title={`Hazards (${plan.hazards.length})`} tone="danger">
          {plan.hazards.map((h) => (
            <Text key={h.id} style={styles.hazard}>
              ⚠ {h.note}
              {h.kind === 'area' ? ' (area)' : ''}
            </Text>
          ))}
        </Card>
      ) : null}

      {plan.notes ? (
        <Card title="Notes from the crew boss">
          <Body>{plan.notes}</Body>
        </Card>
      ) : null}

      <Muted>
        {block.name} · plan v{version.version} for {fmtDay(plan.day)} · published {fmtDateTime(version.publishedAt)} by {version.author}
        {version.message ? ` — “${version.message}”` : ''}
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  huge: { fontSize: font.huge, fontWeight: '900', color: colors.text },
  hazard: { fontSize: font.large, fontWeight: '700', color: colors.text },
});
