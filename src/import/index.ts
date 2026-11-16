/**
 * Map file import (Agent D). Everything here is pure except importMapFile, which loads the
 * Expo file-system code lazily so this module can be imported under Jest/Node.
 */
import type { ImportResult } from './types';

export type { ImportResult } from './types';
export type { GeoPdfInfo } from './geopdf';
export { geotiffToRaster, MAX_RASTER_SIDE } from './geotiff';
export { kmlToGeoJSON, featuresToPieces, normalizeGeoJSON } from './vector';
export { readGeoPdfGeoreference } from './geopdf';
export { describeGeoPdf, isMapFileName } from './helpers';

/** Import a map file picked by the user. Dispatches on extension: .tif/.tiff, .kml, .geojson/.json, .pdf. */
export async function importMapFile(uri: string, name: string): Promise<ImportResult> {
  const m = await import('./fileImport');
  return m.importMapFile(uri, name);
}
