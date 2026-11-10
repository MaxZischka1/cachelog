import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useImportFlow } from '../ui/hooks/useImportFlow';
import { Screen } from '../ui/Screen';
import { useSettings } from '../ui/store';
import { colors, font } from '../ui/theme';

/** Landing screen for a file opened from outside the app. Imports it, then goes home. */
export default function OpenFile() {
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const { settings, loading } = useSettings();
  const flow = useImportFlow();
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;
    if (!settings) {
      // First run: set up name and role first; the file can be opened again afterwards.
      router.replace('/');
      return;
    }
    const home = settings.role === 'crew-boss' ? '/boss' : '/planter';
    if (!uri) {
      router.replace(home);
      return;
    }
    // Put home underneath so the import's own navigation (dismissTo) has somewhere to land.
    router.replace(home);
    flow.open(uri).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, settings, uri]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Opening file' }} />
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.text}>Opening the file…</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({ text: { fontSize: font.body, color: colors.text, textAlign: 'center' } });
