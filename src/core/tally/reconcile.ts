import type {
  BagUpEntry,
  Block,
  DayString,
  ID,
  LogEntry,
  PieceStatus,
  PieceStatusEntry,
  PlanContent,
  SpeciesCount,
  TallyEntry,
} from '../types';
import { formatCount } from './format';
import { activeEntries, chronological, entriesForDay } from './log';
import { addCounts, CountMap, polygonAreaHa, sumCounts, toCounts } from './util';

/**
 * Tolerance for "tallied vs bagged" per planter. A difference is flagged when it is
 * more than 2% of the bagged total OR more than 50 trees (whichever trips first),
 * i.e. the allowed slack is min(2% of bagged, 50). Small slack absorbs miscounted
 * bundles and a few culls; anything bigger is a real conversation with the planter.
 */
export const TALLY_TOLERANCE = { fraction: 0.02, trees: 50 } as const;

export function withinTolerance(diff: number, base: number): boolean {
  const d = Math.abs(diff);
  return d <= TALLY_TOLERANCE.trees && d <= TALLY_TOLERANCE.fraction * Math.abs(base);
}

// ---------------------------------------------------------------- caches

export interface CacheBalance {
  cacheId: ID;
  name: string;
  planned: SpeciesCount[];
  dropped: SpeciesCount[];
  bagged: SpeciesCount[];
  remaining: SpeciesCount[];
  flags: string[];
}

/**
 * Cache balances for plan.day.
 *
 * - dropped / bagged are cumulative over all days up to and including plan.day, so trees left
 *   in a cache overnight carry over (caches keep their id from one day's plan to the next).
 * - On plan.day, a planter who logged no bag-ups at all is counted from their tallies instead,
 *   charged to the cache of the assignment for the tallied piece (or their first assignment
 *   with a cache). This keeps balances useful for crews that only enter end-of-day tallies.
 *   Earlier days use bag-ups only (the earlier plans' assignments aren't available here).
 * - remaining = dropped - bagged, never below 0 (the flag explains any overdraw).
 * - Caches that appear in the log but not in the plan (deleted mid-day) are listed after the
 *   plan's caches as "Removed cache".
 */
export function cacheBalances(plan: PlanContent, log: LogEntry[]): CacheBalance[] {
  const active = activeEntries(log).filter((e) => e.blockId === plan.blockId && e.day <= plan.day);

  const dropped = new Map<ID, CountMap>();
  const bagged = new Map<ID, CountMap>();
  const get = (m: Map<ID, CountMap>, id: ID) => {
    let c = m.get(id);
    if (!c) m.set(id, (c = new Map()));
    return c;
  };

  const plannersWithBagupsToday = new Set<ID>();
  for (const e of active) {
    if (e.type === 'bagup' && e.day === plan.day) plannersWithBagupsToday.add(e.planterId);
  }

  for (const e of active) {
    if (e.type === 'cache-drop') addCounts(get(dropped, e.cacheId), e.trees);
    else if (e.type === 'bagup') addCounts(get(bagged, e.cacheId), e.trees);
    else if (e.type === 'tally' && e.day === plan.day && !plannersWithBagupsToday.has(e.planterId)) {
      const cacheId = cacheForTally(plan, e);
      if (cacheId) addCounts(get(bagged, cacheId), e.trees);
    }
  }

  const ids: ID[] = plan.caches.map((c) => c.id);
  for (const id of [...dropped.keys(), ...bagged.keys()]) if (!ids.includes(id)) ids.push(id);

  return ids.map((cacheId) => {
    const cache = plan.caches.find((c) => c.id === cacheId);
    const plannedMap = addCounts(new Map(), cache?.trees ?? []);
    const droppedMap = dropped.get(cacheId) ?? new Map();
    const baggedMap = bagged.get(cacheId) ?? new Map();

    const species = new Set<string>([...plannedMap.keys(), ...droppedMap.keys(), ...baggedMap.keys()]);
    const remainingMap: CountMap = new Map();
    const flags: string[] = [];

    const droppedTotal = sumCounts(toCounts(droppedMap));
    if (droppedTotal === 0 && sumCounts(toCounts(plannedMap)) > 0) flags.push('Nothing dropped yet');

    for (const sp of [...species].sort()) {
      const d = droppedMap.get(sp) ?? 0;
      const b = baggedMap.get(sp) ?? 0;
      if (d > 0 || b > 0 || (plannedMap.get(sp) ?? 0) > 0) remainingMap.set(sp, Math.max(0, d - b));
      if (b > d) flags.push(`Bagged more ${sp} than dropped (+${formatCount(b - d)})`);
    }
    if (!cache) flags.push('Cache is not in the plan');

    return {
      cacheId,
      name: cache?.name ?? 'Removed cache',
      planned: toCounts(plannedMap),
      dropped: toCounts(droppedMap),
      bagged: toCounts(baggedMap),
      remaining: toCounts(remainingMap, true),
      flags,
    };
  });
}

