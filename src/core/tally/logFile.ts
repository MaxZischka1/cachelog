import type { ID, LogEntry, Timestamp } from '../types';

/**
 * A planter's log entries (bag-ups etc.) sent up to the crew boss by AirDrop.
 * The boss's store dedupes by entry id, so sending the same file twice is harmless.
 */
export interface LogFile {
  format: 'cachelog-log';
  formatVersion: 1;
  blockId: ID;
  deviceId: string;
  author: string;
  exportedAt: Timestamp;
  entries: LogEntry[];
}

export const LOG_FILE_EXTENSION = '.cachelog-log';

export class LogFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogFileError';
  }
}

export function makeLogFile(blockId: ID, deviceId: string, author: string, entries: LogEntry[]): LogFile {
  return {
    format: 'cachelog-log',
    formatVersion: 1,
    blockId,
    deviceId,
    author,
    exportedAt: new Date().toISOString(),
    entries: JSON.parse(JSON.stringify(entries.filter((e) => e.blockId === blockId))) as LogEntry[],
  };
}

const TYPES = new Set(['cache-drop', 'bagup', 'tally', 'piece-status', 'void']);
const DAMAGED = "This bag-up file is damaged and can't be read. Ask the planter to send it again.";

function validEntry(e: unknown, blockId: ID): e is LogEntry {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return false;
  if (o.blockId !== blockId) return false;
  if (typeof o.type !== 'string' || !TYPES.has(o.type)) return false;
  if (typeof o.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.day)) return false;
  if (typeof o.createdAt !== 'string') return false;
  if ('trees' in o) {
    if (!Array.isArray(o.trees)) return false;
    for (const t of o.trees as unknown[]) {
      const c = t as Record<string, unknown>;
      if (!c || typeof c.species !== 'string' || typeof c.count !== 'number' || !Number.isFinite(c.count) || c.count < 0) return false;
    }
  }
  return true;
}

export function serializeLogFile(f: LogFile): string {
  return JSON.stringify(f);
}

/** Validates the file; entries that fail validation make the whole file fail (no partial imports). */
export function parseLogFile(text: string): LogFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new LogFileError(DAMAGED);
  }
  const o = raw as Record<string, unknown>;
  if (!o || o.format !== 'cachelog-log') {
    throw new LogFileError("This isn't a Cachelog bag-up file. If it's a plan, import it from the planter screen.");
  }
  if (typeof o.formatVersion !== 'number' || o.formatVersion > 1) {
    throw new LogFileError('This file was made with a newer version of Cachelog. Update the app, then try again.');
  }
  if (typeof o.blockId !== 'string' || !Array.isArray(o.entries)) throw new LogFileError(DAMAGED);
  const blockId = o.blockId;
  if (!o.entries.every((e) => validEntry(e, blockId))) throw new LogFileError(DAMAGED);
  return raw as LogFile;
}
