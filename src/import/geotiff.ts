/**
 * GeoTIFF -> PNG + WGS84 corners. Pure (no Expo), runs under Node/Jest.
 */
import type { fromArrayBuffer } from 'geotiff';
import type { LngLat } from '../core/types';
import { fitAffine, applyAffine, type Affine } from './affine';
import { encodePng } from './png';
import { crsDefinition, epsgFromName, isApproximateDatum, toWgs84 } from './crs';

/** Longest side of the PNG we hand to the map (keeps phone memory in check). */
export const MAX_RASTER_SIDE = 4096;

type GeoTIFFImage = Awaited<ReturnType<Awaited<ReturnType<typeof fromArrayBuffer>>['getImage']>>;
type Num = ArrayLike<number>;

export interface GeoTiffResult {
  png: Uint8Array;
  corners: [LngLat, LngLat, LngLat, LngLat];
  warnings: string[];
}

export async function geotiffToRaster(buf: ArrayBuffer): Promise<GeoTiffResult> {
  const warnings: string[] = [];
  // Loaded lazily: geotiff pulls in ESM-only deps, so importing this module stays cheap/safe in Jest.
  const { fromArrayBuffer: open } = await import('geotiff');
  const tiff = await open(buf);
  const main = await tiff.getImage(0);
  const W = main.getWidth();
  const H = main.getHeight();

  const corners = await imageCorners(main, warnings);

  // Output size: fit within MAX_RASTER_SIDE.
  const scale = Math.min(1, MAX_RASTER_SIDE / Math.max(W, H));
  const outW = Math.max(1, Math.round(W * scale));
  const outH = Math.max(1, Math.round(H * scale));
  if (scale < 1) {
    warnings.push(`Map image downsampled from ${W}×${H} to ${outW}×${outH} px to fit in phone memory.`);
  }

  // Use an internal overview (COG / gdaladdo) when one is at least as big as the output.
  let src: GeoTIFFImage = main;
  if (scale < 1) {
    const count = await tiff.getImageCount();
    for (let i = 1; i < count; i++) {
      const img = await tiff.getImage(i);
      const sub = Number(img.fileDirectory.getValue('NewSubfileType') ?? 0);
      if (sub & 4) continue; // transparency mask
      if (img.getWidth() >= outW && img.getHeight() >= outH && img.getWidth() < src.getWidth()) src = img;
    }
  }

  const rgba = await renderRgba(src, outW, outH, warnings);
  const png = encodePng(rgba, outW, outH);
  return { png, corners, warnings };
}

// ---------------------------------------------------------------- georeferencing

async function tagArray(img: GeoTIFFImage, name: string): Promise<number[] | null> {
  const fd = img.fileDirectory;
  if (!fd.hasTag(name as never)) return null;
  const v = await fd.loadValue(name as never);
  if (v == null) return null;
  return Array.from(v as Num, Number);
}

/** Affine pixel(i, j) -> model(x, y). */
async function pixelToModel(img: GeoTIFFImage): Promise<Affine | null> {
  const mt = await tagArray(img, 'ModelTransformation');
  if (mt && mt.length >= 8) return [mt[0], mt[1], mt[3], mt[4], mt[5], mt[7]];
  const tp = await tagArray(img, 'ModelTiepoint');
  const ps = await tagArray(img, 'ModelPixelScale');
  if (tp && tp.length >= 6 && ps && ps.length >= 2) {
    const [i0, j0, , x0, y0] = tp;
    const [sx, sy] = ps;
    return [sx, 0, x0 - i0 * sx, 0, -sy, y0 + j0 * sy];
  }
  if (tp && tp.length >= 18) {
    // Several tie points (GCPs) without scale: fit an affine.
    const src: [number, number][] = [];
    const dst: [number, number][] = [];
    for (let k = 0; k + 5 < tp.length; k += 6) {
      src.push([tp[k], tp[k + 1]]);
      dst.push([tp[k + 3], tp[k + 4]]);
    }
    return fitAffine(src, dst);
  }
  return null;
}

