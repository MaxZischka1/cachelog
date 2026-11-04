import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { polygonAreaHa } from '../../core/plan';
import type { Cache, Hazard, Piece, SpeciesCount } from '../../core/types';
import { Button } from '../Button';
import { fmtHa } from '../format';
import { NumberField, TextField } from '../NumberField';
import { Chip } from '../Pickers';
import { Sheet } from '../Sheet';
import { cleanCounts, SpeciesCountsEditor } from '../SpeciesCountsEditor';
import { colors, font, spacing } from '../theme';

interface SheetBase<T> {
  value: T | null;
  isNew: boolean;
  onSave: (v: T) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function CacheSheet({ value, isNew, onSave, onDelete, onClose, speciesOptions }: SheetBase<Cache> & { speciesOptions: string[] }) {
  const [name, setName] = useState('');
  const [trees, setTrees] = useState<SpeciesCount[]>([]);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!value) return;
    setName(value.name);
    setTrees(value.trees.length > 0 ? value.trees : speciesOptions.slice(0, 1).map((s) => ({ species: s, count: 0 })));
    setNotes(value.notes ?? '');
    // Reset only when a different feature is opened; speciesOptions is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Sheet
      visible={!!value}
      title={isNew ? 'New cache' : `Edit ${value?.name ?? 'cache'}`}
      onClose={onClose}
      actions={
        <>
          <Button
            title={isNew ? 'Add cache' : 'Save cache'}
            disabled={!name.trim()}
            onPress={() => value && onSave({ ...value, name: name.trim(), trees: cleanCounts(trees), notes: notes.trim() || undefined })}
          />
          {!isNew ? <Button title="Delete cache" variant="danger" onPress={onDelete} /> : null}
        </>
      }
    >
      <TextField label="Name" value={name} onChangeText={setName} placeholder="Cache 1" />
      <Text style={styles.label}>Trees at this cache</Text>
      <SpeciesCountsEditor value={trees} onChange={setTrees} speciesOptions={speciesOptions} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="e.g. under the tarp by the landing" multiline />
    </Sheet>
  );
}

export function PieceSheet({ value, isNew, onSave, onDelete, onClose, speciesOptions }: SheetBase<Piece> & { speciesOptions: string[] }) {
  const [name, setName] = useState('');
  const [density, setDensity] = useState<number | undefined>();
  const [spacingM, setSpacingM] = useState<number | undefined>();
  const [species, setSpecies] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!value) return;
    setName(value.name);
    setDensity(value.prescription?.densityPerHa);
    setSpacingM(value.prescription?.spacingM);
    setSpecies(value.prescription?.species ?? []);
    setNotes(value.notes ?? '');
  }, [value]);

  const toggle = (s: string) => setSpecies((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const area = value && value.polygon.length >= 3 ? polygonAreaHa(value.polygon) : 0;

  const build = (): Piece | null => {
    if (!value) return null;
    const rx = { densityPerHa: density, spacingM, species: species.length ? species : undefined };
    const hasRx = rx.densityPerHa !== undefined || rx.spacingM !== undefined || rx.species !== undefined;
    return { ...value, name: name.trim(), prescription: hasRx ? stripUndefined(rx) : undefined, notes: notes.trim() || undefined };
  };

  return (
    <Sheet
      visible={!!value}
      title={isNew ? 'New piece' : `Edit ${value?.name ?? 'piece'}`}
      onClose={onClose}
      actions={
        <>
          <Button
            title={isNew ? 'Add piece' : 'Save piece'}
            disabled={!name.trim()}
            onPress={() => {
              const p = build();
              if (p) onSave(p);
            }}
          />
          {!isNew ? <Button title="Delete piece" variant="danger" onPress={onDelete} /> : null}
        </>
      }
    >
      <Text style={styles.area}>Area: {fmtHa(area)}</Text>
      <TextField label="Name" value={name} onChangeText={setName} placeholder="Piece 1" />
      <Text style={styles.label}>Prescription</Text>
      <View style={styles.row}>
        <NumberField style={styles.flex} label="Density" suffix="/ha" value={density} onChange={setDensity} />
        <NumberField style={styles.flex} label="Spacing" suffix="m" decimal value={spacingM} onChange={setSpacingM} />
      </View>
      {speciesOptions.length > 0 ? (
        <>
          <Text style={styles.label}>Species</Text>
          <View style={styles.chips}>
            {speciesOptions.map((s) => (
              <Chip key={s} label={s} selected={species.includes(s)} onPress={() => toggle(s)} />
            ))}
          </View>
        </>
      ) : null}
      <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="e.g. heavy slash on the north edge" multiline />
    </Sheet>
  );
}

const HAZARD_PRESETS = ['Wasp nest', 'Cliff', 'Bear sign', 'Washout', 'Steep slope', 'Deep slash'];

export function HazardSheet({ value, isNew, onSave, onDelete, onClose }: SheetBase<Hazard>) {
  const [note, setNote] = useState('');
  useEffect(() => {
    if (value) setNote(value.note);
  }, [value]);
  return (
    <Sheet
      visible={!!value}
      title={isNew ? (value?.kind === 'area' ? 'New hazard area' : 'New hazard') : 'Edit hazard'}
      onClose={onClose}
      actions={
        <>
          <Button title={isNew ? 'Add hazard' : 'Save hazard'} disabled={!note.trim()} onPress={() => value && onSave({ ...value, note: note.trim() })} />
          {!isNew ? <Button title="Delete hazard" variant="danger" onPress={onDelete} /> : null}
        </>
      }
    >
      <View style={styles.chips}>
        {HAZARD_PRESETS.map((p) => (
          <Chip key={p} label={p} selected={note === p} onPress={() => setNote(p)} />
        ))}
      </View>
      <TextField label="What is it?" value={note} onChangeText={setNote} placeholder="e.g. wasp nest by the stump" multiline />
    </Sheet>
  );
}

function stripUndefined<T extends object>(o: T): T {
  const out = {} as T;
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const styles = StyleSheet.create({
  label: { fontSize: font.body, fontWeight: '700', color: colors.text },
  area: { fontSize: font.large, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
