import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import type { LngLat } from '../core/types';

export type LocationPermission = 'granted' | 'denied' | 'undetermined';

export interface UserLocationState {
  position: LngLat | null;
  accuracyM: number | null;
  heading: number | null;
  permission: LocationPermission;
}

/** ~10 m accuracy, update every 5 m of movement: plenty for walking a block, easy on battery. */
const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 5,
  timeInterval: 3000, // Android only
};
/** Ignore compass jitter below this many degrees to avoid re-rendering every frame. */
const HEADING_STEP_DEG = 3;

function toPermission(status: Location.PermissionStatus | string): LocationPermission {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

/** Internal: same as useUserLocation but can be switched off (BlockMap with showUserLocation=false). */
export function useUserLocationInternal(enabled: boolean): UserLocationState {
  const [permission, setPermission] = useState<LocationPermission>('undetermined');
  const [position, setPosition] = useState<LngLat | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const subs: Location.LocationSubscription[] = [];
    const keep = (s: Location.LocationSubscription) => {
      if (cancelled) s.remove();
      else subs.push(s);
    };

    (async () => {
      try {
        // When-in-use only (SPEC: no background location in v1).
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== Location.PermissionStatus.GRANTED && perm.canAskAgain) {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (cancelled) return;
        setPermission(toPermission(perm.status));
        if (perm.status !== Location.PermissionStatus.GRANTED) return;

        keep(
          await Location.watchPositionAsync(WATCH_OPTIONS, (loc) => {
            if (cancelled) return;
            setPosition([loc.coords.longitude, loc.coords.latitude]);
            setAccuracyM(loc.coords.accuracy ?? null);
          }),
        );

        try {
          keep(
            await Location.watchHeadingAsync((h) => {
              if (cancelled) return;
              const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
              if (!Number.isFinite(deg) || deg < 0) return;
              setHeading((prev) => {
                if (prev == null) return deg;
                const diff = Math.abs(((deg - prev + 540) % 360) - 180);
                return diff >= HEADING_STEP_DEG ? deg : prev;
              });
            }),
          );
        } catch {
          // No compass (simulator / some devices): heading stays null.
        }
      } catch {
        if (!cancelled) setPermission((p) => (p === 'granted' ? p : 'denied'));
      }
    })();

    return () => {
      cancelled = true;
      for (const s of subs) s.remove();
      subs.length = 0;
    };
  }, [enabled]);

  return { position, accuracyM, heading, permission };
}

/** Own GPS position, accuracy and compass heading. Requests when-in-use permission only. */
export function useUserLocation(): UserLocationState {
  return useUserLocationInternal(true);
}