/** Work out the EPSG code of a GeoTIFF from its geokeys. */
export function epsgFromGeoKeys(keys: Record<string, any> | null, warnings: string[]): number | null {
  if (!keys) return null;
  const USER = 32767;
  const pcs = Number(keys.ProjectedCSTypeGeoKey);
  if (pcs && pcs !== USER) return pcs;
  const model = Number(keys.GTModelTypeGeoKey);
  const gcs = Number(keys.GeographicTypeGeoKey);
  if (model === 2 || (!model && !pcs)) {
    if (gcs && gcs !== USER) return gcs;
    if (model === 2) return 4326;
  }
  // User-defined projected CRS: ProjectionGeoKey 16001-16060 = UTM north (16101.. south).
  const proj = Number(keys.ProjectionGeoKey);
  if (proj >= 16001 && proj <= 16060) {
    const zone = proj - 16000;
    if (gcs === 4269 || gcs === 4617) return 26900 + zone;
    if (gcs === 4267) return 26700 + zone;
    return 32600 + zone;
  }
  if (proj >= 16101 && proj <= 16160) return 32700 + (proj - 16100);
  for (const k of ['PCSCitationGeoKey', 'GTCitationGeoKey', 'GeogCitationGeoKey']) {
    if (typeof keys[k] === 'string') {
      const guess = epsgFromName(keys[k]);
      if (guess) {
        warnings.push(`Projection guessed from its name "${keys[k].trim()}" (EPSG:${guess}); check the map lines up.`);
        return guess;
      }
    }
  }
  return null;
}

async function imageCorners(img: GeoTIFFImage, warnings: string[]): Promise<[LngLat, LngLat, LngLat, LngLat]> {
  const t = await pixelToModel(img);
  if (!t) throw new Error('This TIFF has no georeferencing (no tie points / transform). Export it as a GeoTIFF.');
  const keys = img.getGeoKeys();
  const W = img.getWidth();
  const H = img.getHeight();
  // PixelIsPoint: model coords refer to pixel centres, so the image edge is half a pixel out.
  const o = Number(keys?.GTRasterTypeGeoKey) === 2 ? -0.5 : 0;
  const px: [number, number][] = [[o, o], [W + o, o], [W + o, H + o], [o, H + o]];
  const model = px.map((p) => applyAffine(t, p));

  let epsg = epsgFromGeoKeys(keys as Record<string, any> | null, warnings);
  let def = epsg ? crsDefinition(epsg) : null;
  if (epsg && !def) {
    warnings.push(`Unsupported projection EPSG:${epsg}; the map may be placed incorrectly.`);
  }
  if (!def) {
    const looksLonLat = model.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
    if (looksLonLat) {
      if (!epsg) warnings.push('No projection found; coordinates look like longitude/latitude, assuming WGS84.');
      epsg = 4326;
      def = crsDefinition(4326)!;
    } else {
      throw new Error(
        `Unsupported or missing projection${epsg ? ` (EPSG:${epsg})` : ''}. ` +
          'Re-export the map as UTM NAD83, BC Albers or WGS84 (e.g. gdalwarp -t_srs EPSG:4326).',
      );
    }
  }
  if (epsg && isApproximateDatum(epsg)) {
    warnings.push('Map uses NAD27; without a datum grid it may be off by up to ~100 m.');
  }
  const ll = model.map((p) => toWgs84(def!, p));
  for (const [x, y] of ll) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > 90) {
      throw new Error('Could not compute map corners: projection transform failed.');
    }
  }
  return ll as [LngLat, LngLat, LngLat, LngLat];
}

// ---------------------------------------------------------------- pixels

function maxForBits(bits: number): number {
  return bits >= 32 ? 4294967295 : 2 ** bits - 1;
}

