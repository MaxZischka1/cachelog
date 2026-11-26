import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { polygonAreaHa } from '../../../core/plan';
import type { Block } from '../../../core/types';
import { type ImportResult } from '../../../import';
import { importMapIntoBlock } from '../../../ui/mapImport';
import { downloadOfflineRegion } from '../../../map';
import { confirm, showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { pickFile } from '../../../ui/files';
import { fmtHa } from '../../../ui/format';
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

  const doImport = async () => {
    const picked = await pickFile().catch((e) => {
      showError('Could not open the file picker', e);
      return null;
    });
    if (!picked) return;
    setBusy(true);
    try {
      const out = await importMapIntoBlock(store, block, picked.uri, picked.name);
      bump();
      setLast({ name: picked.name, result: out.result, piecesAdded: out.piecesAdded });
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
          {last.result ? (
            <Body>
              Added {last.result.kind === 'vector' ? 'vector layer' : 'map image'} “{last.result.layer.name}”
              {last.result.kind === 'geopdf' && last.result.outline ? ' and the block outline' : ''}.
            </Body>
          ) : null}
          {last.result?.kind === 'geopdf' && last.result.candidates.length ? (
            <View>
              <Muted>Shapes found in the PDF layers:</Muted>
              {last.result.candidates.slice(0, 6).map((c) => (
                <Muted key={c.name}>
                  {c.name} · {c.polygons} shape{c.polygons === 1 ? '' : 's'} · {fmtHa(c.areaHa)}
                </Muted>
              ))}
            </View>
          ) : null}
          {last.result?.kind === 'geopdf' && last.piecesAdded !== undefined ? <Body>{last.piecesAdded} added to the draft as pieces.</Body> : null}
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
      <Text style={styles.hint}>GeoPDFs (Avenza, ArcGIS, licensee maps) are drawn on the phone and their block shapes are read from the PDF layers.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: font.small, color: colors.textMuted },
});
