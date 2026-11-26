import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { BlockMap as BlockMapImpl } from './BlockMap';
import type { downloadOfflineRegion as DownloadImpl } from './offline';

/** Expo Go has no MapLibre; load the native map modules only in real builds. */
export const mapAvailable = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

/**
 * Full builds: MapLibre with a basemap. Expo Go: the Avenza-style picture map (the imported PDF is
 * the map), which needs no native map library.
 */
export const BlockMap: typeof BlockMapImpl = mapAvailable ? require('./BlockMap').BlockMap : require('./ImageMap').ImageMap;

export const downloadOfflineRegion: typeof DownloadImpl = mapAvailable
  ? require('./offline').downloadOfflineRegion
  : async () => {
      throw new Error('Offline maps need the full Cachelog build, not Expo Go.');
    };

export type { BlockMapProps, MapMode } from './BlockMap';
export { useUserLocation } from './useUserLocation';
export { blockBounds } from './geo';
export { BASEMAP_STYLE_URL, SATELLITE_STYLE_URL } from './style';
export type { MapPin } from './features';