function cacheForTally(plan: PlanContent, t: TallyEntry): ID | undefined {
  const mine = plan.assignments.filter((a) => a.planterId === t.planterId);
  return mine.find((a) => a.pieceId === t.pieceId && a.cacheId)?.cacheId ?? mine.find((a) => a.cacheId)?.cacheId;
}

// ---------------------------------------------------------------- planters

export interface PlanterDay {
  planterId: ID;
  name: string;
  bagged: SpeciesCount[];
  tallied: SpeciesCount[];
  totalTallied: number;
  earningsCents: number;
  flags: string[];
}

/** Earnings in cents for a list of tallied counts; returns the species that have no price. */
export function earningsFor(trees: SpeciesCount[], pricesCents: Block['pricesCents']): { cents: number; unpriced: string[] } {
  let cents = 0;
  const unpriced: string[] = [];
  for (const t of trees) {
    const p = pricesCents[t.species];
    if (typeof p !== 'number' || !Number.isFinite(p)) {
      if (t.count !== 0 && !unpriced.includes(t.species)) unpriced.push(t.species);
      continue;
    }
    cents += p * t.count;
  }
  return { cents: Math.round(cents), unpriced };
}

/**
 * One row per planter in the plan (plan order), plus any planter id that appears in the day's
 * log but not in the plan ("Unknown planter"). Only plan.day entries count.
 *
 * Flags:
 *  - "Tallied 200 more than bagged" / "Tallied 200 fewer than bagged" — only when the planter
 *    logged bag-ups that day (no bag-ups = crew isn't using bag-up logging, nothing to compare).
 *    Tolerance: see TALLY_TOLERANCE.
 *  - "Species mix differs from bag-ups (Pl +300)" — totals agree but species don't.
 *  - "Tallied on Piece 6, not assigned" / "Tallied on a piece not in the plan".
 *  - "No tally yet" — assigned to a piece but no tally for the day.
 *  - "No price for Fd" — earnings exclude those trees.
 */
export function planterDays(plan: PlanContent, block: Block, log: LogEntry[]): PlanterDay[] {
  const day = entriesForDay(log, plan.blockId, plan.day);

  const ids: ID[] = plan.planters.map((p) => p.id);
  for (const e of day) {
    if ((e.type === 'bagup' || e.type === 'tally') && !ids.includes(e.planterId)) ids.push(e.planterId);
  }

  return ids.map((planterId) => {
    const planter = plan.planters.find((p) => p.id === planterId);
    const bagups = day.filter((e): e is BagUpEntry => e.type === 'bagup' && e.planterId === planterId);
    const tallies = day.filter((e): e is TallyEntry => e.type === 'tally' && e.planterId === planterId);

    const baggedMap: CountMap = new Map();
    for (const b of bagups) addCounts(baggedMap, b.trees);
    const talliedMap: CountMap = new Map();
    for (const t of tallies) addCounts(talliedMap, t.trees);
    const bagged = toCounts(baggedMap);
    const tallied = toCounts(talliedMap);
    const totalBagged = sumCounts(bagged);
    const totalTallied = sumCounts(tallied);

    const flags: string[] = [];
    if (!planter) flags.push('Not in the plan');

    // tallied vs bagged
    if (bagups.length > 0) {
      const diff = totalTallied - totalBagged;
      if (!withinTolerance(diff, totalBagged)) {
        flags.push(`Tallied ${formatCount(Math.abs(diff))} ${diff > 0 ? 'more' : 'fewer'} than bagged`);
      } else {
        const parts: string[] = [];
        const species = new Set([...baggedMap.keys(), ...talliedMap.keys()]);
        for (const sp of [...species].sort()) {
          const b = baggedMap.get(sp) ?? 0;
          const d = (talliedMap.get(sp) ?? 0) - b;
          if (!withinTolerance(d, b)) parts.push(`${sp} ${d > 0 ? '+' : '-'}${formatCount(Math.abs(d))}`);
        }
        if (parts.length) flags.push(`Species mix differs from bag-ups (${parts.join(', ')})`);
      }
    }

    // pieces
    const assigned = new Set(plan.assignments.filter((a) => a.planterId === planterId).map((a) => a.pieceId));
    const flaggedPieces = new Set<ID>();
    for (const t of tallies) {
      if (assigned.has(t.pieceId) || flaggedPieces.has(t.pieceId)) continue;
      flaggedPieces.add(t.pieceId);
      const piece = plan.pieces.find((p) => p.id === t.pieceId);
      flags.push(piece ? `Tallied on ${piece.name}, not assigned` : 'Tallied on a piece not in the plan');
    }
    if (assigned.size > 0 && tallies.length === 0) flags.push('No tally yet');

    // pay
    const { cents, unpriced } = earningsFor(tallied, block.pricesCents);
    for (const sp of unpriced) flags.push(`No price for ${sp}`);

    return {
      planterId,
      name: planter?.name ?? 'Unknown planter',
      bagged,
      tallied,
      totalTallied,
      earningsCents: cents,
      flags,
    };
  });
}

