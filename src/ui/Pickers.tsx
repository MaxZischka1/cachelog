import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing, touch } from './theme';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  sublabel?: string;
}

/** Wrapping big chips; pick one. `allowNone` adds a "None" chip that yields undefined. */
export function ChipPicker<T extends string>({
  options,
  value,
  onChange,
  allowNone,
  noneLabel = 'None',
}: {
  options: ChoiceOption<T>[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  return (
    <View style={styles.chips}>
      {allowNone ? <Chip label={noneLabel} selected={value === undefined} onPress={() => onChange(undefined)} /> : null}
      {options.map((o) => (
        <Chip key={o.value} label={o.label} sublabel={o.sublabel} selected={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

export function Chip({ label, sublabel, selected, onPress }: { label: string; sublabel?: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      {sublabel ? <Text style={[styles.chipSub, selected && styles.chipTextSelected]}>{sublabel}</Text> : null}
    </Pressable>
  );
}

/** Full-width segmented control (tabs inside a screen). */
export function Segmented<T extends string>({ options, value, onChange }: { options: ChoiceOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: sel }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, sel && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, sel && styles.chipTextSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: touch.min,
    minWidth: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  chipSub: { fontSize: font.small, color: colors.textMuted },
  chipTextSelected: { color: colors.primaryText },
  pressed: { opacity: 0.6 },
  segmented: { flexDirection: 'row', borderWidth: 2, borderColor: colors.border, borderRadius: radius, overflow: 'hidden' },
  segment: { flex: 1, minHeight: touch.min - 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
