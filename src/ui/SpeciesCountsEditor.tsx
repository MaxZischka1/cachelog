import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SpeciesCount } from '../core/types';
import { Button } from './Button';
import { NumberField } from './NumberField';
import { colors, font, radius, spacing, touch } from './theme';

export interface SpeciesCountsEditorProps {
  value: SpeciesCount[];
  onChange: (v: SpeciesCount[]) => void;
  /** Species codes offered as one-tap chips (e.g. from block prices). */
  speciesOptions?: string[];
  /** Big "+N" buttons on each row (bundle sizes). */
  quickAdds?: number[];
  showTotal?: boolean;
}

export function totalCount(v: SpeciesCount[]): number {
  return v.reduce((sum, s) => sum + (Number.isFinite(s.count) ? s.count : 0), 0);
}

/** Drop empty species codes and merge duplicates; zero counts removed. */
export function cleanCounts(v: SpeciesCount[]): SpeciesCount[] {
  const map = new Map<string, number>();
  for (const s of v) {
    const code = s.species.trim();
    if (!code) continue;
    map.set(code, (map.get(code) ?? 0) + (s.count || 0));
  }
  return [...map.entries()].filter(([, c]) => c > 0).map(([species, count]) => ({ species, count }));
}

export function SpeciesCountsEditor({ value, onChange, speciesOptions = [], quickAdds, showTotal = true }: SpeciesCountsEditorProps) {
  const used = new Set(value.map((s) => s.species.trim()));
  const unusedOptions = speciesOptions.filter((o) => !used.has(o));

  const setRow = (i: number, patch: Partial<SpeciesCount>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const removeRow = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <View style={styles.wrap}>
      {value.map((row, i) => (
        <View key={i} style={styles.rowBlock}>
          <View style={styles.row}>
            <TextInput
              style={styles.species}
              value={row.species}
              onChangeText={(t) => setRow(i, { species: t })}
              placeholder="Sp"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={6}
              accessibilityLabel={`Species code row ${i + 1}`}
            />
            <NumberField style={styles.count} value={row.count || undefined} onChange={(n) => setRow(i, { count: n ?? 0 })} placeholder="0" />
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${row.species || 'row'}`} onPress={() => removeRow(i)} style={styles.remove}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
          {quickAdds && quickAdds.length > 0 ? (
            <View style={styles.quickRow}>
              {quickAdds.map((q) => (
                <Pressable
                  key={q}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${q} ${row.species}`}
                  onPress={() => setRow(i, { count: (row.count || 0) + q })}
                  style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
                >
                  <Text style={styles.quickText}>+{q}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}

      {unusedOptions.length > 0 ? (
        <View style={styles.chips}>
          {unusedOptions.map((o) => (
            <Pressable
              key={o}
              accessibilityRole="button"
              accessibilityLabel={`Add species ${o}`}
              onPress={() => onChange([...value, { species: o, count: 0 }])}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipText}>+ {o}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Button title="+ Add species" variant="secondary" size="small" onPress={() => onChange([...value, { species: '', count: 0 }])} />
      {showTotal ? <Text style={styles.total}>Total: {totalCount(value).toLocaleString('en-US')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  rowBlock: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  species: {
    width: 84,
    minHeight: touch.min,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.sm,
    fontSize: font.large,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    backgroundColor: colors.bg,
  },
  count: { flex: 1 },
  remove: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius, borderWidth: 2, borderColor: colors.danger },
  removeText: { fontSize: font.large, color: colors.danger, fontWeight: '800' },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quick: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickText: { color: colors.primaryText, fontSize: font.large, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 48, minWidth: 64, paddingHorizontal: spacing.md, borderRadius: 24, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: font.body, fontWeight: '700', color: colors.primary },
  total: { fontSize: font.large, fontWeight: '800', color: colors.text, textAlign: 'right' },
  pressed: { opacity: 0.6 },
});
