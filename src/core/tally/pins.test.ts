import { makeEntry, voidEntry } from './log';
import { makeLogFile, parseLogFile, serializeLogFile } from './logFile';
import { openPins, pinEntriesForSharing, pinStates, pinToHazard } from './pins';
import type { LogEntry } from '../types';

const ctx = { blockId: 'b1', day: '2026-05-10', deviceId: 'jess-phone', author: 'Jess' };
const boss = { ...ctx, deviceId: 'boss-phone', author: 'Max' };

describe('pins', () => {
  const wasps = makeEntry('pin', { kind: 'hazard', position: [-122.5, 54], note: 'wasps by the stump' }, ctx);
  const low = makeEntry('pin', { kind: 'cache-low', position: [-122.49, 54.001], cacheId: 'c1' }, ctx);
  const bag = makeEntry('bagup', { planterId: 'p1', cacheId: 'c1', trees: [{ species: 'Sx', count: 300 }] }, ctx);

  test('open pins exclude resolved and voided ones', () => {
    const resolved = makeEntry('pin-resolved', { pinId: low.id, note: 'dropped 10 boxes' }, boss);
    const log: LogEntry[] = [wasps, low, bag, resolved];
    expect(openPins(log, 'b1').map((p) => p.id)).toEqual([wasps.id]);
    expect(pinStates(log).find((s) => s.pin.id === low.id)?.resolved?.note).toBe('dropped 10 boxes');
    expect(openPins([...log, voidEntry(wasps, 'mistake', ctx)])).toEqual([]);
    // Un-resolving = voiding the resolution.
    expect(openPins([...log, voidEntry(resolved, 'still low', boss)]).map((p) => p.id).sort()).toEqual([wasps.id, low.id].sort());
  });

  test('sharing set carries pins, resolutions and their voids but not tallies', () => {
    const resolved = makeEntry('pin-resolved', { pinId: low.id }, boss);
    const v = voidEntry(wasps, 'mistake', ctx);
    const shared = pinEntriesForSharing([wasps, low, bag, resolved, v, voidEntry(bag, 'typo', ctx)], 'b1');
    expect(shared.map((e) => e.id).sort()).toEqual([wasps.id, low.id, resolved.id, v.id].sort());
  });

  test('pins travel in the crew update file', () => {
    const f = parseLogFile(serializeLogFile(makeLogFile('b1', 'jess-phone', 'Jess', [wasps, bag])));
    expect(f.entries.map((e) => e.type)).toEqual(['pin', 'bagup']);
    const bad = makeLogFile('b1', 'd', 'Jess', [wasps]);
    (bad.entries[0] as any).position = [500, 0];
    expect(() => parseLogFile(serializeLogFile(bad))).toThrow();
  });

  test('a pin becomes a point hazard', () => {
    const h = pinToHazard(wasps, () => 'h9');
    expect(h).toEqual({ id: 'h9', kind: 'point', geometry: [[-122.5, 54]], note: 'wasps by the stump' });
    expect(pinToHazard(low, () => 'h10').note).toBe('Cache low');
  });
});
