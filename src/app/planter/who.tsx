import { router, Stack } from 'expo-router';
import React from 'react';
import { showError } from '../../ui/alerts';
import { Button } from '../../ui/Button';
import { usePlanterData } from '../../ui/hooks/usePlanter';
import { Screen } from '../../ui/Screen';
import { Body, EmptyState } from '../../ui/Section';

/** "Which planter am I?" — pick from the plan's crew list. */
export default function WhoAmI() {
  const d = usePlanterData();
  if (!d.plan) {
    return (
      <Screen>
        <EmptyState title="Import a plan first" />
      </Screen>
    );
  }
  const pick = async (id: string) => {
    try {
      await d.update({ planterId: id });
      if (router.canGoBack()) router.back();
      else router.replace('/planter');
    } catch (e) {
      showError('Could not save', e);
    }
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Which planter are you?' }} />
      <Body>Tap your name. This phone will show your piece, your cache and your totals.</Body>
      {d.plan.planters.map((p) => (
        <Button key={p.id} title={p.name} size="big" variant={p.id === d.settings?.planterId ? 'primary' : 'secondary'} onPress={() => pick(p.id)} />
      ))}
    </Screen>
  );
}
