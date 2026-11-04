import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { centroid, distanceM, loadList, newId, polygonAreaHa } from '../../core/plan';
import type { ID, PlanContent } from '../../core/types';
import { confirm, showError } from '../alerts';
import { Button } from '../Button';
import { Card } from '../Card';
import { fmtCountsInline, fmtHa, fmtInt } from '../format';
import { TextField } from '../NumberField';
import { ChipPicker } from '../Pickers';
import { EmptyState, Muted, Section } from '../Section';
import { TextPromptSheet } from '../Sheet';
import { removePlanter, setAssignment, upsertPlanter } from '../planEdits';
import { colors, font, spacing } from '../theme';

type Edit = (fn: (c: PlanContent) => PlanContent) => Promise<void>;

function nearestCache(content: PlanContent, pieceId: ID): ID | undefined {
  const piece = content.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.polygon.length < 3 || content.caches.length === 0) return undefined;
  const c = centroid(piece.polygon);
  let best: { id: ID; d: number } | undefined;
  for (const cache of content.caches) {
    const d = distanceM(c, cache.position);
    if (!best || d < best.d) best = { id: cache.id, d };
  }
  return best?.id;
}

export function PlantersPanel({ content, onEdit }: { content: PlanContent; onEdit: Edit }) {
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<ID | null>(null);

  const run = (fn: (c: PlanContent) => PlanContent) => onEdit(fn).catch((e) => showError('Could not save the change', e));

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (content.planters.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      showError('Name already used', `${name} is already on the crew list. Use a last initial to tell them apart.`);
      return;
    }
    setNewName('');
    void run(upsertPlanter({ id: newId(), name }));
  };

  const pieceOptions = content.pieces.map((p) => ({ value: p.id, label: p.name, sublabel: fmtHa(polygonAreaHa(p.polygon)) }));
  const cacheOptions = content.caches.map((c) => ({ value: c.id, label: c.name }));

  return (
    <View style={styles.wrap}>
      <Section title={`Crew (${content.planters.length})`}>
        <View style={styles.addRow}>
          <TextField style={styles.flex} value={newName} onChangeText={setNewName} placeholder="Planter name" onSubmitEditing={add} returnKeyType="done" autoCapitalize="words" />
          <Button title="Add" onPress={add} disabled={!newName.trim()} />
        </View>
        {content.planters.length === 0 ? <EmptyState title="No planters yet" message="Add your crew, then give each one a piece and a cache." /> : null}
      </Section>

      {content.planters.map((p) => {
        const a = content.assignments.find((x) => x.planterId === p.id);
        return (
          <Card key={p.id} title={p.name}>
            <Text style={styles.label}>Piece</Text>
            {pieceOptions.length === 0 ? <Muted>Draw pieces on the map first.</Muted> : null}
            <ChipPicker
              options={pieceOptions}
              value={a?.pieceId}
              allowNone
              noneLabel="Unassigned"
              onChange={(pieceId) => {
                const cacheId = pieceId ? a?.cacheId ?? nearestCache(content, pieceId) : undefined;
                void run(setAssignment(p.id, pieceId, cacheId));
              }}
            />
            {a ? (
              <>
                <Text style={styles.label}>Cache</Text>
                <ChipPicker options={cacheOptions} value={a.cacheId} allowNone noneLabel="No cache" onChange={(cacheId) => void run(setAssignment(p.id, a.pieceId, cacheId))} />
              </>
            ) : null}
            <View style={styles.row}>
              <Button style={styles.flex} size="small" variant="secondary" title="Rename" onPress={() => setRenaming(p.id)} />
              <Button
                style={styles.flex}
                size="small"
                variant="danger"
                title="Remove"
                onPress={async () => {
                  if (await confirm(`Remove ${p.name}?`, 'They will be taken off the plan when you publish.', 'Remove', true)) void run(removePlanter(p.id));
                }}
              />
            </View>
          </Card>
        );
      })}

      <TextPromptSheet
        visible={renaming !== null}
        title="Rename planter"
        placeholder={content.planters.find((p) => p.id === renaming)?.name}
        confirmLabel="Rename"
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          const id = renaming;
          setRenaming(null);
          if (id) void run(upsertPlanter({ id, name }));
        }}
      />
    </View>
  );
}

/** Truck / heli manifest: totals by species across all caches, plus per-cache breakdown. */
export function LoadListPanel({ content }: { content: PlanContent }) {
  const totals = loadList(content);
  const grand = totals.reduce((s, t) => s + t.count, 0);
  return (
    <View style={styles.wrap}>
      <Section title="Load list">
        {totals.length === 0 ? <EmptyState title="No trees planned yet" message="Add caches with tree counts on the map." /> : null}
        {totals.map((t) => (
          <View key={t.species} style={styles.loadRow}>
            <Text style={styles.loadSpecies}>{t.species}</Text>
            <Text style={styles.loadCount}>{fmtInt(t.count)}</Text>
          </View>
        ))}
        {totals.length > 0 ? (
          <View style={[styles.loadRow, styles.loadTotal]}>
            <Text style={styles.loadSpecies}>Total</Text>
            <Text style={styles.loadCount}>{fmtInt(grand)}</Text>
          </View>
        ) : null}
      </Section>
      <Section title="By cache">
        {content.caches.map((c) => (
          <Card key={c.id} title={c.name}>
            <Text style={styles.body}>{fmtCountsInline(c.trees)}</Text>
          </Card>
        ))}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  flex: { flex: 1 },
  addRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  label: { fontSize: font.body, fontWeight: '700', color: colors.text, marginTop: spacing.xs },
  body: { fontSize: font.body, color: colors.text },
  loadRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  loadTotal: { borderBottomWidth: 0, borderTopWidth: 2, borderTopColor: colors.border },
  loadSpecies: { fontSize: font.large, fontWeight: '700', color: colors.text },
  loadCount: { fontSize: font.title, fontWeight: '800', color: colors.text },
});
