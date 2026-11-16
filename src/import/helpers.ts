/** Pure helpers for the file importer (no Expo). */
import type { GeoJSONFeatureCollection, VectorLayer } from '../core/types';
import type { GeoPdfInfo } from './geopdf';
import { newImportId } from './ids';
import type { ImportResult } from './types';
import { featuresToPieces } from './vector';

export function extensionOf(nameOrUri: string): string {
  const clean = nameOrUri.split(/[?#]/)[0];
  const base = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

const MAP_EXTENSIONS = new Set(['pdf', 'tif', 'tiff', 'kml', 'kmz', 'geojson', 'shp', 'shx', 'dbf', 'zip', 'jpg', 'jpeg', 'png']);

/**
 * True for files that belong in Map layers, not the Cachelog file import (plans, updates,
 * suggestions). Plain .json is left out: it could be either, and the content check sorts it out.
 */
export function isMapFileName(nameOrUri: string): boolean {
  return MAP_EXTENSIONS.has(extensionOf(nameOrUri));
}

/** Display name: file name without folder or extension. */
export function layerName(nameOrUri: string): string {
  let base = nameOrUri.split(/[?#]/)[0];
  base = base.slice(base.lastIndexOf('/') + 1);
  try {
    base = decodeURIComponent(base);
  } catch {
    /* keep raw */
  }
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim();
  return stem || 'Imported map';
}

const fmt = (v: number) => v.toFixed(5);

/**
 * User-facing message when a PDF can't become a map layer: either it has no georeferencing, or
 * this build has no PDF renderer (Android, or an iPhone build from before PDF support).
 */
export function describeGeoPdf(info: GeoPdfInfo | null): string {
  const how =
    'Convert it to GeoTIFF on a laptop and import the .tif instead: in QGIS, add the PDF as a raster layer and use ' +
    'Raster > Conversion > Translate (save as GeoTIFF), or run: gdal_translate -of GTiff -co COMPRESS=DEFLATE map.pdf map.tif';
  if (!info) {
    return (
      "This PDF has no georeferencing that Cachelog can read, so it can't be placed on the map. " +
      'Check that it is a GeoPDF: Avenza Maps or QGIS show coordinates for one. A plain scan or printout has none; ' +
      'georeference it in QGIS (Raster > Georeferencer), save it as a GeoTIFF and import the .tif.'
    );
  }
  const lines = info.pages.map((p) => {
    const [tl, tr, br, bl] = p.corners;
    return (
      `Page ${p.pageIndex + 1}${p.crs ? ` (${p.crs})` : ''}: ` +
      `top-left ${fmt(tl[1])}, ${fmt(tl[0])}; top-right ${fmt(tr[1])}, ${fmt(tr[0])}; ` +
      `bottom-right ${fmt(br[1])}, ${fmt(br[0])}; bottom-left ${fmt(bl[1])}, ${fmt(bl[0])}`
    );
  });
  return (
    `This GeoPDF is georeferenced, but this version of the app can't draw PDF maps (only the iPhone app can, ` +
    `from the build that added PDF support). ${how}\n\n` +
    `Georeference found (lat, lon):\n${lines.join('\n')}`
  );
}

/** Which georeferenced page of a GeoPDF to import: the first. Warns when there are others. */
export function chooseGeoPdfPage(info: GeoPdfInfo): { page: GeoPdfInfo['pages'][number]; warnings: string[] } {
  const page = info.pages[0];
  const warnings: string[] = [];
  if (info.pages.length > 1) {
    const others = info.pages.slice(1).map((p) => p.pageIndex + 1).join(', ');
    warnings.push(
      `This PDF has ${info.pages.length} map pages. Page ${page.pageIndex + 1} was imported; ` +
        `to use page ${others} as well, save ${info.pages.length > 2 ? 'each' : 'it'} as its own PDF and import that.`,
    );
  }
  return { page, warnings };
}

function firstCoord(c: unknown): [number, number] | null {
  let cur: unknown = c;
  while (Array.isArray(cur) && Array.isArray(cur[0])) cur = cur[0];
  return Array.isArray(cur) && typeof cur[0] === 'number' && typeof cur[1] === 'number' ? [cur[0], cur[1]] : null;
}

export function vectorResult(name: string, geojson: GeoJSONFeatureCollection): ImportResult {
  const warnings: string[] = [];
  if (geojson.features.length === 0) warnings.push('The file contains no features.');
  const pieces = featuresToPieces(geojson);
  const outOfRange = geojson.features.some((f) => {
    const c = firstCoord(f.geometry?.coordinates);
    return c !== null && (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90);
  });
  if (outOfRange) warnings.push('Coordinates are not longitude/latitude. Re-export the file in WGS84 (EPSG:4326).');
  const layer: VectorLayer = { id: newImportId(), kind: 'vector', name, geojson };
  return { kind: 'vector', layer, pieces: outOfRange ? [] : pieces, warnings };
}
