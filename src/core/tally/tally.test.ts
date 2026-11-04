import type { Block, LogEntry, PlanContent, SpeciesCount } from '../types';
import {
  activeEntries,
  cacheBalances,
  daySummary,
  formatCents,
  formatCount,
  makeEntry,
  payrollCsv,
  pieceStatuses,
  piecesCsv,
  planterDays,
  seasonTotal,
  talliesCsv,
  voidEntry,
} from './index';

const DAY = '2026-05-12';
const BLOCK = 'blk1';

// ~100 m squares near Prince George, BC
const square = (lng: number, lat: number, dLng = 0.0015, dLat = 0.0009): [number, number][] => [
  [lng, lat],
  [lng + dLng, lat],
  [lng + dLng, lat + dLat],
  [lng, lat + dLat],
];

const block: Block = {
  id: BLOCK,
  name: 'Willow 12',
  pricesCents: { Sx: 16, Pl: 14.5 },
  emergency: {},
  layers: [],
  createdAt: '2026-05-01T00:00:00.000Z',
};

function makePlan(over: Partial<PlanContent> = {}): PlanContent {
  return {
    blockId: BLOCK,
    day: DAY,
    planters: [
      { id: 'p1', name: 'Jess' },
      { id: 'p2', name: 'Sam' },
      { id: 'p3', name: 'Ana' },
    ],
    caches: [
      { id: 'c1', name: 'Cache 1', position: [-122.75, 53.9], trees: [{ species: 'Sx', count: 4000 }, { species: 'Pl', count: 2000 }] },
      { id: 'c2', name: 'Cache 2', position: [-122.74, 53.91], trees: [{ species: 'Sx', count: 3000 }] },
    ],
    pieces: [
      { id: 'pc4', name: 'Piece 4', polygon: square(-122.75, 53.9) },
      { id: 'pc6', name: 'Piece 6', polygon: square(-122.748, 53.9) },
      { id: 'pc7', name: 'Piece 7', polygon: square(-122.74, 53.91) },
    ],
    assignments: [
      { planterId: 'p1', pieceId: 'pc4', cacheId: 'c1' },
      { planterId: 'p2', pieceId: 'pc6', cacheId: 'c1' },
      { planterId: 'p3', pieceId: 'pc7', cacheId: 'c2' },
    ],
    hazards: [],
    ...over,
  };
}

let clock = Date.parse(`${DAY}T07:00:00.000Z`);
const ctx = (day = DAY) => ({ blockId: BLOCK, day, deviceId: 'dev-boss', author: 'Boss' });
/** makeEntry with strictly increasing createdAt so ordering is deterministic. */
function e<T extends LogEntry>(entry: T): T {
  clock += 60_000;
  return { ...entry, createdAt: new Date(clock).toISOString() };
}
const sx = (n: number): SpeciesCount[] => [{ species: 'Sx', count: n }];
const drop = (cacheId: string, trees: SpeciesCount[], day = DAY) => e(makeEntry('cache-drop', { cacheId, trees }, ctx(day)));
const bag = (planterId: string, cacheId: string, trees: SpeciesCount[], day = DAY) =>
  e(makeEntry('bagup', { planterId, cacheId, trees }, ctx(day)));
const tally = (planterId: string, pieceId: string, trees: SpeciesCount[], day = DAY) =>
  e(makeEntry('tally', { planterId, pieceId, trees }, ctx(day)));
const status = (pieceId: string, s: 'not-started' | 'in-progress' | 'complete', day = DAY) =>
  e(makeEntry('piece-status', { pieceId, status: s }, ctx(day)));

// ------------------------------------------------------------------------------------------

