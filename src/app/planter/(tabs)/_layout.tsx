import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';
import { colors } from '../../../ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const icon = (on: IconName, off: IconName) =>
  function TabIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    return <Ionicons name={focused ? on : off} size={26} color={color as string} />;
  };

/** The planter's three places: log trees, see the block, read the boss's plan. */
export default function PlanterTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.borderLight, height: 88, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Bag-up', tabBarIcon: icon('add-circle', 'add-circle-outline') }} />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: icon('map', 'map-outline') }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: icon('document-text', 'document-text-outline') }} />
    </Tabs>
  );
}
