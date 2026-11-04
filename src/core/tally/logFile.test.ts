import { makeLogFile, parseLogFile, serializeLogFile, LogFileError } from './logFile';
import { makeEntry } from './log';
import { MemoryStore } from '../../db/memoryStore';

const ctx = { blockId: 'b1', day: '2026-05-10', deviceId: 'planter-phone', author: 'Jess' };

describe('log file', () => {
  const bag = makeEntry('bagup', { planterId: 'p1', cacheId: 'c1', trees: [{ species: 'Sx', count: 300 }] }, ctx);
  const other = makeEntry('bagup', { planterId: 'p1', cacheId: 'c1', trees: [{ species: 'Sx', count: 50 }] }, { ...ctx, blockId: 'b2' });

  test('round-trips and keeps only entries for the block', () => {
    const f = parseLogFile(serializeLogFile(makeLogFile('b1', 'planter-phone', 'Jess', [bag, other])));
    expect(f.entries).toHaveLength(1);
    expect(f.entries[0].id).toBe(bag.id);
  });

  test('rejects garbage, plans and damaged entries', () => {
    expect(() => parseLogFile('nope')).toThrow(LogFileError);
    expect(() => parseLogFile(JSON.stringify({ format: 'cachelog-plan' }))).toThrow(/isn't a Cachelog bag-up file/);
    const bad = makeLogFile('b1', 'd', 'Jess', [bag]);
    (bad.entries[0] as any).trees = [{ species: 'Sx', count: -5 }];
    expect(() => parseLogFile(serializeLogFile(bad))).toThrow(LogFileError);
  });

  test('importing the same file twice adds entries once', async () => {
    const store = new MemoryStore();
    const f = parseLogFile(serializeLogFile(makeLogFile('b1', 'd', 'Jess', [bag])));
    await store.appendLog(f.entries);
    await store.appendLog(f.entries);
    expect(await store.listLog('b1')).toHaveLength(1);
  });
});
