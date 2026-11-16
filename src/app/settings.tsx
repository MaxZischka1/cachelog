import { router, Stack } from 'expo-router';
import React from 'react';
import { Screen } from '../ui/Screen';
import { Muted } from '../ui/Section';
import { SetupForm } from '../ui/SetupForm';
import { useSettings } from '../ui/store';

export default function SettingsScreen() {
  const { settings, save } = useSettings();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Settings' }} />
      <SetupForm current={settings} save={save} onSaved={() => router.replace('/')} />
      {settings ? <Muted>Device ID: {settings.deviceId}</Muted> : null}
    </Screen>
  );
}
