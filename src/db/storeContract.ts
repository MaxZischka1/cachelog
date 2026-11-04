/**
 * Shared behaviour tests for any Store implementation. Call from a *.test.ts file:
 *
 *   runStoreContract('MemoryStore', async () => new MemoryStore());
 *
 * Uses Jest globals; not imported by app code.
 */
import type { Store } from '../core/store';
import type { Block, DeviceSettings, Draft, LogEntry, PlanContent, PlanVersion } from '../core/types';

const content = (blockId: string, day = '2026-05-12'): PlanContent => ({
  blockId,
  day,
  planters: [{ id: 'p1', name: 'Jess' }],
  caches: [{ id: 'c1', name: 'Cache 1', position: [-122.75, 53.9], trees: [{ species: 'Sx', count: 1200 }] }],
  pieces: [],
  assignments: [],
  hazards: [],
});

const block = (id: string, createdAt = '2026-05-01T00:00:00.000Z', name = `Block ${id}`): Block => ({
  id,
  name,
  pricesCents: { Sx: 16 },
  emergency: { nearestHospital: 'UHNBC' },
  layers: [],
  createdAt,
});

const version = (blockId: string, v: number, message?: string): PlanVersion => ({
  blockId,
  version: v,
  parentVersion: v > 1 ? v - 1 : null,
  publishedAt: `2026-05-12T0${v}:00:00.000Z`,
  author: 'Boss',
  message,
  content: content(blockId),
});

const entry = (id: string, blockId: string, day: string, createdAt: string, count = 100): LogEntry => ({
  type: 'tally',
  id,
  blockId,
  day,
  createdAt,
  deviceId: 'd1',
  author: 'Boss',
  planterId: 'p1',
  pieceId: 'pc1',
  trees: [{ species: 'Sx', count }],
});

