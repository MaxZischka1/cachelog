import type { Block, DayString, DeviceSettings, Draft, ID, LogEntry, PlanVersion } from './types';

/**
 * Persistence contract. Implemented by:
 *  - src/db/sqliteStore.ts  (app, expo-sqlite)
 *  - src/db/memoryStore.ts  (tests)
 * All methods are async. Returned objects are copies; mutating them does not change the store.
 */
export interface Store {
  // Blocks
  listBlocks(): Promise<Block[]>;
  getBlock(id: ID): Promise<Block | null>;
  saveBlock(block: Block): Promise<void>;
  deleteBlock(id: ID): Promise<void>;

  // Draft (one per block)
  getDraft(blockId: ID): Promise<Draft | null>;
  saveDraft(draft: Draft): Promise<void>;
  deleteDraft(blockId: ID): Promise<void>;

  // Published versions (immutable; addVersion rejects a duplicate version number)
  listVersions(blockId: ID): Promise<PlanVersion[]>; // ascending by version
  getVersion(blockId: ID, version: number): Promise<PlanVersion | null>;
  getLatestVersion(blockId: ID): Promise<PlanVersion | null>;
  addVersion(v: PlanVersion): Promise<void>;

  // Add-only log (appendLog ignores an entry whose id already exists, so re-imports are safe)
  appendLog(entries: LogEntry[]): Promise<void>;
  listLog(blockId: ID, day?: DayString): Promise<LogEntry[]>; // ascending by createdAt

  // Device settings
  getSettings(): Promise<DeviceSettings | null>;
  saveSettings(s: DeviceSettings): Promise<void>;
}
