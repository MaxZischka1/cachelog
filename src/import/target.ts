/**
 * Which block an imported map belongs to, so a map can be imported from anywhere in the app.
 * Pure (no Expo), runs under Jest.
 */
import type { Block, ID, MapLayer, PlanContent } from '../core/types';
import { blockBounds, type Bounds } from '../map/geo';

export type MapTarget =
  /** Put the map on this block. */
  | { kind: 'block'; blockId: ID; why: 'opening' | 'overlap' | 'current' }
  /** Nothing fits: make a new block for it. */
  | { kind: 'new' }
  /** Several blocks could fit: ask. `candidates` are block ids; a new block is always an option. */
  | { kind: 'ask'; candidates: ID[] };

export interface BlockFootprint {
  id: ID;
  /** Everything already on the block's map (layers, pieces, caches); null when it is empty. */
  bounds: Bounds | null;
  /** Opening (block) number: from the block's map sheet, or a long number in its name. */
  opening?: string;
}

/** A 6+ digit number in a block name ("Opening 5050853586", "5050853586 north"). */
function openingInName(name: string): string | undefined {
  return /\b\d{6,}\b/.exec(name)?.[0];
}

export function footprint(block: Block, plan: PlanContent | null): BlockFootprint {
  const fp: BlockFootprint = { id: block.id, bounds: blockBounds(block, plan) };
  const opening = block.sheet?.openingNumber ?? openingInName(block.name);
  if (opening) fp.opening = opening;
  return fp;
}

const sameOpening = (a: string, b: string) => a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();

/** Bounds of an imported layer; null when it has no valid coordinates. */
export function layerBounds(layer: MapLayer): Bounds | null {
  return blockBounds({ layers: [layer] } as unknown as Block, null);
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a[0][0] <= b[1][0] && b[0][0] <= a[1][0] && a[0][1] <= b[1][1] && b[0][1] <= a[1][1];
}

/**
 * 0. The sheet's opening number matches exactly one block: that block.
 * 1. The map covers exactly one block's footprint: that block. Several: the current block if it
 *    is one of them, else ask.
 * 2. The map covers none, and the current block (import started inside a block) is still empty:
 *    the current block.
 * 3. Otherwise a new block, unless some blocks are still empty, in which case ask
 *    (those blocks, or a new one).
 */
export function chooseMapBlock(map: Bounds | null, blocks: BlockFootprint[], currentBlockId?: ID, opening?: string): MapTarget {
  const current = blocks.find((b) => b.id === currentBlockId);
  if (opening) {
    const named = blocks.filter((b) => b.opening && sameOpening(b.opening, opening));
    if (named.length === 1) return { kind: 'block', blockId: named[0].id, why: 'opening' };
    if (named.length > 1) {
      if (current && named.includes(current)) return { kind: 'block', blockId: current.id, why: 'current' };
      return { kind: 'ask', candidates: named.map((b) => b.id) };
    }
  }
  if (map) {
    const hits = blocks.filter((b) => b.bounds && boundsOverlap(map, b.bounds)).map((b) => b.id);
    if (hits.length === 1) return { kind: 'block', blockId: hits[0], why: 'overlap' };
    if (hits.length > 1) {
      if (current && hits.includes(current.id)) return { kind: 'block', blockId: current.id, why: 'current' };
      return { kind: 'ask', candidates: hits };
    }
  }
  if (current && !current.bounds) return { kind: 'block', blockId: current.id, why: 'current' };
  const empty = blocks.filter((b) => !b.bounds).map((b) => b.id);
  return empty.length ? { kind: 'ask', candidates: empty } : { kind: 'new' };
}
