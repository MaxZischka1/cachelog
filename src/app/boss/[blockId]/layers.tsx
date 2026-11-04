import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { polygonAreaHa, startDraft, today, updateDraft } from '../../../core/plan';
import type { Block, Piece } from '../../../core/types';
import { importMapFile, type ImportResult } from '../../../import';
import { downloadOfflineRegion } from '../../../map';
import { confirm, showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { pickFile } from '../../../ui/files';
import { fmtHa } from '../../../ui/format';
import { addPieces } from '../../../ui/planEdits';
import { Screen } from '../../../ui/Screen';
import { Body, EmptyState, Flag, Muted, Section } from '../../../ui/Section';
import { useBlock, useBump, useLatestVersion, useStore } from '../../../ui/store';
import { colors, font } from '../../../ui/theme';

/** Import GeoTIFF / GeoPDF / KML / GeoJSON into the block, optionally pieces into the draft; offline basemap. */
export default function LayersScreen() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const store = useStore();
  const bump = useBump();
  const { data: block } = useBlock(blockId);
  const { data: latest } = useLatestVersion(blockId);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ name: string; result?: ImportResult; error?: string; piecesAdded?: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  if (!block) return <Screen>{null}</Screen>;

  const saveBlock = async (b: Block) => {
    await store.saveBlock(b);
    bump();
  };

  const addPiecesToDraft = async (pieces: Piece[]) => {
    const existing = (await store.getDraft(blockId)) ?? startDraft(blockId, await store.getLatestVersion(blockId), today());
    const names = new Set(existing.content.pieces.map((p) => p.name.toLowerCase()));
    const fresh = pieces.filter((p) => !names.has(p.name.toLowerCase()));
    await store.saveDraft(updateDraft(existing, addPieces(fresh)));
    bump();
    return fresh.length;
  };

  const doImport = async () => {
    const picked = await pickFile().catch((e) => {
      showError('Could not open the file picker', e);
      return null;
    });
    if (!picked) return;
    setBusy(true);
    try {
      const result = await importMapFile(picked.uri, picked.name);
      await saveBlock({ ...block, layers: [...block.layers, result.layer] });
      let piecesAdded: number | undefined;
      if (result.kind === 'vector' && result.pieces.length > 0) {
        const yes = await confirm(
          `${result.pieces.length} polygon${result.pieces.length === 1 ? '' : 's'} found`,
          'Add them as pieces to the draft plan? Pieces with a name already in the draft are skipped. You can review before publishing.',
          'Add pieces',
        );
        if (yes) piecesAdded = await addPiecesToDraft(result.pieces);
      }
      setLast({ name: picked.name, result, piecesAdded });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLast({ name: picked.name, error: msg });
      showError(`Could not import ${picked.name}`, e);
    } finally {
      setBusy(false);
    }
  };

  const removeLayer = async (id: string, name: string) => {
    if (!(await confirm(`Remove ${name}?`, 'The layer is removed from this phone. Pieces already added to the plan stay.', 'Remove', true))) return;
    try {
      await saveBlock({ ...block, layers: block.layers.filter((l) => l.id !== id) });
    } catch (e) {
      showError('Could not remove the layer', e);
    }
  };

  const doOffline = async () => {
    setProgress(0);
    try {
      await downloadOfflineRegion(block, latest?.content ?? null, (pct) => setProgress(pct));
      Alert.alert('Offline map ready', 'The basemap for this block is saved on the phone.');
    } catch (e) {
      showError('Offline download failed', e);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Map layers' }} />
      <Button title="Import map file" subtitle="GeoTIFF, GeoPDF, KML, GeoJSON" size="big" busy={busy} onPress={doImport} />

      {last ? (
        <Card title={`Last import: ${last.name}`} tone={last.error ? 'danger' : last.result?.warnings.length ? 'warning' : 'ok'}>
          {last.error ? <Body>{last.error}</Body> : null}
          {last.result ? <Body>Added {last.result.kind === 'raster' ? 'map image' : 'vector layer'} “{last.result.layer.name}”.</Body> : null}
          {last.result?.kind === 'vector' ? (
            <Body>
              {last.result.pieces.length} polygon{last.result.pieces.length === 1 ? '' : 's'} found
              {last.piecesAdded !== undefined ? `, ${last.piecesAdded} added to the draft as pieces` : ''}.
            </Body>
          ) : null}
          {last.result?.warnings.map((w, i) => <Flag key={i} text={w} />)}
          {last.result?.kind === 'vector' && last.piecesAdded ? (
            <View>
              {last.result.pieces.slice(0, 10).map((p) => (
                <Muted key={p.id}>
                  {p.name} · {fmtHa(polygonAreaHa(p.polygon))}
                </Muted>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <Section title="Layers on this block">
        {block.layers.length === 0 ? <EmptyState title="No layers yet" message="Import the block map from the licensee or contractor." /> : null}
        {block.layers.map((l) => (
          <Card key={l.id} title={l.name}>
            <Muted>{l.kind === 'raster' ? 'Map image (raster)' : `Vector · ${l.geojson.features.length} features`}</Muted>
            <Button title="Remove" variant="ghost" size="small" onPress={() => removeLayer(l.id, l.name)} />
          </Card>
        ))}
      </Section>

      <Section title="Offline basemap">
        <Body>Download the basemap around this block while you still have signal.</Body>
        <Button title={progress !== null ? `Downloading… ${Math.round(progress)}%` : 'Download for offline'} variant="secondary" busy={progress !== null} onPress={doOffline} />
      </Section>
      <Text style={styles.hint}>GeoPDF that can’t be drawn on the phone yet: convert it to GeoTIFF on a laptop and import that.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: font.small, color: colors.textMuted },
});