async function renderRgba(img: GeoTIFFImage, w: number, h: number, warnings: string[]): Promise<Uint8Array> {
  const fd = img.fileDirectory;
  const pi = fd.getValue('PhotometricInterpretation') as number | undefined;
  const spp = img.getSamplesPerPixel();
  const bits = img.getBitsPerSample(0);
  const fmt = img.getSampleFormat(0); // 1 uint, 2 int, 3 float
  const nodata = img.getGDALNoData();
  const out = new Uint8Array(w * h * 4);
  const n = w * h;
  const resize = w !== img.getWidth() || h !== img.getHeight();
  const opts = (samples: number[], method: string) => ({
    samples,
    interleave: true as const,
    ...(resize ? { width: w, height: h, resampleMethod: method } : {}),
  });

  if (pi === 3) {
    // Palette
    const idx = (await img.readRasters(opts([0], 'nearest'))) as unknown as Num;
    const cm = (await fd.loadValue('ColorMap' as never)) as unknown as Num;
    const third = cm.length / 3;
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      out[i * 4] = cm[k] >> 8;
      out[i * 4 + 1] = cm[k + third] >> 8;
      out[i * 4 + 2] = cm[k + 2 * third] >> 8;
      out[i * 4 + 3] = nodata !== null && k === nodata ? 0 : 255;
    }
    return out;
  }

  if (pi === 5 || pi === 6 || pi === 8) {
    // CMYK / YCbCr / CIELab: let geotiff.js convert to 8-bit RGB.
    const rgb = (await img.readRGB({ interleave: true, ...(resize ? { width: w, height: h, resampleMethod: 'bilinear' } : {}) })) as unknown as Num;
    for (let i = 0; i < n; i++) {
      out[i * 4] = rgb[i * 3];
      out[i * 4 + 1] = rgb[i * 3 + 1];
      out[i * 4 + 2] = rgb[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  if (pi === 2 || (pi === undefined && spp >= 3)) {
    const extra = fd.getValue('ExtraSamples') as unknown as Num | number | undefined;
    const extra0 = typeof extra === 'number' ? extra : extra?.[0];
    const hasAlpha = spp >= 4 && (extra0 === 1 || extra0 === 2);
    const samples = hasAlpha ? [0, 1, 2, 3] : [0, 1, 2];
    const c = samples.length;
    const data = (await img.readRasters(opts(samples, 'bilinear'))) as unknown as Num;
    const [lo, hi] = valueRange(data, fmt, bits, nodata);
    const k = hi > lo ? 255 / (hi - lo) : 1;
    for (let i = 0; i < n; i++) {
      const r = data[i * c], g = data[i * c + 1], b = data[i * c + 2];
      out[i * 4] = clamp((r - lo) * k);
      out[i * 4 + 1] = clamp((g - lo) * k);
      out[i * 4 + 2] = clamp((b - lo) * k);
      const isNoData = nodata !== null && r === nodata && g === nodata && b === nodata;
      out[i * 4 + 3] = isNoData ? 0 : hasAlpha ? clamp((data[i * c + 3] - lo) * k) : 255;
    }
    return out;
  }

  // Single band (grayscale, DEM, hillshade, ...); extra bands ignored.
  if (spp > 1 && pi !== 0 && pi !== 1) warnings.push(`Image has ${spp} bands; only the first is shown.`);
  const data = (await img.readRasters(opts([0], 'bilinear'))) as unknown as Num;
  const [lo, hi] = valueRange(data, fmt, bits, nodata);
  const k = hi > lo ? 255 / (hi - lo) : 1;
  const invert = pi === 0; // WhiteIsZero
  for (let i = 0; i < n; i++) {
    const v = data[i];
    const bad = (nodata !== null && v === nodata) || Number.isNaN(v);
    let g = clamp((v - lo) * k);
    if (invert) g = 255 - g;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = bad ? 0 : 255;
  }
  return out;
}

/** Value range to map onto 0..255: full bit depth for 8-bit, data min/max for anything else. */
function valueRange(data: Num, fmt: number, bits: number, nodata: number | null): [number, number] {
  if (fmt !== 3 && fmt !== 2 && bits === 8) return [0, 255];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isNaN(v) || v === nodata) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, fmt === 3 ? 1 : maxForBits(bits)];
  // Integer data that already spans most of its range: keep the full range (no contrast stretch).
  if (fmt === 1 && hi > maxForBits(bits) / 2 && lo < maxForBits(bits) / 8) return [0, maxForBits(bits)];
  return [lo, hi];
}

function clamp(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}
