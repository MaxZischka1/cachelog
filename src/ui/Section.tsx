import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, spacing } from './theme';

export function Section({ title, children, right, style }: { title: string; children?: React.ReactNode; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function EmptyState({ title, message, children }: { title: string; message?: string; children?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {children}
    </View>
  );
}

/** Label/value row for briefs and summaries. Large value text. */
export function InfoRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, big && styles.rowValueBig]}>{value}</Text>
    </View>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Body({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
  return <Text style={[styles.body, bold && styles.bold]}>{children}</Text>;
}

/** Small pill for flags/warnings in lists. */
export function Flag({ text, tone = 'warning' }: { text: string; tone?: 'warning' | 'ok' | 'info' }) {
  return (
    <View style={[styles.flag, tone === 'ok' ? styles.flagOk : tone === 'info' ? styles.flagInfo : styles.flagWarn]}>
      <Text style={styles.flagText}>{tone === 'warning' ? '⚠ ' : ''}{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginBottom: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: font.large, fontWeight: '800', color: colors.text },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: font.large, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyMessage: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md, paddingVertical: spacing.xs },
  rowLabel: { fontSize: font.body, color: colors.textMuted, flexShrink: 0 },
  rowValue: { fontSize: font.body, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },
  rowValueBig: { fontSize: font.title },
  muted: { fontSize: font.small, color: colors.textMuted },
  body: { fontSize: font.body, color: colors.text },
  bold: { fontWeight: '700' },
  flag: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 4, borderWidth: 1 },
  flagWarn: { backgroundColor: colors.warningBg, borderColor: colors.warning },
  flagOk: { backgroundColor: colors.okBg, borderColor: colors.ok },
  flagInfo: { backgroundColor: colors.secondary, borderColor: colors.borderLight },
  flagText: { fontSize: font.small, fontWeight: '600', color: colors.text },
});