// ---------------------------------------------------------------- pieces

/**
 * Status per piece in the plan. Uses status entries from all days up to plan.day (a piece
 * finished yesterday stays complete); the latest by (day, createdAt) wins.
 * With no status entry, a piece that has tallies on or before plan.day is 'in-progress';
 * otherwise 'not-started'.
 */
export function pieceStatuses(plan: PlanContent, log: LogEntry[]): Record<ID, PieceStatus> {
  const active = activeEntries(log).filter((e) => e.blockId === plan.blockId && e.day <= plan.day);
  const statusEntries = chronological(active.filter((e): e is PieceStatusEntry => e.type === 'piece-status'));
  const latest = new Map<ID, PieceStatus>();
  for (const s of statusEntries) latest.set(s.pieceId, s.status);
  const tallied = new Set(active.filter((e): e is TallyEntry => e.type === 'tally').map((t) => t.pieceId));

  const out: Record<ID, PieceStatus> = {};
  for (const p of plan.pieces) {
    out[p.id] = latest.get(p.id) ?? (tallied.has(p.id) ? 'in-progress' : 'not-started');
  }
  return out;
}

// ---------------------------------------------------------------- summary

export interface DaySummary {
  day: DayString;
  bySpecies: SpeciesCount[];
  total: number;
  planters: PlanterDay[];
  caches: CacheBalance[];
  pieces: { pieceId: ID; name: string; status: PieceStatus; tallied: number; areaHa: number }[];
  earningsCents: number;
}

export function daySummary(plan: PlanContent, block: Block, log: LogEntry[]): DaySummary {
  const day = entriesForDay(log, plan.blockId, plan.day);
  const tallies = day.filter((e): e is TallyEntry => e.type === 'tally');

  const bySpeciesMap: CountMap = new Map();
  const byPiece = new Map<ID, number>();
  for (const t of tallies) {
    addCounts(bySpeciesMap, t.trees);
    byPiece.set(t.pieceId, (byPiece.get(t.pieceId) ?? 0) + sumCounts(t.trees));
  }
  const bySpecies = toCounts(bySpeciesMap);
  const planters = planterDays(plan, block, log);
  const statuses = pieceStatuses(plan, log);

  return {
    day: plan.day,
    bySpecies,
    total: sumCounts(bySpecies),
    planters,
    caches: cacheBalances(plan, log),
    pieces: plan.pieces.map((p) => ({
      pieceId: p.id,
      name: p.name,
      status: statuses[p.id],
      tallied: byPiece.get(p.id) ?? 0,
      areaHa: polygonAreaHa(p.polygon),
    })),
    earningsCents: planters.reduce((s, p) => s + p.earningsCents, 0),
  };
}

/** All active tallies for a planter across every day/block in `log`. */
export function seasonTotal(log: LogEntry[], planterId: ID): number {
  let n = 0;
  for (const e of activeEntries(log)) if (e.type === 'tally' && e.planterId === planterId) n += sumCounts(e.trees);
  return n;
}
