import { Redirect, router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../ui/kit';
import { Screen } from '../ui/Screen';
import { SetupForm } from '../ui/SetupForm';
import { useSettings } from '../ui/store';
import { colors, font, spacing } from '../ui/theme';

/** First run: name + role. Once set up, the tabs take over. */
export default function Welcome() {
  const { settings, loading, save } = useSettings();

  if (loading) {
    return (
      <Screen>
        <ActivityIndicator size="large" color={colors.primary} />
      </Screen>
    );
  }
  if (settings) return <Redirect href="/" />;
  return (
    <Screen top>
      <View style={styles.mark}>
        <Icon name="leaf" size={36} color={colors.primary} />
      </View>
      <Text style={styles.title}>Welcome to Cachelog</Text>
      <Text style={styles.body}>Import block maps, plan the day, track your trees. Everything works without signal.</Text>
      <SetupForm current={null} save={save} onSaved={() => router.replace('/')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mark: { width: 72, height: 72, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  title: { fontSize: font.title + 4, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  body: { fontSize: font.body, color: colors.textMuted },
});