describe('log basics', () => {
  test('makeEntry fills base fields', () => {
    const t = makeEntry('tally', { planterId: 'p1', pieceId: 'pc4', trees: sx(10) }, ctx());
    expect(t).toMatchObject({ type: 'tally', blockId: BLOCK, day: DAY, deviceId: 'dev-boss', author: 'Boss', planterId: 'p1' });
    expect(t.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(new Date(t.createdAt).toISOString()).toBe(t.createdAt);
    const t2 = makeEntry('tally', { planterId: 'p1', pieceId: 'pc4', trees: sx(10) }, ctx());
    expect(t2.id).not.toBe(t.id);
  });

  test('voidEntry targets the entry on its block/day', () => {
    const t = tally('p1', 'pc4', sx(10), '2026-05-10');
    const v = voidEntry(t, 'double entry', { deviceId: 'd2', author: 'Jess' });
    expect(v).toMatchObject({ type: 'void', targetId: t.id, blockId: BLOCK, day: '2026-05-10', reason: 'double entry', author: 'Jess' });
  });

  test('activeEntries drops voided entries and voids; a voided void restores its target', () => {
    const a = tally('p1', 'pc4', sx(10));
    const b = tally('p1', 'pc4', sx(20));
    const va = voidEntry(a, 'wrong', { deviceId: 'd', author: 'x' });
    const vb = voidEntry(b, 'oops', { deviceId: 'd', author: 'x' });
    const undo = voidEntry(vb, 'b was right', { deviceId: 'd', author: 'x' });
    const orphan = voidEntry({ ...a, id: 'missing' }, 'n/a', { deviceId: 'd', author: 'x' });
    expect(activeEntries([a, b, va, vb, undo, orphan]).map((x) => x.id)).toEqual([b.id]);
  });
});

describe('realistic day: 3 planters, 2 caches', () => {
  const plan = makePlan();
  const log: LogEntry[] = [];
  // morning: heli drops
  log.push(drop('c1', [{ species: 'Sx', count: 4000 }, { species: 'Pl', count: 2000 }]));
  log.push(drop('c2', sx(3000)));
  // Jess bags from cache 1 three times
  log.push(bag('p1', 'c1', sx(800)), bag('p1', 'c1', [{ species: 'Pl', count: 400 }]), bag('p1', 'c1', sx(800)));
  // Sam bags, fat-fingers a 5000, crew boss voids it
  log.push(bag('p2', 'c1', sx(1000)));
  const mistake = bag('p2', 'c1', sx(5000));
  log.push(mistake, e(voidEntry(mistake, 'typo, meant 500', { deviceId: 'dev-sam', author: 'Sam' })));
  log.push(bag('p2', 'c1', sx(500)));
  // Ana doesn't log bag-ups; only her tally (charged to cache 2 via her assignment)
  // end of day tallies
  log.push(tally('p1', 'pc4', [{ species: 'Sx', count: 1600 }, { species: 'Pl', count: 400 }]));
  log.push(tally('p2', 'pc6', sx(1500)));
  log.push(tally('p3', 'pc7', sx(2500)));
  log.push(status('pc4', 'complete'));
  // a different day's entries must not leak into today's numbers (except carry-over rules)
  log.push(tally('p1', 'pc4', sx(999), '2026-05-13'));

  test('cache balances', () => {
    const [c1, c2] = cacheBalances(plan, log);
    expect(c1).toEqual({
      cacheId: 'c1',
      name: 'Cache 1',
      planned: [{ species: 'Pl', count: 2000 }, { species: 'Sx', count: 4000 }],
      dropped: [{ species: 'Pl', count: 2000 }, { species: 'Sx', count: 4000 }],
      bagged: [{ species: 'Pl', count: 400 }, { species: 'Sx', count: 3100 }],
      remaining: [{ species: 'Pl', count: 1600 }, { species: 'Sx', count: 900 }],
      flags: [],
    });
    expect(c2.bagged).toEqual(sx(2500));
    expect(c2.remaining).toEqual(sx(500));
    expect(c2.flags).toEqual([]);
  });

  test('planter days and earnings', () => {
    const days = planterDays(plan, block, log);
    expect(days.map((d) => [d.name, d.totalTallied, d.earningsCents, d.flags])).toEqual([
      ['Jess', 2000, 1600 * 16 + 400 * 14.5, []],
      ['Sam', 1500, 1500 * 16, []],
      ['Ana', 2500, 2500 * 16, []],
    ]);
    expect(days[1].bagged).toEqual(sx(1500));
  });

  test('piece statuses', () => {
    expect(pieceStatuses(plan, log)).toEqual({ pc4: 'complete', pc6: 'in-progress', pc7: 'in-progress' });
  });

  test('day summary', () => {
    const s = daySummary(plan, block, log);
    expect(s.day).toBe(DAY);
    expect(s.bySpecies).toEqual([{ species: 'Pl', count: 400 }, { species: 'Sx', count: 5600 }]);
    expect(s.total).toBe(6000);
    expect(s.earningsCents).toBe(31400 + 24000 + 40000);
    expect(s.caches).toHaveLength(2);
    expect(s.pieces.map((p) => [p.name, p.status, p.tallied])).toEqual([
      ['Piece 4', 'complete', 2000],
      ['Piece 6', 'in-progress', 1500],
      ['Piece 7', 'in-progress', 2500],
    ]);
    // ~0.0015 deg lng x 0.0009 deg lat at 53.9 N ≈ 98.4 m x 100.1 m ≈ 0.985 ha
    expect(s.pieces[0].areaHa).toBeGreaterThan(0.95);
    expect(s.pieces[0].areaHa).toBeLessThan(1.02);
  });

  test('season total spans days and respects voids', () => {
    expect(seasonTotal(log, 'p1')).toBe(2000 + 999);
    expect(seasonTotal(log, 'p3')).toBe(2500);
  });

  test('payroll and pieces CSV', () => {
    const s = daySummary(plan, block, log);
    expect(payrollCsv(s)).toBe(
      'day,planter,trees,earnings\r\n2026-05-12,Jess,2000,314.00\r\n2026-05-12,Sam,1500,240.00\r\n2026-05-12,Ana,2500,400.00\r\n',
    );
    expect(piecesCsv(s).split('\r\n')[0]).toBe('day,piece,status,trees,area_ha');
    expect(piecesCsv(s).split('\r\n')[1]).toMatch(/^2026-05-12,Piece 4,complete,2000,0\.9\d$/);
  });

  test('tallies CSV aggregates by day/planter/piece/species with names', () => {
    expect(talliesCsv(plan, log)).toBe(
      [
        'day,planter,piece,species,count',
        '2026-05-12,Ana,Piece 7,Sx,2500',
        '2026-05-12,Jess,Piece 4,Pl,400',
        '2026-05-12,Jess,Piece 4,Sx,1600',
        '2026-05-12,Sam,Piece 6,Sx,1500',
        '2026-05-13,Jess,Piece 4,Sx,999',
        '',
      ].join('\r\n'),
    );
  });
});

describe('flags', () => {
  test('nothing dropped at a planned cache', () => {
    const [, c2] = cacheBalances(makePlan(), [drop('c1', sx(100))]);
    expect(c2.flags).toEqual(['Nothing dropped yet']);
  });

  test('bagged more than dropped at a cache', () => {
    const log = [drop('c1', sx(1000)), bag('p1', 'c1', sx(800)), bag('p2', 'c1', sx(1350))];
    const [c1] = cacheBalances(makePlan(), log);
    expect(c1.flags).toEqual(['Bagged more Sx than dropped (+1,150)']);
    expect(c1.remaining).toEqual([{ species: 'Pl', count: 0 }, { species: 'Sx', count: 0 }]);
  });

  test('tally-only planters are charged to their assigned cache', () => {
    const [, c2] = cacheBalances(makePlan(), [drop('c2', sx(1000)), tally('p3', 'pc7', sx(1200))]);
    expect(c2.flags).toEqual(['Bagged more Sx than dropped (+200)']);
  });

  test('leftover trees carry over from earlier days', () => {
    const log = [drop('c1', sx(2000), '2026-05-11'), bag('p1', 'c1', sx(1500), '2026-05-11'), bag('p1', 'c1', sx(400))];
    const [c1] = cacheBalances(makePlan(), log);
    expect(c1.flags).toEqual([]);
    expect(c1.remaining.find((r) => r.species === 'Sx')?.count).toBe(100);
  });

  test('cache missing from the plan is still listed', () => {
    const balances = cacheBalances(makePlan(), [drop('c1', sx(10)), drop('c2', sx(10)), drop('c9', sx(500))]);
    expect(balances[2]).toMatchObject({ cacheId: 'c9', name: 'Removed cache', flags: ['Cache is not in the plan'] });
  });

  test('tallied more / fewer than bagged, with tolerance min(2%, 50)', () => {
    const plan = makePlan();
    const flagsFor = (bagged: number, tallied: number) =>
      planterDays(plan, block, [bag('p1', 'c1', sx(bagged)), tally('p1', 'pc4', sx(tallied))])[0].flags;
    expect(flagsFor(1000, 1020)).toEqual([]); // 2% exactly
    expect(flagsFor(1000, 1021)).toEqual(['Tallied 21 more than bagged']);
    expect(flagsFor(5000, 4950)).toEqual([]); // 50 exactly
    expect(flagsFor(5000, 4949)).toEqual(['Tallied 51 fewer than bagged']);
    expect(flagsFor(3000, 3200)).toEqual(['Tallied 200 more than bagged']);
  });

  test('species mix differs even when totals match', () => {
    const log = [bag('p1', 'c1', sx(1000)), tally('p1', 'pc4', [{ species: 'Sx', count: 700 }, { species: 'Pl', count: 300 }])];
    expect(planterDays(makePlan(), block, log)[0].flags).toEqual(['Species mix differs from bag-ups (Pl +300, Sx -300)']);
  });

  test('no bag-ups logged means no tallied-vs-bagged comparison', () => {
    const days = planterDays(makePlan(), block, [tally('p1', 'pc4', sx(1000))]);
    expect(days[0].flags).toEqual([]);
  });

  test('tally on an unassigned piece', () => {
    const log = [tally('p1', 'pc4', sx(500)), tally('p1', 'pc6', sx(300)), tally('p1', 'pc6', sx(10)), tally('p1', 'zzz', sx(5))];
    expect(planterDays(makePlan(), block, log)[0].flags).toEqual(['Tallied on Piece 6, not assigned', 'Tallied on a piece not in the plan']);
  });

  test('assigned planter with no tally, and unknown planter in the log', () => {
    const days = planterDays(makePlan(), block, [tally('p1', 'pc4', sx(1)), tally('p2', 'pc6', sx(1)), tally('pX', 'pc7', sx(40))]);
    expect(days[2].flags).toEqual(['No tally yet']);
    expect(days[3]).toMatchObject({ planterId: 'pX', name: 'Unknown planter', totalTallied: 40 });
    expect(days[3].flags).toContain('Not in the plan');
    expect(days[3].flags).toContain('Tallied on Piece 7, not assigned');
  });

  test('unpriced species', () => {
    const d = planterDays(makePlan(), block, [tally('p1', 'pc4', [{ species: 'Fd', count: 100 }, ...sx(100)])])[0];
    expect(d.earningsCents).toBe(1600);
    expect(d.flags).toEqual(['No price for Fd']);
  });
});

describe('formatting and CSV escaping', () => {
  test('formatCents / formatCount', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(-150)).toBe('-$1.50');
    expect(formatCents(100000000)).toBe('$1,000,000.00');
    expect(formatCents(1234.5)).toBe('$12.35');
    expect(formatCount(1200)).toBe('1,200');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(-1234567)).toBe('-1,234,567');
  });

  test('RFC 4180 quoting of commas, quotes and newlines', () => {
    const plan = makePlan({
      planters: [{ id: 'p1', name: 'O\'Brien, "Red"' }],
      pieces: [{ id: 'pc4', name: 'Piece 4\nnorth', polygon: square(-122.75, 53.9) }],
    });
    const csv = talliesCsv(plan, [tally('p1', 'pc4', sx(10))]);
    expect(csv).toBe('day,planter,piece,species,count\r\n2026-05-12,"O\'Brien, ""Red""","Piece 4\nnorth",Sx,10\r\n');

    const s = daySummary(plan, block, [tally('p1', 'pc4', sx(10))]);
    expect(payrollCsv(s)).toBe('day,planter,trees,earnings\r\n2026-05-12,"O\'Brien, ""Red""",10,1.60\r\n');
    expect(piecesCsv(s)).toContain('"Piece 4\nnorth"');
  });

  test('header-only CSV when there are no tallies', () => {
    expect(talliesCsv(makePlan(), [])).toBe('day,planter,piece,species,count\r\n');
  });
});
