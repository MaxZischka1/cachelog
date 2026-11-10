import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { PIN_KINDS, pinLabel, pinStates, type PinState } from '../core/tally';
import type { ID, LogEntry, PinEntry, PinKind } from '../core/types';
import type { MapPin } from '../map';
import { Button } from './Button';
import { TextField } from './NumberField';
import { ChipPicker } from './Pickers';
import { Sheet } from './Sheet';
import { useLog } from './store';
import { colors, font } from './theme';

const TONE: Record<PinKind, MapPin['tone']> = {
  hazard: 'danger',
  'cache-low': 'request',
  'need-trees': 'request',
  question: 'request',
  unplantable: 'info',
  access: 'info',
  done: 'info',
  note: 'info',
};

export function pinText(pin: PinEntry): string {
  const label = pinLabel(pin.kind);
  return pin.note?.trim() ? `${label}: ${pin.note.trim()}` : label;
}

export function toMapPins(states: PinState[], includeResolved = false): MapPin[] {
  return states
    .filter((s) => includeResolved || !s.resolved)
    .map((s) => ({ id: s.pin.id, position: s.pin.position, label: `${pinLabel(s.pin.kind)} · ${s.pin.author}`, tone: TONE[s.pin.kind], resolved: !!s.resolved }));
}

/** All crew pins for a block (every day), plus the open ones ready for the map. */
export function usePins(blockId: ID | undefined) {
  const { data } = useLog(blockId);
  return useMemo(() => {
    const log: LogEntry[] = data ?? [];
    const states = blockId ? pinStates(log, blockId) : [];
    const open = states.filter((s) => !s.resolved);
    return { log, states, open, mapPins: toMapPins(states), loading: data === undefined };
  }, [data, blockId]);
}

/** Pick what the pin is about and add a note. Position is decided by the caller. */
export function PinSheet({
  visible,
  where,
  initialKind = 'note',
  onSave,
  onClose,
}: {
  visible: boolean;
  /** Shown under the title, e.g. "At your location (±6 m)". */
  where: string;
  initialKind?: PinKind;
  onSave: (kind: PinKind, note: string | undefined) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<PinKind>(initialKind);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (visible) {
      setKind(initialKind);
      setNote('');
    }
  }, [visible, initialKind]);
  const hint = PIN_KINDS.find((k) => k.kind === kind)?.hint;
  return (
    <Sheet visible={visible} title="Drop a pin" onClose={onClose} actions={<Button title="Drop pin" size="big" onPress={() => onSave(kind, note.trim() || undefined)} />}>
      <Text style={styles.where}>{where}</Text>
      <ChipPicker<PinKind> options={PIN_KINDS.map((k) => ({ value: k.kind, label: k.label }))} value={kind} onChange={(v) => v && setKind(v)} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="A few words for the crew" multiline />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  where: { fontSize: font.body, fontWeight: '700', color: colors.text },
  hint: { fontSize: font.body, color: colors.textMuted },
});
