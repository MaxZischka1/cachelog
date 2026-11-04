import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { makePlanFile, PLAN_FILE_EXTENSION, serializePlanFile } from '../../../core/plan';
import { showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { shareTextFile } from '../../../ui/files';
import { attachImages } from '../../../ui/planFileImages';
import { Alert } from 'react-native';
import { fmtDateTime, fmtDay, safeFileName } from '../../../ui/format';
import { Screen } from '../../../ui/Screen';
import { Body, EmptyState, InfoRow, Muted } from '../../../ui/Section';
import { useBlock, useDraft, useLatestVersion } from '../../../ui/store';

/** Export the latest published version as a single file and open the share sheet (AirDrop). */
export default function ShareScreen() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const { data: block } = useBlock(blockId);
  const { data: latest } = useLatestVersion(blockId);
  const { data: draft } = useDraft(blockId);
  const [busy, setBusy] = useState(false);

  if (!block || !latest) {
    return (
      <Screen>
        <EmptyState title="Nothing to share" message="Publish a plan first." />
      </Screen>
    );
  }

  const share = async () => {
    setBusy(true);
    try {
      const { file, missing } = await attachImages(makePlanFile(block, latest));
      if (missing.length) {
        Alert.alert('Some map images are missing', `${missing.join(', ')} won't be included. Re-import those maps in Map layers to fix this.`);
      }
      const name = `${safeFileName(block.name)}-v${latest.version}${PLAN_FILE_EXTENSION}`;
      await shareTextFile(name, serializePlanFile(file), { mimeType: 'application/json', UTI: 'public.json', dialogTitle: `Share ${block.name} v${latest.version}` });
    } catch (e) {
      showError('Could not share the plan', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Share plan' }} />
      <Card title={`${block.name} · v${latest.version}`}>
        <InfoRow label="Plan day" value={fmtDay(latest.content.day)} />
        <InfoRow label="Published" value={`${fmtDateTime(latest.publishedAt)} by ${latest.author}`} />
        <InfoRow label="Planters" value={String(latest.content.planters.length)} />
        <InfoRow label="Caches / pieces" value={`${latest.content.caches.length} / ${latest.content.pieces.length}`} />
      </Card>
      {draft ? <Card tone="warning"><Body>You have an unpublished draft. Only published v{latest.version} is shared.</Body></Card> : null}
      <Button title="Share / AirDrop" size="big" busy={busy} onPress={share} />
      <Body>AirDrop the file to each planter. On their phone: open Cachelog → Import plan → pick the file from Downloads or Files.</Body>
      <Muted>Phones that already have this version or a newer one will skip it.</Muted>
    </Screen>
  );
}
