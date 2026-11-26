import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radii, spacing } from '../theme';

/**
 * Large-title header for the planter tabs: title, one line of context, and the two things that must
 * always be one tap away: Emergency and Settings.
 */
export function TopBar({ title, subtitle, blockId }: { title: string; subtitle?: string; blockId?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.row}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Emergency"
            onPress={() => router.push(blockId ? `/emergency?blockId=${blockId}` : '/emergency')}
            style={({ pressed }) => [styles.sos, pressed && styles.pressed]}
          >
            <Ionicons name="medkit" size={18} color={colors.dangerText} />
            <Text style={styles.sosText}>SOS</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings')}
            hitSlop={8}
            style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { fontSize: 34, fontWeight: '800', color: colors.text, letterSpacing: -0.5, flexShrink: 1 },
  subtitle: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
  },
  sosText: { color: colors.dangerText, fontWeight: '800', fontSize: font.small },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  pressed: { opacity: 0.7 },
});
