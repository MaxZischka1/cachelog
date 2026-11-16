/**
 * Building blocks for the quieter layout: grouped list rows, stat tiles, a hero card and a
 * small column chart. Large type and 56 pt rows stay, for gloves and glare.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing, touch } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

/** White group of rows separated by hairlines (iOS settings style). `icons`: rows have icons, so dividers start at the text. */
export function ListGroup({ children, style, icons = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; icons?: boolean }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]}>
      {rows.map((c, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.divider, !icons && styles.dividerPlain]} /> : null}
          {c}
        </View>
      ))}
    </View>
  );
}

export interface ListRowProps {
  icon?: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  /** Short value at the right (a count, a status). */
  value?: string;
  onPress?: () => void;
  tone?: 'normal' | 'danger';
  badge?: number;
  disabled?: boolean;
}

export function ListRow({ icon, iconColor, title, subtitle, value, onPress, tone = 'normal', badge, disabled }: ListRowProps) {
  const tint = tone === 'danger' ? colors.danger : iconColor ?? colors.primary;
  const body = (
    <View style={[styles.row, disabled && styles.disabled]}>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: tone === 'danger' ? '#FBE9E7' : colors.primarySoft }]}>
          <Icon name={icon} size={20} color={tint} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, tone === 'danger' && { color: colors.danger }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <Icon name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </View>
  );
  if (!onPress || disabled) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

/** A number with a label under it. */
export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

/** Stats side by side in one white card, split by hairlines. */
export function StatRow({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, styles.statRow]}>
      {items.map((c, i) => (
        <View key={i} style={[styles.statCell, i > 0 && styles.statDivider]}>
          {c}
        </View>
      ))}
    </View>
  );
}

/** The one big card at the top of a screen. */
export function Hero({ eyebrow, title, children, style }: { eyebrow?: string; title?: string; children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.hero, style]}>
      {eyebrow ? <Text style={styles.heroEyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={styles.heroTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/** Thin progress bar (0..1). */
export function Progress({ value, color = colors.primary }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <View style={[styles.fill, { width: `${v * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export interface Column {
  key: string;
  /** Under the column (e.g. weekday initial). */
  label: string;
  value: number;
  /** Said when the column is tapped, and by VoiceOver. */
  detail: string;
}

/**
 * One series of columns from a single baseline: <= 24 pt wide, 4 pt rounded tops, 2 pt gaps,
 * a hairline baseline. Only the highlighted columns carry a value label; tap any column to read it.
 */
export function ColumnChart({ data, highlight = [], height = 120 }: { data: Column[]; highlight?: string[]; height?: number }) {
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const shown = data.find((d) => d.key === picked);
  return (
    <View>
      <Text style={styles.chartReadout} accessibilityLiveRegion="polite">
        {shown ? shown.detail : 'Tap a day to see it'}
      </Text>
      <View style={[styles.plot, { height }]}>
        {data.map((d) => {
          const h = d.value > 0 ? Math.max(4, (d.value / max) * (height - 22)) : 0;
          const on = d.key === picked;
          return (
            <Pressable
              key={d.key}
              style={styles.slot}
              onPress={() => setPicked(on ? null : d.key)}
              accessibilityRole="button"
              accessibilityLabel={d.detail}
              hitSlop={4}
            >
              {highlight.includes(d.key) && d.value > 0 ? (
                <Text style={styles.colLabel} numberOfLines={1}>
                  {compact(d.value)}
                </Text>
              ) : null}
              <View style={[styles.col, { height: h, backgroundColor: colors.chart, opacity: picked && !on ? 0.45 : 1 }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.baseline} />
      <View style={styles.axis}>
        {data.map((d) => (
          <Text key={d.key} style={styles.axisLabel}>
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function compact(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

const styles = StyleSheet.create({
  group: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight, marginLeft: spacing.lg + 36 + spacing.md },
  dividerPlain: { marginLeft: spacing.lg },
  row: { minHeight: touch.min + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: font.body, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: font.small, color: colors.textMuted },
  rowValue: { fontSize: font.body, color: colors.textMuted, fontWeight: '600' },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  pressed: { backgroundColor: colors.bg },
  disabled: { opacity: 0.45 },
  statRow: { flexDirection: 'row' },
  statCell: { flex: 1, padding: spacing.md },
  statDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.borderLight },
  stat: { gap: 2 },
  statValue: { fontSize: font.large + 4, fontWeight: '800', color: colors.text, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: font.small, color: colors.textMuted },
  statSub: { fontSize: 13, color: colors.textMuted },
  hero: { backgroundColor: colors.surface, borderRadius: radius + 4, borderWidth: 1, borderColor: colors.hairline, padding: spacing.xl, gap: spacing.md },
  heroEyebrow: { fontSize: font.small, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.8 },
  heroTitle: { fontSize: font.title, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.hairline, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  chartReadout: { fontSize: font.small, color: colors.textMuted, marginBottom: spacing.sm, minHeight: 20 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  col: { width: '100%', maxWidth: 24, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  colLabel: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2, width: 48, textAlign: 'center' },
  baseline: { height: 1, backgroundColor: colors.borderLight },
  axis: { flexDirection: 'row', gap: 2, marginTop: 4 },
  axisLabel: { flex: 1, textAlign: 'center', fontSize: 12, color: colors.textMuted },
});

/** Always first on a home screen: one tap to the emergency card. Slim, but a full-width 56 pt target. */
export function EmergencyBar({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Emergency" onPress={onPress} style={({ pressed }) => [emergency.bar, pressed && { opacity: 0.8 }]}>
      <Icon name="warning" size={22} color={colors.dangerText} />
      <Text style={emergency.text}>Emergency</Text>
      <Text style={emergency.sub}>Muster point · radio · hospital</Text>
    </Pressable>
  );
}

const emergency = StyleSheet.create({
  bar: { minHeight: touch.min, borderRadius: radius, backgroundColor: colors.danger, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  text: { color: colors.dangerText, fontSize: font.large, fontWeight: '800' },
  sub: { color: colors.dangerText, fontSize: font.small, opacity: 0.9, flex: 1, textAlign: 'right' },
});
