import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { newId } from '../core/plan';
import type { DeviceSettings, Role } from '../core/types';
import { attempt } from './alerts';
import { Button } from './Button';
import { TextField } from './NumberField';
import { ChipPicker } from './Pickers';
import { Section } from './Section';
import { colors, font } from './theme';

const ROLES: { value: Role; label: string; sublabel: string }[] = [
  { value: 'crew-boss', label: 'Crew boss', sublabel: 'Plan, publish, tallies' },
  { value: 'planter', label: 'Planter', sublabel: 'Brief, map, bag-ups' },
];

/** Name + role. Keeps the existing deviceId when editing. */
export function SetupForm({ current, onSaved, save }: { current: DeviceSettings | null; onSaved: (s: DeviceSettings) => void; save: (s: DeviceSettings) => Promise<void> }) {
  const [name, setName] = useState(current?.userName ?? '');
  const [role, setRole] = useState<Role | undefined>(current?.role);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (current) {
      setName(current.userName);
      setRole(current.role);
    }
  }, [current]);

  const submit = async () => {
    if (!role || !name.trim()) return;
    setBusy(true);
    const roleChanged = current && current.role !== role;
    const s: DeviceSettings = {
      ...(current ?? {}),
      deviceId: current?.deviceId ?? newId(),
      userName: name.trim(),
      role,
      // A planter id only makes sense for the planter role.
      planterId: role === 'planter' && !roleChanged ? current?.planterId : undefined,
    };
    const ok = await attempt('Could not save settings', () => save(s).then(() => true));
    setBusy(false);
    if (ok) onSaved(s);
  };

  return (
    <>
      <Section title="Your name">
        <TextField value={name} onChangeText={setName} placeholder="e.g. Jess" autoCapitalize="words" autoFocus={!current} returnKeyType="done" />
        <Text style={styles.help}>Shown as the author on published plans and log entries.</Text>
      </Section>
      <Section title="On this phone I am a…">
        <ChipPicker options={ROLES} value={role} onChange={setRole} />
      </Section>
      <Button title={current ? 'Save' : 'Start'} size="big" disabled={!role || !name.trim()} busy={busy} onPress={submit} />
    </>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: font.small, color: colors.textMuted },
});
