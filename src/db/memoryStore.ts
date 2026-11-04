import type { Store } from '../core/store';
import { compareBlocks, DuplicateVersionError } from './shared';
import type { Block, DayString, DeviceSettings, Draft, ID, LogEntry, PlanVersion } from '../core/types';

/** All stored data is plain JSON, so a JSON round-trip is a faithful deep copy. */
function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * In-memory Store for tests and previews. Same semantics as the SQLite store:
 *  - everything in/out is deep-copied
 *  - addVersion throws DuplicateVersionError on an existing (blockId, version)
 *  - appendLog ignores entries whose id is already stored (also within one batch)
 *  - listLog is ascending by createdAt, ties in insertion order
 *  - deleteBlock also removes that block's draft, versions and log
 */
export class MemoryStore implements Store {
  private blocks = new Map<ID, Block>();
  private drafts = new Map<ID, Draft>();
  private versions = new Map<ID, Map<number, PlanVersion>>();
  private log: LogEntry[] = [];
  private logIds = new Set<ID>();
  private settings: DeviceSettings | null = null;

  async listBlocks(): Promise<Block[]> {
    return [...this.blocks.values()].sort(compareBlocks).map(copy);
  }
  async getBlock(id: ID): Promise<Block | null> {
    const b = this.blocks.get(id);
    return b ? copy(b) : null;
  }
  async saveBlock(block: Block): Promise<void> {
    this.blocks.set(block.id, copy(block));
  }
  async deleteBlock(id: ID): Promise<void> {
    this.blocks.delete(id);
    this.drafts.delete(id);
    this.versions.delete(id);
    this.log = this.log.filter((e) => {
      if (e.blockId !== id) return true;
      this.logIds.delete(e.id);
      return false;
    });
  }

  async getDraft(blockId: ID): Promise<Draft | null> {
    const d = this.drafts.get(blockId);
    return d ? copy(d) : null;
  }
  async saveDraft(draft: Draft): Promise<void> {
    this.drafts.set(draft.blockId, copy(draft));
  }
  async deleteDraft(blockId: ID): Promise<void> {
    this.drafts.delete(blockId);
  }

  async listVersions(blockId: ID): Promise<PlanVersion[]> {
    const m = this.versions.get(blockId);
    if (!m) return [];
    return [...m.values()].sort((a, b) => a.version - b.version).map(copy);
  }
  async getVersion(blockId: ID, version: number): Promise<PlanVersion | null> {
    const v = this.versions.get(blockId)?.get(version);
    return v ? copy(v) : null;
  }
  async getLatestVersion(blockId: ID): Promise<PlanVersion | null> {
    const m = this.versions.get(blockId);
    if (!m || m.size === 0) return null;
    let latest: PlanVersion | null = null;
    for (const v of m.values()) if (!latest || v.version > latest.version) latest = v;
    return latest ? copy(latest) : null;
  }
  async addVersion(v: PlanVersion): Promise<void> {
    let m = this.versions.get(v.blockId);
    if (!m) this.versions.set(v.blockId, (m = new Map()));
    if (m.has(v.version)) throw new DuplicateVersionError(v.blockId, v.version);
    m.set(v.version, copy(v));
  }

  async appendLog(entries: LogEntry[]): Promise<void> {
    for (const e of entries) {
      if (this.logIds.has(e.id)) continue;
      this.logIds.add(e.id);
      this.log.push(copy(e));
    }
  }
  async listLog(blockId: ID, day?: DayString): Promise<LogEntry[]> {
    return this.log
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.blockId === blockId && (day === undefined || e.day === day))
      .sort((a, b) => (a.e.createdAt < b.e.createdAt ? -1 : a.e.createdAt > b.e.createdAt ? 1 : a.i - b.i))
      .map(({ e }) => copy(e));
  }

  async getSettings(): Promise<DeviceSettings | null> {
    return this.settings ? copy(this.settings) : null;
  }
  async saveSettings(s: DeviceSettings): Promise<void> {
    this.settings = copy(s);
  }
}
