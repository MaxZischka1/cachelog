import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PdfRendererHost } from '../pdf/PdfRenderer';
import { StoreProvider } from '../ui/store';
import { colors, font } from '../ui/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
    <SafeAreaProvider>
      <StoreProvider>
        <PdfRendererHost />
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTintColor: colors.primary,
            headerTitleStyle: { fontSize: font.body, fontWeight: '700', color: colors.text },
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Cachelog' }} />
          <Stack.Screen name="planter/(tabs)" options={{ headerShown: false, title: 'Today' }} />
          <Stack.Screen name="emergency" options={{ title: 'Emergency', presentation: 'modal', headerTintColor: colors.danger }} />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
