// Registers the background GPS task; must run before any navigation (expo-task-manager docs).
import '../tracking';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider } from '../ui/store';
import { colors, font } from '../ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTintColor: colors.primary,
            headerTitleStyle: { fontSize: font.large, fontWeight: '800', color: colors.text },
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
          <Stack.Screen name="welcome" options={{ title: 'Cachelog', headerShown: false }} />
          <Stack.Screen name="emergency" options={{ title: 'Emergency', presentation: 'modal', headerTintColor: colors.danger }} />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
