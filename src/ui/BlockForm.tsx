import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { newId, nowIso } from '../core/plan';
import type { Block, EmergencyInfo, LngLat } from '../core/types';
import { useUserLocation } from '../map';
import { showError } from './alerts';
import { Button } from './Button';
import { fmtLngLat, fmtPrice, parsePriceToCents } from './format';
import { TextField } from './NumberField';
import { Muted, Section } from './Section';
import { colors, font, radius, spacing, touch } from './theme';

interface PriceRow {
  species: string;
  price: string;
}

const DEFAULT_PRICES: PriceRow[] = [
  { species: 'Sx', price: '' },
  { species: 'Pl', price: '' },
];

/** Create or edit a block: name, contract, licensee, prices ($/tree), emergency info. */
export function BlockForm({ initial, onSubmit, submitLabel }: { initial: Block | null; onSubmit: (b: Block) => Promise<void>; submitLabel: string }) {
  const [name, setName] = useState('');
  const [contract, setContract] = useState('');
  const [licensee, setLicensee] = useState('');
  const [prices, setPrices] = useState<PriceRow[]>(DEFAULT_PRICES);
  const [em, setEm] = useState<EmergencyInfo>({});
  const [busy, setBusy] = useState(false);
  const loc = useUserLocation();

  useEffect(() => {
    if (!initial) return;
    setName(initial.name);
    setContract(initial.contract ?? '');
    setLicensee(initial.licensee ?? '');
    const rows = Object.entries(initial.pricesCents).map(([species, c]) => ({ species, price: fmtPrice(c).slice(1) }));
    setPrices(rows.length ? rows : DEFAULT_PRICES);
    setEm(initial.emergency ?? {});
  }, [initial]);

  const setRow = (i: number, patch: Partial<PriceRow>) => setPrices((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    const pricesCents: Record<string, number> = {};
    for (const r of prices) {
      const sp = r.species.trim();
      if (!sp) continue;
      if (!r.price.trim()) continue;
      const c = parsePriceToCents(r.price);
      if (c === undefined) {
        showError('Check the prices', `"${r.price}" for ${sp} is not a price. Use dollars per tree, e.g. 0.16`);
        return;
      }
      if (c > 500) {
        showError('Check the prices', `${sp} at ${fmtPrice(c)} per tree looks too high. Enter dollars per tree, e.g. 0.16`);
        return;
      }
      pricesCents[sp] = c;
    }
    const clean = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    const block: Block = {
      id: initial?.id ?? newId(),
      createdAt: initial?.createdAt ?? nowIso(),
      layers: initial?.layers ?? [],
      name: name.trim(),
      contract: clean(contract),
      licensee: clean(licensee),
      pricesCents,
      emergency: {
        musterPoint: em.musterPoint,
        helipad: em.helipad,
        evacRoute: clean(em.evacRoute),
        nearestHospital: clean(em.nearestHospital),
        radioChannel: clean(em.radioChannel),
        notes: clean(em.notes),
      },
    };
    setBusy(true);
    try {
      await onSubmit(block);
    } catch (e) {
      showError('Could not save the block', e);
    } finally {
      setBusy(false);
    }
  };

  const setPoint = (key: 'musterPoint' | 'helipad') => {
    if (!loc.position) {
      showError('No GPS position yet', loc.permission === 'denied' ? 'Allow location for Cachelog in Settings.' : 'Wait a moment for a GPS fix and try again.');
      return;
    }
    const p: LngLat = [loc.position[0], loc.position[1]];
    setEm((e) => ({ ...e, [key]: p }));
  };

  return (
    <>
      <Section title="Block">
        <TextField label="Block name" value={name} onChangeText={setName} placeholder="e.g. Cutblock 42-7" autoCapitalize="words" />
        <TextField label="Contract" value={contract} onChangeText={setContract} placeholder="optional" />
        <TextField label="Licensee" value={licensee} onChangeText={setLicensee} placeholder="optional" />
      </Section>

      <Section title="Tree prices ($ per tree)">
        {prices.map((r, i) => (
          <View key={i} style={styles.priceRow}>
            <TextInput
              style={[styles.input, styles.species]}
              value={r.species}
              onChangeText={(t) => setRow(i, { species: t })}
              placeholder="Sp"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel={`Species ${i + 1}`}
            />
            <Text style={styles.dollar}>$</Text>
            <TextInput
              style={[styles.input, styles.price]}
              value={r.price}
              onChangeText={(t) => setRow(i, { price: t })}
              placeholder="0.16"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              accessibilityLabel={`Price for ${r.species || 'species'}`}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Remove price" style={styles.remove} onPress={() => setPrices((p) => p.filter((_, j) => j !== i))}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Button title="+ Add species" variant="secondary" size="small" onPress={() => setPrices((p) => [...p, { species: '', price: '' }])} />
      </Section>

      <Section title="Emergency info">
        <View style={styles.pointRow}>
          <View style={styles.flex}>
            <Text style={styles.label}>Muster point</Text>
            <Muted>{fmtLngLat(em.musterPoint)}</Muted>
          </View>
          <Button size="small" variant="secondary" title="Use my spot" onPress={() => setPoint('musterPoint')} />
        </View>
        <View style={styles.pointRow}>
          <View style={styles.flex}>
            <Text style={styles.label}>Helipad</Text>
            <Muted>{fmtLngLat(em.helipad)}</Muted>
          </View>
          <Button size="small" variant="secondary" title="Use my spot" onPress={() => setPoint('helipad')} />
        </View>
        <TextField label="Radio channel" value={em.radioChannel ?? ''} onChangeText={(t) => setEm((e) => ({ ...e, radioChannel: t }))} placeholder="e.g. RR 7 / 154.100" />
        <TextField label="Evacuation route" value={em.evacRoute ?? ''} onChangeText={(t) => setEm((e) => ({ ...e, evacRoute: t }))} placeholder="e.g. FSR to km 12, left at the gate" multiline />
        <TextField label="Nearest hospital" value={em.nearestHospital ?? ''} onChangeText={(t) => setEm((e) => ({ ...e, nearestHospital: t }))} placeholder="Name, town, phone" multiline />
        <TextField label="Notes" value={em.notes ?? ''} onChangeText={(t) => setEm((e) => ({ ...e, notes: t }))} placeholder="First aid attendant, sat phone location…" multiline />
      </Section>

      <Button title={submitLabel} size="big" disabled={!name.trim()} busy={busy} onPress={submit} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    minHeight: touch.min,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    fontSize: font.large,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.bg,
  },
  species: { width: 90, textAlign: 'center' },
  price: { flex: 1 },
  dollar: { fontSize: font.large, fontWeight: '700', color: colors.text },
  remove: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius, borderWidth: 2, borderColor: colors.danger },
  removeText: { fontSize: font.large, color: colors.danger, fontWeight: '800' },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
