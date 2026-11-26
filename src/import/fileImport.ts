/**
 * Runtime map-file import (Expo). The only file in src/import that touches expo-file-system;
 * everything it calls is pure and tested under Node.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { RasterLayer } from '../core/types';
import { geotiffToRaster } from './geotiff';
import { PDFDocument } from 'pdf-lib';
import { renderPdfPage } from '../pdf/PdfRenderer';
import { readGeoPdfFrames } from './geopdf';
import { bestPlantingLayer, geoPdfPolygonLayers, layerToGeoJSON, shortName } from './geopdfFeatures';
import { featuresToPieces } from './vector';
import { kmlToGeoJSON, normalizeGeoJSON } from './vector';
import type { LngLat, VectorLayer } from '../core/types';
import { newImportId } from './ids';
import type { ImportResult } from './types';
import { extensionOf, layerName, vectorResult } from './helpers';

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
    case 'pdf':
      return importGeoPdf(uri, title);
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

/**
 * GeoPDF, Avenza-style: read where the map sits, draw the map frame to an image on the phone, and
 * pull the block's shapes out of the PDF's layers so the boss doesn't have to trace them.
 */
async function importGeoPdf(uri: string, title: string): Promise<ImportResult> {
  const f = new File(uri);
  if (!f.exists) throw new Error(`File not found: ${uri}`);
  const bytes = await f.bytes();
  const { frames } = await readGeoPdfFrames(toArrayBuffer(bytes));
  const frame = frames[0];
  if (!frame) {
    throw new Error(
      "This PDF isn't georeferenced, so Cachelog can't tell where it sits on the earth. Ask for the GeoPDF version of the map " +
        '(ArcGIS: Export Map > PDF with "Export georeference information" ticked; Avenza Map Store PDFs work too).',
    );
  }
  const warnings: string[] = [];
  if (frames.length > 1) warnings.push(`This PDF has ${frames.length} map pages; only page ${frame.pageIndex + 1} was imported.`);

  const [x1, y1, x2, y2] = frame.bbox;
  const rendered = await renderPdfPage({ b64: await f.base64(), page: frame.pageIndex, crop: [x1, y1, x2, y2] });
  const id = newImportId();
  const dir = new Directory(Paths.document, 'maps');
  dir.create({ intermediates: true, idempotent: true });
  const out = new File(dir, `${id}.jpg`);
  await out.write(rendered.jpegB64, { encoding: 'base64' });
  const corners = [frame.toLngLat([x1, y2]), frame.toLngLat([x2, y2]), frame.toLngLat([x2, y1]), frame.toLngLat([x1, y1])] as [LngLat, LngLat, LngLat, LngLat];
  if (frame.rotation) warnings.push('This PDF page is rotated; the map is placed correctly but may appear turned.');

  let candidates: ReturnType<typeof geoPdfPolygonLayers> = [];
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    candidates = geoPdfPolygonLayers(doc, frame);
  } catch (e) {
    warnings.push(`Couldn't read the shapes in this PDF (${e instanceof Error ? e.message : String(e)}). Draw the pieces by hand.`);
  }
  const best = bestPlantingLayer(candidates);
  let outline: VectorLayer | null = null;
  let pieces: ReturnType<typeof featuresToPieces> = [];
  if (best) {
    const geojson = layerToGeoJSON(best);
    outline = { id: newImportId(), kind: 'vector', name: `${title}: ${shortName(best.name)}`, geojson };
    pieces = featuresToPieces(geojson);
  } else if (candidates.length === 0) {
    warnings.push('No block shapes were found in the PDF layers. Draw the pieces on the map instead.');
  }
  return {
    kind: 'geopdf',
    layer: { id, kind: 'raster', name: title, imageUri: out.uri, corners },
    outline,
    pieces,
    candidates: candidates.filter((c) => c.score > -5).map((c) => ({ name: c.name, polygons: c.polygons.length, areaHa: c.areaHa })),
    text: rendered.text,
    warnings,
  };
}
