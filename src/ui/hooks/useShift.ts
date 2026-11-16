import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { today } from '../../core/plan';
import { cleanTrack, coverage, simplifyLine, swathM, trackDistanceM, trackLines, type TrackPoint } from '../../core/track';
import type { ID, LngLat, Piece, TrackEntry } from '../../core/types';
import { isRecording, openShift, shiftPoints, shiftsOn, startShift, stopShift, type Shift, type TrackMode } from '../../tracking';
import { showError } from '../alerts';

export interface ShiftSummary {
  lines: LngLat[][];
  distanceM: number;
  /** Time on shift today (all of today's shifts, the open one up to now). */
  durationMs: number;
  coveredHa: number;
  /** Covered hectares inside the planter's piece, when they have one. */
  inPieceHa: number | null;
  startedAt: string | null;
}

const EMPTY: ShiftSummary = { lines: [], distanceM: 0, durationMs: 0, coveredHa: 0, inPieceHa: null, startedAt: null };

/** Today's shift tracking: on/off, and what the recorded fixes add up to. Polls while mounted. */
export function useShift(opts: { blockId?: ID; planterId?: ID; piece?: Piece | null }) {
  const [open, setOpen] = useState<Shift | null>(null);
  const [recording, setRecording] = useState(false);
  const [points, setPoints] = useState<{ shifts: Shift[]; points: TrackPoint[] }>({ shifts: [], points: [] });
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [o, rec, shifts] = await Promise.all([openShift(), isRecording(), shiftsOn(today())]);
        const pts = (await Promise.all(shifts.map((s) => shiftPoints(s.id)))).flat();
        if (cancelled) return;
        setOpen(o);
        setRecording(rec);
        setPoints({ shifts, points: pts });
      } catch {
        // tracks.db unavailable (e.g. web): leave tracking off
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    const id = setInterval(refresh, 15_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [refresh]);

  const swath = swathM(opts.piece?.prescription);
  const summary: ShiftSummary = useMemo(() => {
    if (!points.points.length && !points.shifts.length) return EMPTY;
    const clean = cleanTrack(points.points);
    const lines = trackLines(clean);
    const cov = coverage(lines, swath);
    const now = Date.now();
    const durationMs = points.shifts.reduce((s, sh) => s + ((sh.endedAt ? Date.parse(sh.endedAt) : now) - Date.parse(sh.startedAt)), 0);
    return {
      lines,
      distanceM: trackDistanceM(clean),
      durationMs,
      coveredHa: cov.ha,
      inPieceHa: opts.piece && opts.piece.polygon.length >= 3 ? cov.haIn(opts.piece.polygon) : null,
      startedAt: points.shifts.length ? points.shifts[points.shifts.length - 1].startedAt : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, swath, opts.piece?.id, tick]);

  const start = useCallback(
    async (mode: TrackMode) => {
      setBusy(true);
      try {
        const r = await startShift({ blockId: opts.blockId, planterId: opts.planterId, mode });
        if (!r.ok) {
          const msg =
            r.reason === 'unavailable'
              ? 'Background tracking is not available on this phone.'
              : r.reason === 'foreground-denied'
                ? 'Cachelog needs your location to track a shift.'
                : 'To keep tracking with the phone in your pocket, set Location for Cachelog to “Always”.';
          Alert.alert('Tracking is off', msg, r.reason === 'unavailable' ? undefined : [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
        }
      } catch (e) {
        showError('Could not start tracking', e);
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [opts.blockId, opts.planterId, refresh],
  );

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await stopShift();
    } catch (e) {
      showError('Could not stop tracking', e);
    } finally {
      setBusy(false);
      refresh();
    }
  }, [refresh]);

  return { tracking: !!open, recording, open, summary, swath, start, stop, busy, refresh };
}

/** Today's track as a log entry the planter can send (simplified to 2 m). */
export function trackEntryFields(s: ShiftSummary, planterId: ID | undefined): Omit<TrackEntry, 'id' | 'blockId' | 'day' | 'createdAt' | 'deviceId' | 'author' | 'type'> {
  const lines = s.lines.map((l) => simplifyLine(l, 2)).filter((l) => l.length >= 2);
  return {
    planterId,
    startedAt: s.startedAt ?? new Date().toISOString(),
    endedAt: new Date().toISOString(),
    lines,
    distanceM: Math.round(s.distanceM),
    coveredHa: Math.round(s.coveredHa * 100) / 100,
  };
}
