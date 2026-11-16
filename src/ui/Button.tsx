import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing, touch } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** 'big' for the main actions on a home screen. */
  size?: 'normal' | 'big' | 'small';
  disabled?: boolean;
  busy?: boolean;
  /** Secondary line under the title (e.g. "Draft has 3 changes"). */
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({ title, onPress, variant = 'primary', size = 'normal', disabled, busy, subtitle, style, accessibilityLabel }: ButtonProps) {
  const v = variants[variant];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!off }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'big' && styles.big,
        size === 'small' && styles.small,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !off && styles.pressed,
        off && styles.disabled,
        style,
      ]}
    >
      <View style={styles.inner}>
        {busy ? <ActivityIndicator color={v.text} /> : null}
        <View style={styles.texts}>
          <Text style={[styles.title, size === 'big' && styles.titleBig, size === 'small' && styles.titleSmall, { color: v.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: v.text }]}>{subtitle}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const variants: Record<ButtonVariant, { bg: string; text: string; border: string }> = {
  primary: { bg: colors.primary, text: colors.primaryText, border: colors.primary },
  secondary: { bg: colors.secondary, text: colors.secondaryText, border: colors.borderLight },
  danger: { bg: colors.danger, text: colors.dangerText, border: colors.danger },
  ghost: { bg: 'transparent', text: colors.text, border: colors.borderLight },
};

const styles = StyleSheet.create({
  base: {
    minHeight: touch.min,
    borderRadius: radius,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  big: { minHeight: touch.big, paddingVertical: spacing.md },
  small: { minHeight: 48, paddingHorizontal: spacing.md },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  texts: { alignItems: 'center', flexShrink: 1 },
  title: { fontSize: font.large, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  titleBig: { fontSize: font.large + 2 },
  titleSmall: { fontSize: font.body },
  subtitle: { fontSize: font.small, marginTop: 2, textAlign: 'center' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
