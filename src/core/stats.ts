/**
 * How the planting has been going: per-day trees and earnings for a planter or the whole crew.
 * Pure.
 *
 * A day's count is the crew boss's tally when there is one for that planter, block and day (the
 * number that gets paid), otherwise the planter's own bag-ups.
 */
import { activeEntries } from './tally';
import { earningsFor } from './tally/reconcile';
import type { BagUpEntry, Block, DayString, ID, LogEntry, SpeciesCount, TallyEntry } from './types';

export interface DayTrees {
  day: DayString;
  trees: number;
  cents: number;
  /** 'tally' when every block that day had a tally; 'bagup' when any came from bag-ups only. */
  source: 'tally' | 'bagup';
}

export interface PlanterStats {
  /** Days with trees, oldest first. */
  days: DayTrees[];
  totalTrees: number;
  totalCents: number;
  averagePerDay: number;
  best: DayTrees | null;
  today: DayTrees | null;
  species: SpeciesCount[];
  blocks: number;
}

type Counted = BagUpEntry | TallyEntry;

function add(map: Map<string, number>, trees: SpeciesCount[]) {
  for (const t of trees) if (Number.isFinite(t.count)) map.set(t.species, (map.get(t.species) ?? 0) + t.count);
}

/** Per planter, per block and day: the counted species. */
function counted(log: LogEntry[]): Map<ID, Map<string, { block: ID; day: DayString; source: 'tally' | 'bagup'; trees: Map<string, number> }>> {
  const active = activeEntries(log).filter((e): e is Counted => e.type === 'tally' || e.type === 'bagup');
  const byPlanter = new Map<ID, Map<string, { block: ID; day: DayString; source: 'tally' | 'bagup'; trees: Map<string, number> }>>();
  // Tallies first: a block-day with a tally ignores that day's bag-ups.
  for (const type of ['tally', 'bagup'] as const) {
    for (const e of active) {
      if (e.type !== type) continue;
      const days = byPlanter.get(e.planterId) ?? new Map();
      byPlanter.set(e.planterId, days);
      const key = `${e.blockId}|${e.day}`;
      const cur = days.get(key);
      if (cur && cur.source !== type) continue;
      const row = cur ?? { block: e.blockId, day: e.day, source: type, trees: new Map<string, number>() };
      add(row.trees, e.trees);
      days.set(key, row);
    }
  }
  return byPlanter;
}

const toList = (m: Map<string, number>): SpeciesCount[] =>
  [...m.entries()].filter(([, n]) => n !== 0).map(([species, count]) => ({ species, count })).sort((a, b) => b.count - a.count);

function statsFrom(rows: { block: ID; day: DayString; source: 'tally' | 'bagup'; trees: Map<string, number> }[], blocks: Map<ID, Block>, today: DayString): PlanterStats {
  const byDay = new Map<DayString, DayTrees>();
  const species = new Map<string, number>();
  const blockIds = new Set<ID>();
  for (const r of rows) {
    const list = toList(r.trees);
    const trees = list.reduce((s, t) => s + t.count, 0);
    if (trees === 0) continue;
    blockIds.add(r.block);
    add(species, list);
    const b = blocks.get(r.block);
    const cents = b ? earningsFor(list, b.pricesCents).cents : 0;
    const d = byDay.get(r.day) ?? { day: r.day, trees: 0, cents: 0, source: 'tally' as const };
    d.trees += trees;
    d.cents += cents;
    if (r.source === 'bagup') d.source = 'bagup';
    byDay.set(r.day, d);
  }
  const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const totalTrees = days.reduce((s, d) => s + d.trees, 0);
  const best = days.reduce<DayTrees | null>((m, d) => (!m || d.trees > m.trees ? d : m), null);
  return {
    days,
    totalTrees,
    totalCents: days.reduce((s, d) => s + d.cents, 0),
    averagePerDay: days.length ? Math.round(totalTrees / days.length) : 0,
    best,
    today: byDay.get(today) ?? null,
    species: toList(species),
    blocks: blockIds.size,
  };
}

/** One planter's season across every block on this phone. */
export function planterStats(log: LogEntry[], planterId: ID, blocks: Map<ID, Block>, today: DayString): PlanterStats {
  return statsFrom([...(counted(log).get(planterId)?.values() ?? [])], blocks, today);
}

export interface CrewStats {
  crew: PlanterStats;
  planters: { planterId: ID; stats: PlanterStats }[];
}

/** Every planter in the log, busiest season first, plus the crew as a whole. */
export function crewStats(log: LogEntry[], blocks: Map<ID, Block>, today: DayString): CrewStats {
  const all = counted(log);
  const planters = [...all.entries()]
    .map(([planterId, rows]) => ({ planterId, stats: statsFrom([...rows.values()], blocks, today) }))
    .filter((p) => p.stats.totalTrees > 0)
    .sort((a, b) => b.stats.totalTrees - a.stats.totalTrees);
  return { crew: statsFrom([...all.values()].flatMap((m) => [...m.values()]), blocks, today), planters };
}

/** The last `n` calendar days ending `today`, with 0 for days off (for a bar chart). */
export function lastDays(stats: PlanterStats, today: DayString, n: number): DayTrees[] {
  const byDay = new Map(stats.days.map((d) => [d.day, d]));
  const out: DayTrees[] = [];
  const end = new Date(`${today}T12:00:00Z`);
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(end.getTime() - k * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(d) ?? { day: d, trees: 0, cents: 0, source: 'tally' });
  }
  return out;
}
