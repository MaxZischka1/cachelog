import type { Block, ID } from '../core/types';

export class DuplicateVersionError extends Error {
  constructor(blockId: ID, version: number) {
    super(`Version ${version} already exists for block ${blockId}`);
    this.name = 'DuplicateVersionError';
  }
}

/** Sort used by both stores for listBlocks: oldest first, then by name. */
export function compareBlocks(a: Block, b: Block): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
