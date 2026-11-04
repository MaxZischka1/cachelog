import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { Store } from '../core/store';
import type { Block, DayString, DeviceSettings, Draft, ID, LogEntry, PlanVersion } from '../core/types';
import { DuplicateVersionError } from './shared';

/**
 * Schema migrations, applied in order. Index i brings the database from user_version i to i+1.
 * Never edit a shipped migration; append a new one.
 *
 * Every row stores the full object as a JSON blob (`json`) plus the columns we query/sort on.
 */
export const MIGRATIONS: string[] = [
  // 0 -> 1
  `
  CREATE TABLE blocks (
    id         TEXT PRIMARY KEY NOT NULL,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    json       TEXT NOT NULL
  );
  CREATE TABLE drafts (
    block_id   TEXT PRIMARY KEY NOT NULL,
    updated_at TEXT NOT NULL,
    json       TEXT NOT NULL
  );
  CREATE TABLE versions (
    block_id     TEXT NOT NULL,
    version      INTEGER NOT NULL,
    published_at TEXT NOT NULL,
    json         TEXT NOT NULL,
    PRIMARY KEY (block_id, version)
  );
  CREATE TABLE log (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    id         TEXT NOT NULL UNIQUE,
    block_id   TEXT NOT NULL,
    day        TEXT NOT NULL,
    type       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    json       TEXT NOT NULL
  );
  CREATE INDEX log_block_day_created ON log (block_id, day, created_at, seq);
  CREATE INDEX log_block_created ON log (block_id, created_at, seq);
  CREATE TABLE settings (
    key  TEXT PRIMARY KEY NOT NULL,
    json TEXT NOT NULL
  );
  `,
];

type JsonRow = { json: string };

function parse<T>(row: JsonRow | null): T | null {
  return row ? (JSON.parse(row.json) as T) : null;
}

async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema v${current} is newer than this app (v${MIGRATIONS.length}). Update the app.`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
      // PRAGMA cannot take bound parameters; v + 1 is a trusted integer.
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Opens (creating/migrating as needed) the app database. Semantics match MemoryStore. */
export async function openSqliteStore(dbName = 'cachelog.db'): Promise<Store> {
  const db = await openDatabaseAsync(dbName);
  // WAL must be set outside a transaction; it persists in the file.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await migrate(db);
  return new SqliteStore(db);
}

class SqliteStore implements Store {
  constructor(private readonly db: SQLiteDatabase) {}

  // ---- blocks

  async listBlocks(): Promise<Block[]> {
    const rows = await this.db.getAllAsync<JsonRow>('SELECT json FROM blocks ORDER BY created_at, name');
    return rows.map((r) => JSON.parse(r.json) as Block);
  }

  async getBlock(id: ID): Promise<Block | null> {
    return parse<Block>(await this.db.getFirstAsync<JsonRow>('SELECT json FROM blocks WHERE id = ?', [id]));
  }

  async saveBlock(block: Block): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO blocks (id, name, created_at, json) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, created_at = excluded.created_at, json = excluded.json`,
      [block.id, block.name, block.createdAt, JSON.stringify(block)],
    );
  }

  /** Removes the block with its draft, versions and log. */
  async deleteBlock(id: ID): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM log WHERE block_id = ?', [id]);
      await this.db.runAsync('DELETE FROM versions WHERE block_id = ?', [id]);
      await this.db.runAsync('DELETE FROM drafts WHERE block_id = ?', [id]);
      await this.db.runAsync('DELETE FROM blocks WHERE id = ?', [id]);
    });
  }

  // ---- draft

  async getDraft(blockId: ID): Promise<Draft | null> {
    return parse<Draft>(await this.db.getFirstAsync<JsonRow>('SELECT json FROM drafts WHERE block_id = ?', [blockId]));
  }

  async saveDraft(draft: Draft): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO drafts (block_id, updated_at, json) VALUES (?, ?, ?)
       ON CONFLICT(block_id) DO UPDATE SET updated_at = excluded.updated_at, json = excluded.json`,
      [draft.blockId, draft.updatedAt, JSON.stringify(draft)],
    );
  }

  async deleteDraft(blockId: ID): Promise<void> {
    await this.db.runAsync('DELETE FROM drafts WHERE block_id = ?', [blockId]);
  }

  // ---- versions

  async listVersions(blockId: ID): Promise<PlanVersion[]> {
    const rows = await this.db.getAllAsync<JsonRow>('SELECT json FROM versions WHERE block_id = ? ORDER BY version', [blockId]);
    return rows.map((r) => JSON.parse(r.json) as PlanVersion);
  }

  async getVersion(blockId: ID, version: number): Promise<PlanVersion | null> {
    return parse<PlanVersion>(
      await this.db.getFirstAsync<JsonRow>('SELECT json FROM versions WHERE block_id = ? AND version = ?', [blockId, version]),
    );
  }

  async getLatestVersion(blockId: ID): Promise<PlanVersion | null> {
    return parse<PlanVersion>(
      await this.db.getFirstAsync<JsonRow>('SELECT json FROM versions WHERE block_id = ? ORDER BY version DESC LIMIT 1', [blockId]),
    );
  }

  async addVersion(v: PlanVersion): Promise<void> {
    const res = await this.db.runAsync(
      'INSERT OR IGNORE INTO versions (block_id, version, published_at, json) VALUES (?, ?, ?, ?)',
      [v.blockId, v.version, v.publishedAt, JSON.stringify(v)],
    );
    if (res.changes === 0) throw new DuplicateVersionError(v.blockId, v.version);
  }

  // ---- log

  async appendLog(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.withTransactionAsync(async () => {
      for (const e of entries) {
        await this.db.runAsync(
          'INSERT OR IGNORE INTO log (id, block_id, day, type, created_at, json) VALUES (?, ?, ?, ?, ?, ?)',
          [e.id, e.blockId, e.day, e.type, e.createdAt, JSON.stringify(e)],
        );
      }
    });
  }

  async listLog(blockId: ID, day?: DayString): Promise<LogEntry[]> {
    const rows =
      day === undefined
        ? await this.db.getAllAsync<JsonRow>('SELECT json FROM log WHERE block_id = ? ORDER BY created_at, seq', [blockId])
        : await this.db.getAllAsync<JsonRow>('SELECT json FROM log WHERE block_id = ? AND day = ? ORDER BY created_at, seq', [
            blockId,
            day,
          ]);
    return rows.map((r) => JSON.parse(r.json) as LogEntry);
  }

  // ---- settings

  async getSettings(): Promise<DeviceSettings | null> {
    return parse<DeviceSettings>(await this.db.getFirstAsync<JsonRow>("SELECT json FROM settings WHERE key = 'device'"));
  }

  async saveSettings(s: DeviceSettings): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO settings (key, json) VALUES ('device', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`,
      [JSON.stringify(s)],
    );
  }
}
