/**
 * Checks against real block maps kept in samples/ (gitignored: licensee data). Skips when absent.
 */
import { PDFDocument } from 'pdf-lib';
import { readGeoPdfFrames } from './geopdf';
import { extractLayerPaths, summarizeLayers } from './pdfVectors';

declare const require: (m: string) => any;
const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), 'samples');
declare const process: { cwd(): string };
const files: string[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f: string) => f.endsWith('.pdf')) : [];

(files.length ? describe : describe.skip)('real GeoPDF samples', () => {
  test.each(files.length ? files : ['none'])('%s', async (f) => {
    const b: Uint8Array = fs.readFileSync(path.join(dir, f));
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const { frames } = await readGeoPdfFrames(buf);
    expect(frames.length).toBeGreaterThan(0);
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
    const t0 = Date.now();
    const groups = extractLayerPaths(doc, 0);
    const summary = summarizeLayers(groups).filter((s) => s.paths > 0);
    console.log(f, `${Date.now() - t0}ms`, JSON.stringify(frames[0].bbox), JSON.stringify(summary));
    expect(summary.length).toBeGreaterThan(0);
  });
});

import { bestPlantingLayer, geoPdfPolygonLayers } from './geopdfFeatures';
(files.length ? describe : describe.skip)('real GeoPDF polygon layers', () => {
  test.each(files.length ? files : ['none'])('%s', async (f) => {
    const b: Uint8Array = fs.readFileSync(path.join(dir, f));
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const { doc, frames } = await readGeoPdfFrames(buf);
    const layers = geoPdfPolygonLayers(doc, frames[0]);
    console.log(f, layers.map((l) => `${l.name} [${l.score}] ${l.polygons.length} polys ${l.areaHa.toFixed(1)} ha`).join(' | '));
    const best = bestPlantingLayer(layers);
    console.log(f, 'BEST', best?.name, best?.polygons.length, best?.areaHa.toFixed(2));
    expect(best).not.toBeNull();
  });
});
