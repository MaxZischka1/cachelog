import { Redirect } from 'expo-router';
import React from 'react';
import { BossHome } from '../../ui/home/BossHome';
import { PlanterToday } from '../../ui/home/PlanterToday';
import { Screen } from '../../ui/Screen';
import { useSettings } from '../../ui/store';

/** First tab: the crew boss's blocks, or the planter's day. First run goes to setup. */
export default function Home() {
  const { settings, loading } = useSettings();
  if (loading) return <Screen tab>{null}</Screen>;
  if (!settings) return <Redirect href="/welcome" />;
  return settings.role === 'crew-boss' ? <BossHome /> : <PlanterToday />;
}
