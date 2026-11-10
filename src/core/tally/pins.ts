import type { Hazard, ID, LogEntry, PinEntry, PinKind, PinResolvedEntry } from '../types';
import { activeEntries } from './log';

export const PIN_KINDS: { kind: PinKind; label: string; hint: string }[] = [
  { kind: 'hazard', label: 'Hazard', hint: 'Wasps, cliff, bear sign, danger tree' },
  { kind: 'cache-low', label: 'Cache low', hint: 'Running out of trees here' },
  { kind: 'need-trees', label: 'Need trees', hint: 'Bring trees to this spot' },
  { kind: 'unplantable', label: "Can't plant", hint: 'Slash, rock, water, already planted' },
  { kind: 'access', label: 'Access', hint: 'Trail, crossing, quad track' },
  { kind: 'done', label: 'Done here', hint: 'This area is finished' },
  { kind: 'question', label: 'Question', hint: 'Need the crew boss to look' },
  { kind: 'note', label: 'Note', hint: 'Anything else' },
];

export function pinLabel(kind: PinKind): string {
  return PIN_KINDS.find((k) => k.kind === kind)?.label ?? 'Pin';
}

export interface PinState {
  pin: PinEntry;
  resolved: PinResolvedEntry | null;
}

/** Every pin that hasn't been voided, newest first, with its resolution if it has one. */
export function pinStates(log: LogEntry[], blockId?: ID): PinState[] {
  const active = activeEntries(log).filter((e) => !blockId || e.blockId === blockId);
  const resolved = new Map<ID, PinResolvedEntry>();
  for (const e of active) if (e.type === 'pin-resolved' && !resolved.has(e.pinId)) resolved.set(e.pinId, e);
  return active
    .filter((e): e is PinEntry => e.type === 'pin')
    .map((pin) => ({ pin, resolved: resolved.get(pin.id) ?? null }))
    .sort((a, b) => (a.pin.createdAt < b.pin.createdAt ? 1 : a.pin.createdAt > b.pin.createdAt ? -1 : 0));
}

export function openPins(log: LogEntry[], blockId?: ID): PinEntry[] {
  return pinStates(log, blockId)
    .filter((s) => !s.resolved)
    .map((s) => s.pin);
}

/**
 * The entries to send along with a plan so everyone sees the same pins: pins, their resolutions,
 * and any voids of those. Raw (not filtered to active), so a resolution or void made on one phone
 * also takes effect on phones that already had the pin.
 */
export function pinEntriesForSharing(log: LogEntry[], blockId: ID): LogEntry[] {
  const inBlock = log.filter((e) => e.blockId === blockId);
  const pinIds = new Set(inBlock.filter((e) => e.type === 'pin' || e.type === 'pin-resolved').map((e) => e.id));
  return inBlock.filter((e) => pinIds.has(e.id) || (e.type === 'void' && pinIds.has(e.targetId)));
}

/** Turn a pin into a plan hazard (the crew boss "accepts" it into the plan). Keeps the pin's id for traceability. */
export function pinToHazard(pin: PinEntry, newId: () => ID): Hazard {
  const label = pinLabel(pin.kind);
  return { id: newId(), kind: 'point', geometry: [pin.position], note: pin.note?.trim() ? pin.note.trim() : label };
}
