/**
 * Runtime map-file import (Expo). The only file in src/import that touches expo-file-system;
 * everything it calls is pure and tested under Node.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { RasterLayer } from '../core/types';
import { geotiffToRaster } from './geotiff';
import { readGeoPdfGeoreference } from './geopdf';
import { kmlToGeoJSON, normalizeGeoJSON } from './vector';
import { newImportId } from './ids';
import type { ImportResult } from './types';
import { describeGeoPdf, extensionOf, layerName, vectorResult } from './helpers';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}

async function readBytes(uri: string): Promise<ArrayBuffer> {
  const f = new File(uri);
  if (!f.exists) throw new Error(`File not found: ${uri}`);
  return toArrayBuffer(await f.bytes());
}

async function readText(uri: string): Promise<string> {
  const f = new File(uri);
  if (!f.exists) throw new Error(`File not found: ${uri}`);
  return f.text();
}

export async function importMapFile(uri: string, name: string): Promise<ImportResult> {
  const ext = extensionOf(name) || extensionOf(uri);
  const title = layerName(name || uri);

  switch (ext) {
    case 'tif':
    case 'tiff': {
      const { png, corners, warnings } = await geotiffToRaster(await readBytes(uri));
      const id = newImportId();
      const dir = new Directory(Paths.document, 'maps');
      dir.create({ intermediates: true, idempotent: true });
      const out = new File(dir, `${id}.png`);
      await out.write(png);
      const layer: RasterLayer = { id, kind: 'raster', name: title, imageUri: out.uri, corners };
      return { kind: 'raster', layer, warnings };
    }
    case 'kml': {
      const geojson = kmlToGeoJSON(await readText(uri));
      return vectorResult(title, geojson);
    }
    case 'geojson':
    case 'json': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readText(uri));
      } catch {
        throw new Error('This file is not valid JSON/GeoJSON.');
      }
      return vectorResult(title, normalizeGeoJSON(parsed));
    }
    case 'pdf': {
      const info = await readGeoPdfGeoreference(await readBytes(uri));
      throw new Error(describeGeoPdf(info));
    }
    case 'kmz':
      throw new Error('KMZ (zipped KML) is not supported yet. Unzip it and import the doc.kml inside, or save it as KML from Google Earth.');
    case 'shp':
    case 'zip':
    case 'dbf':
    case 'shx':
      throw new Error('Shapefiles are not supported yet. Convert to GeoJSON or KML first (QGIS: Export > Save Features As…, or ogr2ogr -f GeoJSON out.geojson in.shp).');
    case 'jpg':
    case 'jpeg':
    case 'png':
      throw new Error('Plain images have no georeferencing. Import the map as a GeoTIFF instead.');
    default:
      throw new Error(`Unsupported file type ".${ext || '?'}". Supported: GeoTIFF (.tif), KML, GeoJSON, GeoPDF (georeference only).`);
  }
}
