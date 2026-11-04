import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { activeEntries } from '../core/tally';
import type { LogEntry } from '../core/types';
import { showError } from './alerts';
import { Button } from './Button';
import { Card } from './Card';
import { fmtTime } from './format';
import { EmptyState, Muted } from './Section';
import { TextPromptSheet } from './Sheet';
import { colors, font, spacing } from './theme';

/**
 * Active (non-voided) log entries with a Void button. Entries are never edited; a void is a new entry with a reason.
 * `filter` picks which entries to show from the full log (so voids are resolved against everything).
 */
export function EntryList({
  log,
  filter,
  describe,
  onVoid,
  emptyText = 'Nothing logged yet.',
}: {
  log: LogEntry[];
  filter: (e: LogEntry) => boolean;
  describe: (e: LogEntry) => string;
  onVoid: (e: LogEntry, reason: string) => Promise<void>;
  emptyText?: string;
}) {
  const [target, setTarget] = useState<LogEntry | null>(null);
  const active = activeEntries(log).filter(filter).reverse();
  const voidedCount = log.filter((e) => e.type === 'void' && log.some((t) => t.id === e.targetId && filter(t))).length;

  return (
    <View style={styles.wrap}>
      {active.length === 0 ? <EmptyState title={emptyText} /> : null}
      {active.map((e) => (
        <Card key={e.id}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.text}>{describe(e)}</Text>
              <Muted>
                {fmtTime(e.createdAt)} · {e.author}
              </Muted>
            </View>
            <Button title="Void" variant="ghost" size="small" onPress={() => setTarget(e)} />
          </View>
        </Card>
      ))}
      {voidedCount > 0 ? <Muted>{voidedCount} voided entr{voidedCount === 1 ? 'y' : 'ies'} hidden.</Muted> : null}
      <TextPromptSheet
        visible={!!target}
        title="Void this entry?"
        message={target ? `${describe(target)}\n\nThe entry stays in the log but no longer counts. Say why:` : undefined}
        placeholder="e.g. entered twice, wrong piece"
        confirmLabel="Void entry"
        destructive
        onCancel={() => setTarget(null)}
        onSubmit={(reason) => {
          const t = target;
          setTarget(null);
          if (t) onVoid(t, reason).catch((err) => showError('Could not void the entry', err));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  text: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
