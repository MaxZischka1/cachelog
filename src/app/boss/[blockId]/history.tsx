import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { diffPlans, revertTo } from '../../../core/plan';
import type { PlanVersion } from '../../../core/types';
import { confirm, showError } from '../../../ui/alerts';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { fmtDateTime, fmtDay } from '../../../ui/format';
import { Screen } from '../../../ui/Screen';
import { EmptyState, Flag, Muted } from '../../../ui/Section';
import { useBump, useDraft, useSettings, useStore, useVersions } from '../../../ui/store';
import { colors, font, spacing } from '../../../ui/theme';

/** Published versions, newest first. Tap to see what changed; revert publishes a copy as a new version. */
export default function HistoryScreen() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const store = useStore();
  const bump = useBump();
  const { settings } = useSettings();
  const { data: versions } = useVersions(blockId);
  const { data: draft } = useDraft(blockId);
  const [open, setOpen] = useState<number | null>(null);

  const list = [...(versions ?? [])].reverse();
  const latest = list[0];

  const doRevert = async (target: PlanVersion) => {
    if (!latest) return;
    if (draft) {
      const go = await confirm(
        'Discard the draft first?',
        'You have unpublished changes. Reverting publishes a new version, so the draft would be out of date. Discard it and revert?',
        'Discard & revert',
        true,
      );
      if (!go) return;
    } else if (!(await confirm(`Revert to v${target.version}?`, `This publishes v${latest.version + 1} with the plan from v${target.version}. Share it with the crew afterwards.`, 'Revert'))) {
      return;
    }
    try {
      if (draft) await store.deleteDraft(blockId);
      const v = revertTo(target, latest, settings?.userName ?? 'Crew boss');
      await store.addVersion(v);
      bump();
    } catch (e) {
      showError('Could not revert', e);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'History' }} />
      {list.length === 0 ? <EmptyState title="Nothing published yet" /> : null}
      {list.map((v) => {
        const parent = versions?.find((p) => p.version === v.parentVersion) ?? null;
        const isOpen = open === v.version;
        const changes = isOpen ? diffPlans(parent?.content ?? null, v.content) : [];
        return (
          <Card key={v.version} title={`v${v.version}${v === latest ? '  (current)' : ''}`} onPress={() => setOpen(isOpen ? null : v.version)} tone={v === latest ? 'ok' : 'normal'}>
            <Muted>
              {fmtDateTime(v.publishedAt)} · {v.author} · plan for {fmtDay(v.content.day)}
            </Muted>
            {v.quick ? <Flag text="Quick change" tone="info" /> : null}
            {v.message ? <Text style={styles.msg}>“{v.message}”</Text> : null}
            {isOpen ? (
              <>
                {changes.length === 0 ? <Muted>No changes from v{v.parentVersion ?? '–'}.</Muted> : null}
                {changes.map((c, i) => (
                  <Text key={i} style={styles.change}>
                    • {c.text}
                  </Text>
                ))}
                {v !== latest ? <Button title={`Revert to v${v.version}`} variant="secondary" size="small" onPress={() => doRevert(v)} style={styles.revert} /> : null}
              </>
            ) : (
              <Muted>Tap to see changes</Muted>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  msg: { fontSize: font.body, fontStyle: 'italic', color: colors.text },
  change: { fontSize: font.body, color: colors.text },
  revert: { marginTop: spacing.sm },
});