export function runStoreContract(name: string, makeStore: () => Promise<Store>): void {
  describe(`Store contract: ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await makeStore();
    });

    describe('blocks', () => {
      test('save, get, list, update, delete', async () => {
        expect(await store.listBlocks()).toEqual([]);
        expect(await store.getBlock('b1')).toBeNull();
        await store.saveBlock(block('b2', '2026-05-02T00:00:00.000Z'));
        await store.saveBlock(block('b1', '2026-05-01T00:00:00.000Z'));
        expect((await store.listBlocks()).map((b) => b.id)).toEqual(['b1', 'b2']);
        expect(await store.getBlock('b1')).toEqual(block('b1'));

        await store.saveBlock({ ...block('b1'), name: 'Renamed' });
        expect((await store.getBlock('b1'))?.name).toBe('Renamed');
        expect(await store.listBlocks()).toHaveLength(2);

        await store.deleteBlock('b1');
        expect(await store.getBlock('b1')).toBeNull();
        expect((await store.listBlocks()).map((b) => b.id)).toEqual(['b2']);
      });

      test('deleteBlock removes its draft, versions and log, not other blocks', async () => {
        await store.saveBlock(block('b1'));
        await store.saveBlock(block('b2'));
        for (const id of ['b1', 'b2']) {
          await store.saveDraft({ blockId: id, baseVersion: null, content: content(id), updatedAt: 'x' });
          await store.addVersion(version(id, 1));
          await store.appendLog([entry(`e-${id}`, id, '2026-05-12', '2026-05-12T10:00:00.000Z')]);
        }
        await store.deleteBlock('b1');
        expect(await store.getDraft('b1')).toBeNull();
        expect(await store.listVersions('b1')).toEqual([]);
        expect(await store.listLog('b1')).toEqual([]);
        expect(await store.getDraft('b2')).not.toBeNull();
        expect(await store.listVersions('b2')).toHaveLength(1);
        expect(await store.listLog('b2')).toHaveLength(1);
        // the deleted block's log ids can be re-imported later
        await store.appendLog([entry('e-b1', 'b1', '2026-05-12', '2026-05-12T10:00:00.000Z')]);
        expect(await store.listLog('b1')).toHaveLength(1);
      });

      test('returned objects are copies; saved objects are copied', async () => {
        const b = block('b1');
        await store.saveBlock(b);
        b.name = 'mutated after save';
        b.pricesCents.Sx = 999;
        const got = (await store.getBlock('b1'))!;
        expect(got.name).toBe('Block b1');
        got.pricesCents.Sx = 1;
        (await store.listBlocks())[0].emergency.nearestHospital = 'nope';
        expect(await store.getBlock('b1')).toEqual(block('b1'));
      });
    });

    describe('drafts', () => {
      test('one per block; save overwrites; delete', async () => {
        expect(await store.getDraft('b1')).toBeNull();
        const d: Draft = { blockId: 'b1', baseVersion: null, content: content('b1'), updatedAt: '2026-05-12T01:00:00.000Z' };
        await store.saveDraft(d);
        await store.saveDraft({ ...d, baseVersion: 3, updatedAt: '2026-05-12T02:00:00.000Z' });
        expect(await store.getDraft('b1')).toEqual({ ...d, baseVersion: 3, updatedAt: '2026-05-12T02:00:00.000Z' });
        await store.deleteDraft('b1');
        expect(await store.getDraft('b1')).toBeNull();
        await store.deleteDraft('b1'); // no-op
      });

      test('draft content is copied', async () => {
        const d: Draft = { blockId: 'b1', baseVersion: null, content: content('b1'), updatedAt: 'x' };
        await store.saveDraft(d);
        d.content.caches[0].trees[0].count = 1;
        const got = (await store.getDraft('b1'))!;
        expect(got.content.caches[0].trees[0].count).toBe(1200);
        got.content.planters.push({ id: 'p2', name: 'Sam' });
        expect((await store.getDraft('b1'))!.content.planters).toHaveLength(1);
      });
    });

    describe('versions', () => {
      test('add, list ascending, get, latest', async () => {
        expect(await store.getLatestVersion('b1')).toBeNull();
        expect(await store.listVersions('b1')).toEqual([]);
        await store.addVersion(version('b1', 2));
        await store.addVersion(version('b1', 1, 'first'));
        await store.addVersion(version('b1', 10));
        await store.addVersion(version('b2', 7));
        expect((await store.listVersions('b1')).map((v) => v.version)).toEqual([1, 2, 10]);
        expect(await store.getVersion('b1', 1)).toEqual(version('b1', 1, 'first'));
        expect(await store.getVersion('b1', 3)).toBeNull();
        expect((await store.getLatestVersion('b1'))?.version).toBe(10);
        expect((await store.getLatestVersion('b2'))?.version).toBe(7);
      });

      test('rejects a duplicate version number and keeps the original', async () => {
        await store.addVersion(version('b1', 1, 'original'));
        await expect(store.addVersion(version('b1', 1, 'impostor'))).rejects.toThrow(/already exists/);
        expect((await store.getVersion('b1', 1))?.message).toBe('original');
        // same number on another block is fine
        await store.addVersion(version('b2', 1));
      });

      test('versions are copied', async () => {
        const v = version('b1', 1);
        await store.addVersion(v);
        v.content.caches = [];
        expect((await store.getVersion('b1', 1))!.content.caches).toHaveLength(1);
      });
    });

    describe('log', () => {
      test('ascending by createdAt regardless of insert order; filters by block and day', async () => {
        await store.appendLog([
          entry('c', 'b1', '2026-05-12', '2026-05-12T12:00:00.000Z'),
          entry('a', 'b1', '2026-05-11', '2026-05-11T09:00:00.000Z'),
          entry('x', 'b2', '2026-05-12', '2026-05-12T08:00:00.000Z'),
        ]);
        await store.appendLog([entry('b', 'b1', '2026-05-12', '2026-05-12T07:00:00.000Z')]);
        expect((await store.listLog('b1')).map((e) => e.id)).toEqual(['a', 'b', 'c']);
        expect((await store.listLog('b1', '2026-05-12')).map((e) => e.id)).toEqual(['b', 'c']);
        expect((await store.listLog('b2')).map((e) => e.id)).toEqual(['x']);
        expect(await store.listLog('b3')).toEqual([]);
      });

      test('equal createdAt keeps insertion order', async () => {
        const t = '2026-05-12T10:00:00.000Z';
        await store.appendLog([entry('z', 'b1', '2026-05-12', t), entry('m', 'b1', '2026-05-12', t)]);
        await store.appendLog([entry('a', 'b1', '2026-05-12', t)]);
        expect((await store.listLog('b1')).map((e) => e.id)).toEqual(['z', 'm', 'a']);
      });

      test('ignores entries whose id already exists (re-import is safe)', async () => {
        await store.appendLog([entry('e1', 'b1', '2026-05-12', '2026-05-12T10:00:00.000Z', 100)]);
        await store.appendLog([
          entry('e1', 'b1', '2026-05-12', '2026-05-12T10:00:00.000Z', 999),
          entry('e2', 'b1', '2026-05-12', '2026-05-12T11:00:00.000Z'),
          entry('e2', 'b1', '2026-05-12', '2026-05-12T11:00:00.000Z', 5),
        ]);
        const log = await store.listLog('b1');
        expect(log.map((e) => e.id)).toEqual(['e1', 'e2']);
        expect((log[0] as Extract<LogEntry, { type: 'tally' }>).trees[0].count).toBe(100);
        expect((log[1] as Extract<LogEntry, { type: 'tally' }>).trees[0].count).toBe(100);
        await store.appendLog([]);
      });

      test('round-trips every entry type unchanged and copied', async () => {
        const base = { blockId: 'b1', day: '2026-05-12', deviceId: 'd', author: 'a' };
        const entries: LogEntry[] = [
          { ...base, id: '1', createdAt: '2026-05-12T01:00:00.000Z', type: 'cache-drop', cacheId: 'c1', trees: [{ species: 'Sx', count: 4000 }] },
          { ...base, id: '2', createdAt: '2026-05-12T02:00:00.000Z', type: 'bagup', planterId: 'p1', cacheId: 'c1', trees: [{ species: 'Pl', count: 400 }] },
          { ...base, id: '3', createdAt: '2026-05-12T03:00:00.000Z', type: 'tally', planterId: 'p1', pieceId: 'pc1', trees: [] },
          { ...base, id: '4', createdAt: '2026-05-12T04:00:00.000Z', type: 'piece-status', pieceId: 'pc1', status: 'complete' },
          { ...base, id: '5', createdAt: '2026-05-12T05:00:00.000Z', type: 'void', targetId: '3', reason: 'Wrong piece, "oops", ✓' },
        ];
        await store.appendLog(entries);
        (entries[0] as Extract<LogEntry, { type: 'cache-drop' }>).trees[0].count = 1;
        const got = await store.listLog('b1');
        expect((got[0] as Extract<LogEntry, { type: 'cache-drop' }>).trees[0].count).toBe(4000);
        expect(got[4]).toEqual(entries[4]);
        expect(got.map((e) => e.type)).toEqual(['cache-drop', 'bagup', 'tally', 'piece-status', 'void']);
      });
    });

    describe('settings', () => {
      test('null until saved; save overwrites; copies', async () => {
        expect(await store.getSettings()).toBeNull();
        const s: DeviceSettings = { deviceId: 'dev1', userName: 'Max', role: 'crew-boss' };
        await store.saveSettings(s);
        s.userName = 'mutated';
        expect(await store.getSettings()).toEqual({ deviceId: 'dev1', userName: 'Max', role: 'crew-boss' });
        await store.saveSettings({ deviceId: 'dev1', userName: 'Jess', role: 'planter', planterId: 'p1', activeBlockId: 'b1' });
        expect(await store.getSettings()).toEqual({ deviceId: 'dev1', userName: 'Jess', role: 'planter', planterId: 'p1', activeBlockId: 'b1' });
      });
    });
  });
}
