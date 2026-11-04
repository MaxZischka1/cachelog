import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { newId, polygonAreaHa } from '../../core/plan';
import type { Block, Cache, Hazard, ID, LngLat, PlanContent, Piece } from '../../core/types';
import { BlockMap, type MapMode } from '../../map';
import { choose, confirm, showError } from '../alerts';
import { Button } from '../Button';
import { fmtCountsInline, fmtHa, speciesFromBlock } from '../format';
import { nextName, removeCache, removeHazard, removePiece, upsertCache, upsertHazard, upsertPiece } from '../planEdits';
import { colors, font, radius, spacing } from '../theme';
import { CacheSheet, HazardSheet, PieceSheet } from './FeatureSheets';

type Edit = (fn: (c: PlanContent) => PlanContent) => Promise<void>;

type Tool =
  | { kind: 'view' }
  | { kind: 'add-cache' }
  | { kind: 'draw-piece'; redrawId?: ID }
  | { kind: 'add-hazard-point' }
  | { kind: 'draw-hazard-area' }
  | { kind: 'move'; type: 'cache' | 'hazard'; id: ID };

type Selection = { type: 'cache' | 'piece' | 'hazard'; id: ID } | null;

type SheetState =
  | { type: 'cache'; value: Cache; isNew: boolean }
  | { type: 'piece'; value: Piece; isNew: boolean }
  | { type: 'hazard'; value: Hazard; isNew: boolean }
  | null;

export interface PlanMapEditorProps {
  block: Block;
  content: PlanContent;
  onEdit: Edit;
  /** Shown at the bottom when nothing is selected (e.g. Review & publish). */
  footer?: React.ReactNode;
  /** Shown above the toolbar, e.g. "Quick change: make one edit". */
  banner?: string;
  highlightIds?: ID[];
}

