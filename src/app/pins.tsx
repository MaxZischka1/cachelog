import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { bearingDeg, compass, distanceM, newId, today } from '../core/plan';
import { pinToHazard, type PinState } from '../core/tally';
import type { ID, LngLat, PinKind } from '../core/types';
import { BlockMap, useUserLocation, type MapMode } from '../map';
import { confirm, showError } from '../ui/alerts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { fmtDateTime, fmtDistance } from '../ui/format';
import { useLogWriter } from '../ui/hooks/useLogWriter';
import { usePlanDraft } from '../ui/hooks/usePlanDraft';
import { useSendUpdates } from '../ui/hooks/useSendUpdates';
import { Segmented } from '../ui/Pickers';
import { PinSheet, pinText, toMapPins, usePins } from '../ui/pins';
import { Screen } from '../ui/Screen';
import { EmptyState, Muted } from '../ui/Section';
import { useSettings } from '../ui/store';
import { colors, font, radius, spacing } from '../ui/theme';

type Tab = 'map' | 'list';

/**
 * Crew pins: the shared layer anyone can add to. Planters flag what they find (wasps, a cache
 * running low, ground that can't be planted); the crew boss sees it on the same map, deals with it,
 * and can turn a pin into a hazard in the plan.
 */
export default function PinsScreen() {
  const { blockId } = useLocalSearchParams<{ blockId: string }>();
  const { settings } = useSettings();
  const plan = usePlanDraft(blockId);
  const pins = usePins(blockId);
  const loc = useUserLocation();
  const { add, voidIt } = useLogWriter(blockId, today());
  const updates = useSendUpdates(blockId);

  const [tab, setTab] = useState<Tab>('map');
  const [placing, setPlacing] = useState(false);
  const [pending, setPending] = useState<{ position: LngLat; where: string } | null>(null);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const isBoss = settings?.role === 'crew-boss';
  const content = plan.latest?.content ?? plan.content;
  const selected: PinState | null = useMemo(() => pins.states.find((s) => s.pin.id === selectedId) ?? null, [pins.states, selectedId]);
  const mapPins = useMemo(() => toMapPins(pins.states, showResolved), [pins.states, showResolved]);
  const listed = showResolved ? pins.states : pins.open;

  const mode: MapMode = placing
    ? {
        kind: 'place-point',
        onPlace: (p) => {
          setPlacing(false);
          setPending({ position: p, where: 'At the spot you tapped' });
        },
      }
    : { kind: 'view' };

  const pinHere = () => {
    if (!loc.position) return;
    setPending({ position: loc.position, where: `At your location${loc.accuracyM ? ` (±${Math.round(loc.accuracyM)} m)` : ''}` });
  };

  const save = async (kind: PinKind, note: string | undefined) => {
    if (!pending) return;
    try {
      const e = await add('pin', { kind, position: pending.position, note });
      setPending(null);
      setSelectedId(e.id);
    } catch (err) {
      showError('Could not save the pin', err);
    }
  };

  const resolve = async (s: PinState, note?: string) => {
    try {
      await add('pin-resolved', { pinId: s.pin.id, note });
      setSelectedId(null);
    } catch (err) {
      showError('Could not update the pin', err);
    }
  };

  const reopen = async (s: PinState) => {
    if (!s.resolved) return;
    try {
      await voidIt(s.resolved, 'Reopened');
    } catch (err) {
      showError('Could not reopen the pin', err);
    }
  };

  const remove = async (s: PinState) => {
    if (!(await confirm('Delete this pin?', pinText(s.pin), 'Delete', true))) return;
    try {
      await voidIt(s.pin, 'Deleted');
      setSelectedId(null);
    } catch (err) {
      showError('Could not delete the pin', err);
    }
  };

  const addToPlan = async (s: PinState) => {
    try {
      await plan.edit((c) => ({ ...c, hazards: [...c.hazards, pinToHazard(s.pin, newId)] }));
      await add('pin-resolved', { pinId: s.pin.id, note: 'Added to the plan as a hazard' });
      setSelectedId(null);
    } catch (err) {
      showError('Could not add it to the plan', err);
    }
  };

  if (plan.loading || pins.loading) return <Screen>{null}</Screen>;
  if (!plan.block || !content) {
    return (
      <Screen>
        <EmptyState title="No plan on this phone" message="Pins are dropped on a block's map. Import or publish a plan first." />
      </Screen>
    );
  }

  const where = (p: LngLat) => (loc.position ? `${fmtDistance(distanceM(loc.position, p))} ${compass(bearingDeg(loc.position, p))} of you` : null);

  const pinCard = (s: PinState, expanded: boolean) => {
    const mine = s.pin.deviceId === settings?.deviceId;
    return (
      <Card key={s.pin.id} tone={s.resolved ? 'normal' : s.pin.kind === 'hazard' ? 'warning' : 'ok'} onPress={expanded ? undefined : () => { setSelectedId(s.pin.id); setTab('map'); }}>
        <Text style={styles.pinTitle}>{pinText(s.pin)}</Text>
        <Muted>
          {s.pin.author} · {fmtDateTime(s.pin.createdAt)}
          {where(s.pin.position) ? ` · ${where(s.pin.position)}` : ''}
        </Muted>
        {s.resolved ? (
          <Muted>
            Dealt with by {s.resolved.author}
            {s.resolved.note ? ` — ${s.resolved.note}` : ''}
          </Muted>
        ) : null}
        {expanded ? (
          <View style={styles.actions}>
            {!s.resolved ? <Button title="Dealt with" onPress={() => resolve(s)} /> : <Button title="Reopen" variant="secondary" onPress={() => reopen(s)} />}
            {isBoss && !s.resolved ? <Button title="Add to plan as hazard" variant="secondary" onPress={() => addToPlan(s)} /> : null}
            {mine ? <Button title="Delete pin" variant="ghost" onPress={() => remove(s)} /> : null}
            <Button title="Close" variant="ghost" onPress={() => setSelectedId(null)} />
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: `Crew pins${pins.open.length ? ` (${pins.open.length})` : ''}` }} />
      <View style={styles.tabs}>
        <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'map', label: 'Map' }, { value: 'list', label: `List (${listed.length})` }]} />
      </View>

      {tab === 'map' ? (
        <View style={styles.flex}>
          <BlockMap
            block={plan.block}
            plan={content}
            pins={mapPins}
            highlightIds={selectedId ? [selectedId] : undefined}
            mode={mode}
            showUserLocation
            onSelect={(sel) => setSelectedId(sel?.type === 'pin' ? sel.id : null)}
            style={styles.flex}
          />
          <View style={styles.panel}>
            {selected ? (
              pinCard(selected, true)
            ) : placing ? (
              <>
                <Text style={styles.hint}>Tap the map where the pin goes.</Text>
                <Button title="Cancel" variant="secondary" onPress={() => setPlacing(false)} />
              </>
            ) : (
              <View style={styles.row}>
                <Button style={styles.flex} size="big" title="Pin here" subtitle={loc.position ? 'My location' : 'Waiting for GPS…'} disabled={!loc.position} onPress={pinHere} />
                <Button style={styles.flex} size="big" variant="secondary" title="Pin on map" subtitle="Tap a spot" onPress={() => setPlacing(true)} />
              </View>
            )}
          </View>
        </View>
      ) : (
        <Screen
          footer={
            isBoss ? (
              <Muted>Pins go out to the whole crew with the next plan you share.</Muted>
            ) : (
              <Button title="Send my updates to crew boss" size="big" busy={updates.sending} onPress={updates.send} />
            )
          }
        >
          {listed.length === 0 ? <EmptyState title="No open pins" message="Drop a pin from the Map tab to flag something for the crew." /> : null}
          {listed.map((s) => pinCard(s, false))}
          <Button
            title={showResolved ? 'Hide dealt-with pins' : `Show dealt-with pins (${pins.states.length - pins.open.length})`}
            variant="ghost"
            onPress={() => setShowResolved((v) => !v)}
          />
        </Screen>
      )}

      <PinSheet visible={!!pending} where={pending?.where ?? ''} onSave={save} onClose={() => setPending(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: { padding: spacing.sm, backgroundColor: colors.bg },
  panel: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.xl,
    backgroundColor: colors.bg,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  pinTitle: { fontSize: font.large, fontWeight: '800', color: colors.text },
  hint: { fontSize: font.large, fontWeight: '700', color: colors.text },
});
