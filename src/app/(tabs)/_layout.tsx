import { Tabs } from 'expo-router';
import React, { useMemo } from 'react';
import { crewMessages, unreadCount } from '../../core/messages';
import { Icon, type IconName } from '../../ui/kit';
import { useLog, useSettings } from '../../ui/store';
import { colors, font } from '../../ui/theme';

const icon = (name: IconName, focusedName: IconName) =>
  function TabIcon({ focused, color }: { focused: boolean; color: unknown }) {
    return <Icon name={focused ? focusedName : name} size={26} color={typeof color === 'string' ? color : colors.textMuted} />;
  };

/** Today · Map · Messages · Profile. Detail screens (block, bag-up, pins…) push over the tabs. */
export default function TabsLayout() {
  const { settings } = useSettings();
  const { data: log } = useLog(settings?.activeBlockId);
  const unread = useMemo(
    () => (settings ? unreadCount(crewMessages(log ?? []), settings.messagesReadAt, settings.deviceId) : 0),
    [log, settings],
  );
  const isBoss = settings?.role === 'crew-boss';

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: font.large, fontWeight: '800', color: colors.text },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.hairline },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: isBoss ? 'Blocks' : 'Today', tabBarIcon: icon(isBoss ? 'albums-outline' : 'today-outline', isBoss ? 'albums' : 'today') }} />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: icon('map-outline', 'map') }} />
      <Tabs.Screen
        name="messages"
        options={{ title: 'Messages', tabBarIcon: icon('chatbubbles-outline', 'chatbubbles'), tabBarBadge: unread ? unread : undefined, tabBarBadgeStyle: { backgroundColor: colors.danger } }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