/** Full-screen map with a toolbar for adding/moving/deleting caches, pieces and hazards. */
export function PlanMapEditor({ block, content, onEdit, footer, banner, highlightIds }: PlanMapEditorProps) {
  const [tool, setTool] = useState<Tool>({ kind: 'view' });
  const [selection, setSelection] = useState<Selection>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const speciesOptions = useMemo(() => speciesFromBlock(block, content), [block, content]);

  const run = async (fn: (c: PlanContent) => PlanContent) => {
    try {
      await onEdit(fn);
    } catch (e) {
      showError('Could not save the change', e);
    }
  };

  const toView = () => setTool({ kind: 'view' });

  const mode: MapMode = (() => {
    switch (tool.kind) {
      case 'add-cache':
        return {
          kind: 'place-point',
          onPlace: (p: LngLat) => {
            toView();
            setSheet({ type: 'cache', isNew: true, value: { id: newId(), name: nextName('Cache', content.caches), position: p, trees: [] } });
          },
        };
      case 'add-hazard-point':
        return {
          kind: 'place-point',
          onPlace: (p: LngLat) => {
            toView();
            setSheet({ type: 'hazard', isNew: true, value: { id: newId(), kind: 'point', geometry: [p], note: '' } });
          },
        };
      case 'draw-piece': {
        const redrawId = tool.redrawId;
        return {
          kind: 'draw-polygon',
          onCancel: toView,
          onDone: (ring: LngLat[]) => {
            toView();
            if (ring.length < 3) {
              showError('Piece not drawn', 'A piece needs at least 3 corners.');
              return;
            }
            const existing = redrawId ? content.pieces.find((p) => p.id === redrawId) : undefined;
            if (existing) {
              void run(upsertPiece({ ...existing, polygon: ring }));
            } else {
              setSheet({ type: 'piece', isNew: true, value: { id: newId(), name: nextName('Piece', content.pieces), polygon: ring } });
            }
          },
        };
      }
      case 'draw-hazard-area':
        return {
          kind: 'draw-polygon',
          onCancel: toView,
          onDone: (ring: LngLat[]) => {
            toView();
            if (ring.length < 3) return;
            setSheet({ type: 'hazard', isNew: true, value: { id: newId(), kind: 'area', geometry: ring, note: '' } });
          },
        };
      case 'move': {
        const { type, id } = tool;
        return {
          kind: 'move-point',
          id,
          onMove: (p: LngLat) => {
            toView();
            if (type === 'cache') {
              const c = content.caches.find((x) => x.id === id);
              if (c) void run(upsertCache({ ...c, position: p }));
            } else {
              const h = content.hazards.find((x) => x.id === id);
              if (h) void run(upsertHazard({ ...h, geometry: [p] }));
            }
          },
        };
      }
      default:
        return { kind: 'view' };
    }
  })();

  const instructions: Record<Tool['kind'], string> = {
    view: '',
    'add-cache': 'Tap the map where the cache is.',
    'add-hazard-point': 'Tap the map where the hazard is.',
    'draw-piece': 'Tap the corners of the piece, then Done on the map.',
    'draw-hazard-area': 'Tap the corners of the hazard area, then Done on the map.',
    move: 'Tap the new spot on the map.',
  };

  const addHazard = async () => {
    const kind = await choose('Add hazard', 'A single spot or an area?', [
      { label: 'Spot (wasp nest, bear sign)', value: 'point' },
      { label: 'Area (cliff band, washout)', value: 'area' },
    ]);
    if (kind === 'point') setTool({ kind: 'add-hazard-point' });
    if (kind === 'area') setTool({ kind: 'draw-hazard-area' });
  };

  const openSelected = () => {
    if (!selection) return;
    if (selection.type === 'cache') {
      const v = content.caches.find((x) => x.id === selection.id);
      if (v) setSheet({ type: 'cache', value: v, isNew: false });
    } else if (selection.type === 'piece') {
      const v = content.pieces.find((x) => x.id === selection.id);
      if (v) setSheet({ type: 'piece', value: v, isNew: false });
    } else {
      const v = content.hazards.find((x) => x.id === selection.id);
      if (v) setSheet({ type: 'hazard', value: v, isNew: false });
    }
  };

  const deleteFeature = async (sel: NonNullable<Selection>, label: string) => {
    const extra = sel.type === 'piece' ? ' Planters assigned to it will be unassigned.' : '';
    if (!(await confirm(`Delete ${label}?`, `This only changes the draft until you publish.${extra}`, 'Delete', true))) return;
    setSheet(null);
    setSelection(null);
    await run(sel.type === 'cache' ? removeCache(sel.id) : sel.type === 'piece' ? removePiece(sel.id) : removeHazard(sel.id));
  };

  const selectedInfo = describe(selection, content);

  return (
    <View style={styles.flex}>
      <BlockMap
        block={block}
        plan={content}
        mode={mode}
        highlightIds={highlightIds ?? (selection ? [selection.id] : undefined)}
        showUserLocation
        onSelect={(sel) => {
          if (tool.kind === 'view') setSelection(sel);
        }}
        style={styles.flex}
      />

      <View style={styles.topBar} pointerEvents="box-none">
        {banner ? <Text style={styles.banner}>{banner}</Text> : null}
        {tool.kind === 'view' ? (
          <View style={styles.toolbar}>
            <Button style={styles.tool} title="+ Cache" onPress={() => setTool({ kind: 'add-cache' })} />
            <Button style={styles.tool} title="+ Piece" onPress={() => setTool({ kind: 'draw-piece' })} />
            <Button style={styles.tool} title="+ Hazard" onPress={addHazard} />
          </View>
        ) : null}
      </View>

      <View style={styles.bottom}>
        {selection && selectedInfo && tool.kind === 'view' ? (
          <View style={styles.selPanel}>
            <Text style={styles.selTitle}>{selectedInfo.title}</Text>
            {selectedInfo.detail ? <Text style={styles.selDetail}>{selectedInfo.detail}</Text> : null}
            <View style={styles.selButtons}>
              <Button style={styles.flex} size="small" title="Edit" onPress={openSelected} />
              {selection.type === 'piece' ? (
                <Button style={styles.flex} size="small" variant="secondary" title="Redraw" onPress={() => setTool({ kind: 'draw-piece', redrawId: selection.id })} />
              ) : selectedInfo.movable ? (
                <Button
                  style={styles.flex}
                  size="small"
                  variant="secondary"
                  title="Move"
                  onPress={() => setTool({ kind: 'move', type: selection.type === 'cache' ? 'cache' : 'hazard', id: selection.id })}
                />
              ) : null}
              <Button style={styles.flex} size="small" variant="danger" title="Delete" onPress={() => deleteFeature(selection, selectedInfo.title)} />
            </View>
            <Button size="small" variant="ghost" title="Done" onPress={() => setSelection(null)} />
          </View>
        ) : tool.kind === 'view' ? (
          footer
        ) : tool.kind === 'draw-piece' || tool.kind === 'draw-hazard-area' ? null : (
          // The map shows its own hint at the top and Cancel/Done only for drawing; give place/move a way out.
          <View style={styles.modeBar}>
            <Text style={styles.modeText}>{instructions[tool.kind]}</Text>
            <Button title="Cancel" variant="secondary" size="small" onPress={toView} />
          </View>
        )}
      </View>

      <CacheSheet
        value={sheet?.type === 'cache' ? sheet.value : null}
        isNew={!!sheet?.isNew}
        speciesOptions={speciesOptions}
        onClose={() => setSheet(null)}
        onSave={(c) => {
          setSheet(null);
          void run(upsertCache(c));
        }}
        onDelete={() => sheet?.type === 'cache' && deleteFeature({ type: 'cache', id: sheet.value.id }, sheet.value.name)}
      />
      <PieceSheet
        value={sheet?.type === 'piece' ? sheet.value : null}
        isNew={!!sheet?.isNew}
        speciesOptions={speciesOptions}
        onClose={() => setSheet(null)}
        onSave={(p) => {
          setSheet(null);
          void run(upsertPiece(p));
        }}
        onDelete={() => sheet?.type === 'piece' && deleteFeature({ type: 'piece', id: sheet.value.id }, sheet.value.name)}
      />
      <HazardSheet
        value={sheet?.type === 'hazard' ? sheet.value : null}
        isNew={!!sheet?.isNew}
        onClose={() => setSheet(null)}
        onSave={(h) => {
          setSheet(null);
          void run(upsertHazard(h));
        }}
        onDelete={() => sheet?.type === 'hazard' && deleteFeature({ type: 'hazard', id: sheet.value.id }, 'this hazard')}
      />
    </View>
  );
}

