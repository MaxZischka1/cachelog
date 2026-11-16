/**
 * "Track my shift": background GPS recording, kept on this phone.
 *
 * expo-location delivers fixes to a TaskManager task even with the screen off. The task only
 * appends them to a small SQLite database (tracks.db); screens read them back. Nothing leaves the
 * phone unless the planter sends a track (a 'track' log entry that rides their next update).
 *
 * The task must be defined at module scope before navigation runs, so src/app/_layout.tsx imports
 * this file first.
 */
import * as Location from 'expo-location';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import type { TrackPoint } from '../core/track';
import type { ID } from '../core/types';

export const SHIFT_TASK = 'cachelog-shift-track';

export type TrackMode = 'precise' | 'saver';

export interface Shift {
  id: string;
  startedAt: string;
  endedAt: string | null;
  blockId: ID | null;
  planterId: ID | null;
  mode: TrackMode;
}

let dbPromise: Promise<SQLiteDatabase> | null = null;

function db(): Promise<SQLiteDatabase> {
  dbPromise ??= (async () => {
    const d = await openDatabaseAsync('tracks.db');
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS shifts (
        id TEXT PRIMARY KEY NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
        block_id TEXT, planter_id TEXT, mode TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS points (
        shift_id TEXT NOT NULL, t INTEGER NOT NULL, lng REAL NOT NULL, lat REAL NOT NULL, acc REAL
      );
      CREATE INDEX IF NOT EXISTS points_shift_t ON points (shift_id, t);
    `);
    return d;
  })();
  return dbPromise;
}

type ShiftRow = { id: string; started_at: string; ended_at: string | null; block_id: string | null; planter_id: string | null; mode: string };
const toShift = (r: ShiftRow): Shift => ({
  id: r.id, startedAt: r.started_at, endedAt: r.ended_at, blockId: r.block_id, planterId: r.planter_id, mode: r.mode === 'saver' ? 'saver' : 'precise',
});

export async function openShift(): Promise<Shift | null> {
  const r = await (await db()).getFirstAsync<ShiftRow>('SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1');
  return r ? toShift(r) : null;
}

/** Shifts that started on `day` (YYYY-MM-DD, local), newest first. */
export async function shiftsOn(day: string): Promise<Shift[]> {
  const rows = await (await db()).getAllAsync<ShiftRow>('SELECT * FROM shifts ORDER BY started_at DESC LIMIT 200');
  return rows.map(toShift).filter((s) => localDay(new Date(s.startedAt)) === day);
}

export async function shiftPoints(shiftId: string): Promise<TrackPoint[]> {
  return (await db()).getAllAsync<TrackPoint>('SELECT t, lng, lat, acc FROM points WHERE shift_id = ? ORDER BY t', shiftId);
}

/** Every shift with its points, newest first (for the season numbers). */
export async function allShifts(): Promise<{ shift: Shift; points: TrackPoint[] }[]> {
  const d = await db();
  const shifts = (await d.getAllAsync<ShiftRow>('SELECT * FROM shifts ORDER BY started_at DESC')).map(toShift);
  return Promise.all(shifts.map(async (shift) => ({ shift, points: await shiftPoints(shift.id) })));
}

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The background task: append fixes to the open shift.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(SHIFT_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    const shift = await openShift();
    if (!shift) return;
    const d = await db();
    for (const l of data.locations) {
      await d.runAsync('INSERT INTO points (shift_id, t, lng, lat, acc) VALUES (?, ?, ?, ?, ?)', shift.id, Math.round(l.timestamp), l.coords.longitude, l.coords.latitude, l.coords.accuracy ?? null);
    }
  } catch {
    // Never throw from a background task; a lost fix is fine.
  }
});

export type StartResult = { ok: true; shift: Shift } | { ok: false; reason: 'foreground-denied' | 'background-denied' | 'unavailable' };

/** Ask for location (foreground first, then Always) and start recording. */
export async function startShift(opts: { blockId?: ID; planterId?: ID; mode: TrackMode }): Promise<StartResult> {
  if (!(await TaskManager.isAvailableAsync())) return { ok: false, reason: 'unavailable' };
  let fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== Location.PermissionStatus.GRANTED) fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== Location.PermissionStatus.GRANTED) return { ok: false, reason: 'foreground-denied' };
  let bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== Location.PermissionStatus.GRANTED) bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== Location.PermissionStatus.GRANTED) return { ok: false, reason: 'background-denied' };

  const existing = await openShift();
  const shift: Shift = existing ?? {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    startedAt: new Date().toISOString(),
    endedAt: null,
    blockId: opts.blockId ?? null,
    planterId: opts.planterId ?? null,
    mode: opts.mode,
  };
  if (!existing) {
    await (await db()).runAsync(
      'INSERT INTO shifts (id, started_at, ended_at, block_id, planter_id, mode) VALUES (?, ?, NULL, ?, ?, ?)',
      shift.id, shift.startedAt, shift.blockId, shift.planterId, shift.mode,
    );
  }
  const precise = shift.mode === 'precise';
  await Location.startLocationUpdatesAsync(SHIFT_TASK, {
    accuracy: precise ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
    distanceInterval: precise ? 3 : 10,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Tracking your shift',
      notificationBody: 'Cachelog is recording the ground you cover. Stop it from the Today tab.',
    },
  });
  return { ok: true, shift };
}

export async function stopShift(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(SHIFT_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(SHIFT_TASK);
  }
  await (await db()).runAsync('UPDATE shifts SET ended_at = ? WHERE ended_at IS NULL', new Date().toISOString());
}

/** True when the OS is delivering fixes to the task (it can stop if the app was force-quit). */
export async function isRecording(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(SHIFT_TASK).catch(() => false);
}

/** Delete a shift and its points from this phone. */
export async function deleteShift(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM points WHERE shift_id = ?', id);
  await d.runAsync('DELETE FROM shifts WHERE id = ?', id);
}
