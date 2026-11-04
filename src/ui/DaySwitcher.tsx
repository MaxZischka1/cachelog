import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { today } from '../core/plan';
import type { DayString } from '../core/types';
import { Button } from './Button';
import { fmtDay, shiftDay } from './format';
import { colors, font, spacing } from './theme';

export function DaySwitcher({ day, onChange }: { day: DayString; onChange: (d: DayString) => void }) {
  const isToday = day === today();
  return (
    <View style={styles.row}>
      <Button title="◀" variant="secondary" accessibilityLabel="Previous day" onPress={() => onChange(shiftDay(day, -1))} style={styles.btn} />
      <View style={styles.mid}>
        <Text style={styles.day}>{fmtDay(day)}</Text>
        {isToday ? <Text style={styles.sub}>Today</Text> : <Text style={styles.link} onPress={() => onChange(today())}>Back to today</Text>}
      </View>
      <Button title="▶" variant="secondary" accessibilityLabel="Next day" disabled={isToday} onPress={() => onChange(shiftDay(day, 1))} style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btn: { width: 64 },
  mid: { flex: 1, alignItems: 'center' },
  day: { fontSize: font.large, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted },
  link: { fontSize: font.body, color: colors.primary, fontWeight: '700', paddingVertical: 4 },
});