function describe(sel: Selection, c: PlanContent): { title: string; detail?: string; movable: boolean } | null {
  if (!sel) return null;
  if (sel.type === 'cache') {
    const x = c.caches.find((v) => v.id === sel.id);
    return x ? { title: x.name, detail: fmtCountsInline(x.trees), movable: true } : null;
  }
  if (sel.type === 'piece') {
    const x = c.pieces.find((v) => v.id === sel.id);
    if (!x) return null;
    const who = c.assignments.filter((a) => a.pieceId === x.id).map((a) => c.planters.find((p) => p.id === a.planterId)?.name).filter(Boolean);
    return { title: x.name, detail: `${fmtHa(polygonAreaHa(x.polygon))}${who.length ? ` · ${who.join(', ')}` : ''}`, movable: false };
  }
  const x = c.hazards.find((v) => v.id === sel.id);
  return x ? { title: `Hazard: ${x.note}`, detail: x.kind === 'area' ? 'Area' : undefined, movable: x.kind === 'point' } : null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, gap: spacing.sm },
  banner: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
    borderWidth: 2,
    borderRadius: radius,
    padding: spacing.sm,
    fontSize: font.body,
    fontWeight: '700',
    color: colors.text,
    overflow: 'hidden',
  },
  toolbar: { flexDirection: 'row', gap: spacing.sm },
  tool: { flex: 1, paddingHorizontal: spacing.xs },
  modeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 2,
    borderRadius: radius,
    padding: spacing.sm,
  },
  modeText: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
  bottom: { position: 'absolute', bottom: spacing.lg, left: spacing.sm, right: spacing.sm, gap: spacing.sm },
  selPanel: { backgroundColor: colors.bg, borderRadius: radius, borderWidth: 2, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  selTitle: { fontSize: font.large, fontWeight: '800', color: colors.text },
  selDetail: { fontSize: font.body, color: colors.text },
  selButtons: { flexDirection: 'row', gap: spacing.sm },
});
