import { crewStats, lastDays, planterStats } from './stats';
import type { Block, LogEntry } from './types';

const block = (id: string, prices: Record<string, number>): Block => ({ id, name: id, pricesCents: prices, emergency: {}, layers: [], createdAt: '' });
const BLOCKS = new Map([['A', block('A', { SW: 20 })], ['B', block('B', { PL: 15 })]]);
let n = 0;
const base = (blockId: string, day: string) => ({ id: `e${n++}`, blockId, day, createdAt: `${day}T10:00:00Z`, deviceId: 'd', author: 'x' });
const bagup = (p: string, blockId: string, day: string, sp: string, count: number): LogEntry => ({ ...base(blockId, day), type: 'bagup', planterId: p, cacheId: 'c', trees: [{ species: sp, count }] });
const tally = (p: string, blockId: string, day: string, sp: string, count: number): LogEntry => ({ ...base(blockId, day), type: 'tally', planterId: p, pieceId: 'pc', trees: [{ species: sp, count }] });

const LOG: LogEntry[] = [
  bagup('ana', 'A', '2026-05-10', 'SW', 1000),
  bagup('ana', 'A', '2026-05-10', 'SW', 800),
  tally('ana', 'A', '2026-05-10', 'SW', 1750), // the tally wins over that day's bag-ups
  bagup('ana', 'A', '2026-05-11', 'SW', 2000),
  bagup('ana', 'B', '2026-05-11', 'PL', 400),
  bagup('ben', 'A', '2026-05-11', 'SW', 1500),
];

test('a planter: tallies win, bag-ups otherwise; earnings per block price', () => {
  const s = planterStats(LOG, 'ana', BLOCKS, '2026-05-11');
  expect(s.days).toEqual([
    { day: '2026-05-10', trees: 1750, cents: 35000, source: 'tally' },
    { day: '2026-05-11', trees: 2400, cents: 46000, source: 'bagup' },
  ]);
  expect(s.totalTrees).toBe(4150);
  expect(s.totalCents).toBe(81000);
  expect(s.averagePerDay).toBe(2075);
  expect(s.best?.day).toBe('2026-05-11');
  expect(s.today?.trees).toBe(2400);
  expect(s.species).toEqual([{ species: 'SW', count: 3750 }, { species: 'PL', count: 400 }]);
  expect(s.blocks).toBe(2);
});

test('a voided bag-up does not count; a planter with nothing has empty stats', () => {
  const log: LogEntry[] = [...LOG, { ...base('A', '2026-05-11'), type: 'void', targetId: LOG[3].id, reason: 'typo' }];
  expect(planterStats(log, 'ana', BLOCKS, '2026-05-11').today?.trees).toBe(400);
  expect(planterStats(LOG, 'nobody', BLOCKS, '2026-05-11')).toMatchObject({ totalTrees: 0, best: null, today: null, averagePerDay: 0 });
});

test('the crew, busiest first', () => {
  const c = crewStats(LOG, BLOCKS, '2026-05-11');
  expect(c.planters.map((p) => [p.planterId, p.stats.totalTrees])).toEqual([['ana', 4150], ['ben', 1500]]);
  expect(c.crew.totalTrees).toBe(5650);
  expect(c.crew.today?.trees).toBe(3900);
});

test('lastDays fills days off with zero', () => {
  const s = planterStats(LOG, 'ana', BLOCKS, '2026-05-12');
  expect(lastDays(s, '2026-05-12', 4).map((d) => [d.day, d.trees])).toEqual([
    ['2026-05-09', 0], ['2026-05-10', 1750], ['2026-05-11', 2400], ['2026-05-12', 0],
  ]);
});
