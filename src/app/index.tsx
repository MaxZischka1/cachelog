import { Redirect, router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { Screen } from '../ui/Screen';
import { SetupForm } from '../ui/SetupForm';
import { useSettings } from '../ui/store';
import { colors, font } from '../ui/theme';

/** First run: name + role. Afterwards: straight to the right home screen. */
export default function Index() {
  const { settings, loading, save } = useSettings();

  if (loading) {
    return (
      <Screen>
        <ActivityIndicator size="large" color={colors.primary} />
      </Screen>
    );
  }
  if (settings) {
    return <Redirect href={settings.role === 'crew-boss' ? '/boss' : '/planter'} />;
  }
  return (
    <Screen>
      <Text style={styles.title}>Welcome to Cachelog</Text>
      <Text style={styles.body}>Plan the day, share it with the crew, log bag-ups and tallies. Everything works without signal.</Text>
      <SetupForm current={null} save={save} onSaved={(s) => router.replace(s.role === 'crew-boss' ? '/boss' : '/planter')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: '800', color: colors.text },
  body: { fontSize: font.body, color: colors.text },
});
