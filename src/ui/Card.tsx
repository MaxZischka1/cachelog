import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing } from './theme';

export interface CardProps {
  title?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  tone?: 'normal' | 'warning' | 'ok' | 'danger';
  style?: StyleProp<ViewStyle>;
}

export function Card({ title, children, onPress, tone = 'normal', style }: CardProps) {
  const toneStyle = tone === 'warning' ? styles.warning : tone === 'ok' ? styles.ok : tone === 'danger' ? styles.danger : null;
  const content = (
    <>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </>
  );
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, toneStyle, pressed && styles.pressed, style]}>
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.card, toneStyle, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  warning: { backgroundColor: colors.warningBg, borderColor: colors.warning, borderWidth: 2 },
  ok: { backgroundColor: colors.okBg, borderColor: colors.ok },
  danger: { backgroundColor: '#FDECEA', borderColor: colors.danger, borderWidth: 2 },
  title: { fontSize: font.large, fontWeight: '700', color: colors.text },
  pressed: { opacity: 0.7 },
});
