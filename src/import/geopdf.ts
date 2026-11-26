/**
 * GeoPDF georeference reader. Pure (pdf-lib only).
 *
 * Supports:
 *  - ISO 32000-2 / Adobe "GEO" extension (Avenza, ArcGIS, QGIS, GDAL): page /VP array of
 *    viewports, each with /BBox and /Measure << /Subtype /GEO /GPTS [lat lon ...] /LPTS [u v ...] >>.
 *  - TerraGo / OGC best-practice "LGIDict" (page or catalog level): /CTM or /Registration
 *    with a /Projection dictionary.
 */
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObject, PDFRef, PDFString,
  PDFBool, PDFRawStream, PDFStream,
} from 'pdf-lib';
import type { LngLat } from '../core/types';
import { applyAffine, fitAffine, type Affine } from './affine';
import { crsDefinition, epsgFromName, fromWgs84, localUtmFor, toWgs84 } from './crs';

export interface GeoPdfInfo {
  pages: { pageIndex: number; corners: [LngLat, LngLat, LngLat, LngLat]; crs?: string }[];
}

type Js = number | string | boolean | null | Js[] | { [k: string]: Js };
type Ctx = PDFDocument['context'];

/** Convert a pdf-lib object tree into plain JS (names become strings without the slash). */
function toJs(ctx: Ctx, obj: PDFObject | undefined, depth = 0): Js {
  if (obj === undefined || depth > 12) return null;
  if (obj instanceof PDFRef) return toJs(ctx, ctx.lookup(obj), depth + 1);
  if (obj instanceof PDFNumber) return obj.asNumber();
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFName) return obj.decodeText();
  if (obj instanceof PDFBool) return obj.asBoolean();
  if (obj instanceof PDFArray) return obj.asArray().map((o) => toJs(ctx, o, depth + 1));
  if (obj instanceof PDFStream || obj instanceof PDFRawStream) return null;
  if (obj instanceof PDFDict) {
    const out: { [k: string]: Js } = {};
    for (const [k, v] of obj.entries()) {
      const key = k.decodeText();
      if (key === 'Parent' || key === 'P' || key === 'Contents' || key === 'Resources' || key === 'Annots') continue;
      out[key] = toJs(ctx, v, depth + 1);
    }
    return out;
  }
  return null;
}

function n(v: Js | undefined): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const x = parseFloat(v.trim());
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

function nums(v: Js | undefined): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const y = n(x);
    if (y === null) return [];
    out.push(y);
  }
  return out;
}

function str(v: Js | undefined): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
}

function asDict(v: Js | undefined): { [k: string]: Js } | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

export type Box = { x: number; y: number; width: number; height: number };

/** Page corners in user space, TL TR BR BL as displayed (honouring /Rotate). */
function pageCorners(box: Box, rotation: number): [number, number][] {
  const { x, y, width, height } = box;
  const c: [number, number][] = [[x, y + height], [x + width, y + height], [x + width, y], [x, y]];
  const r = (((Math.round(rotation / 90) % 4) + 4) % 4);
  // Rotating the page clockwise by 90° shows the old bottom-left at top-left.
  return c.map((_, i) => c[(i + 4 - r) % 4]);
}

function finiteCorners(ll: LngLat[]): ll is [LngLat, LngLat, LngLat, LngLat] {
  return ll.length === 4 && ll.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(b) <= 90 && Math.abs(a) <= 540);
}

/**
 * Fit an affine page -> local UTM using control points given in WGS84, then map the page corners.
 * Fitting in a planar frame keeps it exact for maps drawn in any projected CRS at block scale.
 */
/** Page user space (points) -> WGS84 lon/lat. */
export type PageToLngLat = (p: [number, number]) => LngLat;

function transformFromControl(pagePts: [number, number][], lngLats: LngLat[]): PageToLngLat | null {
  if (pagePts.length < 3) return null;
  const c: LngLat = [
    lngLats.reduce((s, p) => s + p[0], 0) / lngLats.length,
    lngLats.reduce((s, p) => s + p[1], 0) / lngLats.length,
  ];
  const frame = localUtmFor(c);
  const dst = lngLats.map((p) => fromWgs84(frame, p));
  const t = fitAffine(pagePts, dst);
  if (!t) return null;
  return (p) => toWgs84(frame, applyAffine(t, p));
}

/** Map frame found on a page: its box in page space and how to turn page points into lon/lat. */
interface FrameHit {
  bbox: [number, number, number, number];
  toLngLat: PageToLngLat;
  corners: LngLat[];
  crs?: string;
}

function crsName(gcs: { [k: string]: Js } | null): string | undefined {
  if (!gcs) return undefined;
  const epsg = n(gcs.EPSG);
  if (epsg) return `EPSG:${epsg}`;
  const wkt = str(gcs.WKT);
  if (wkt) {
    const m = /^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS|GEODCRS)\s*\[\s*"([^"]+)"/i.exec(wkt);
    if (m) {
      const guess = epsgFromName(m[1]);
      return guess ? `EPSG:${guess} (${m[1]})` : m[1];
    }
    return 'WKT';
  }
  return undefined;
}

// ---------------------------------------------------------------- ISO 32000 /VP /Measure /GEO

function fromViewports(vps: Js, corners: [number, number][]): FrameHit | null {
  const list = Array.isArray(vps) ? vps : asDict(vps) ? [vps] : [];
  let best: (FrameHit & { area: number }) | null = null;
  for (const raw of list) {
    const vp = asDict(raw);
    if (!vp) continue;
    const measure = asDict(vp.Measure);
    if (!measure || (measure.Subtype !== 'GEO' && measure.Subtype !== undefined)) continue;
    const bb = nums(vp.BBox);
    if (bb.length !== 4) continue;
    const x1 = Math.min(bb[0], bb[2]), x2 = Math.max(bb[0], bb[2]);
    const y1 = Math.min(bb[1], bb[3]), y2 = Math.max(bb[1], bb[3]);
    const gpts = nums(measure.GPTS);
    let lpts = nums(measure.LPTS);
    if (lpts.length === 0) lpts = nums(measure.Bounds);
    if (lpts.length === 0) lpts = [0, 0, 0, 1, 1, 1, 1, 0];
    const k = Math.min(gpts.length, lpts.length) >> 1;
    if (k < 3) continue;
    // GPTS is lat, lon. Tolerate writers that swapped the order.
    const swapped = (() => {
      for (let i = 0; i < k; i++) if (Math.abs(gpts[2 * i]) > 90) return true;
      return false;
    })();
    const pagePts: [number, number][] = [];
    const lls: LngLat[] = [];
    for (let i = 0; i < k; i++) {
      const u = lpts[2 * i], v = lpts[2 * i + 1];
      pagePts.push([x1 + u * (x2 - x1), y1 + v * (y2 - y1)]);
      const a = gpts[2 * i], b = gpts[2 * i + 1];
      lls.push(swapped ? [a, b] : [b, a]);
    }
    const toLngLat = transformFromControl(pagePts, lls);
    if (!toLngLat) continue;
    const ll = corners.map(toLngLat);
    if (!finiteCorners(ll)) continue;
    const area = (x2 - x1) * (y2 - y1);
    if (!best || area > best.area) best = { bbox: [x1, y1, x2, y2], toLngLat, corners: ll, crs: crsName(asDict(measure.GCS)), area };
  }
  return best ? { bbox: best.bbox, toLngLat: best.toLngLat, corners: best.corners, crs: best.crs } : null;
}

// ---------------------------------------------------------------- TerraGo LGIDict

function lgiProjection(p: { [k: string]: Js } | null): { def: string | null; label: string } {
  if (!p) return { def: null, label: 'LGIDict (no projection)' };
  const type = (str(p.ProjectionType) ?? '').toUpperCase();
  const datumRaw = p.Datum;
  const datum = (str(datumRaw) ?? str(asDict(datumRaw)?.Key ?? null) ?? '').toUpperCase();
  const isNad27 = datum.startsWith('NAS');
  const dat = isNad27 ? '+datum=NAD27' : datum.startsWith('NAR') ? '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0' : '+datum=WGS84';
  const f = (k: string, d = 0) => n(p[k]) ?? d;
  const label = `LGIDict ${type || '?'}${type === 'UT' ? ` zone ${f('Zone')}${str(p.Hemisphere) ?? ''}` : ''}${datum ? ` (${datum})` : ''}`;
  const common = `+x_0=${f('FalseEasting')} +y_0=${f('FalseNorthing')} ${dat} +units=m +no_defs`;
  switch (type) {
    case 'GEODETIC':
    case 'GEOGRAPHIC':
    case 'GEO':
      return { def: crsDefinition(4326), label };
    case 'UT': {
      const zone = f('Zone');
      if (!zone) return { def: null, label };
      const south = (str(p.Hemisphere) ?? 'N').toUpperCase().startsWith('S');
      return { def: `+proj=utm +zone=${zone}${south ? ' +south' : ''} ${dat} +units=m +no_defs`, label };
    }
    case 'TC':
      return { def: `+proj=tmerc +lat_0=${f('OriginLatitude')} +lon_0=${f('CentralMeridian')} +k=${f('ScaleFactor', 1)} ${common}`, label };
    case 'AC':
      return { def: `+proj=aea +lat_0=${f('OriginLatitude')} +lon_0=${f('CentralMeridian')} +lat_1=${f('StandardParallelOne')} +lat_2=${f('StandardParallelTwo')} ${common}`, label };
    case 'LE':
      return { def: `+proj=lcc +lat_0=${f('OriginLatitude')} +lon_0=${f('CentralMeridian')} +lat_1=${f('StandardParallelOne')} +lat_2=${f('StandardParallelTwo')} ${common}`, label };
    case 'MC':
      return { def: `+proj=merc +lon_0=${f('CentralMeridian')} +k=${f('ScaleFactor', 1)} ${common}`, label };
    default:
      return { def: null, label };
  }
}

function fromLgiDict(raw: Js, corners: [number, number][], box: Box): FrameHit | null {
  const list = Array.isArray(raw) ? raw : [raw];
  for (const item of list) {
    const d = asDict(item);
    if (!d) continue;
    const { def, label } = lgiProjection(asDict(d.Projection));
    if (!def) continue;
    const geographic = def.startsWith('+proj=longlat');
    // page -> projected affine: from /Registration control points if >= 3, else /CTM.
    let t: Affine | null = null;
    const reg = Array.isArray(d.Registration) ? d.Registration.map((r) => nums(r)).filter((r) => r.length >= 4) : [];
    if (reg.length >= 3) {
      t = fitAffine(reg.map((r) => [r[0], r[1]] as [number, number]), reg.map((r) => [r[2], r[3]] as [number, number]));
    }
    if (!t) {
      const ctm = nums(d.CTM);
      if (ctm.length === 6) t = [ctm[0], ctm[2], ctm[4], ctm[1], ctm[3], ctm[5]];
    }
    if (!t) continue;
    const affine = t;
    // Some geographic LGIDicts use arc-seconds rather than degrees.
    const arcSec = geographic && corners.map((p) => applyAffine(affine, p)).some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90);
    const toLngLat: PageToLngLat = (p) => {
      const [x, y] = applyAffine(affine, p);
      return toWgs84(def, arcSec ? [x / 3600, y / 3600] : [x, y]);
    };
    const ll = corners.map(toLngLat);
    if (finiteCorners(ll)) return { bbox: [box.x, box.y, box.x + box.width, box.y + box.height], toLngLat, corners: ll, crs: label };
  }
  return null;
}

// ---------------------------------------------------------------- entry

/** Everything needed to draw one georeferenced page and convert its drawings to lon/lat. */
export interface GeoPdfFrame {
  pageIndex: number;
  /** Crop box in page user space. */
  pageBox: Box;
  rotation: number;
  /** Map frame (viewport) box in page user space: x1, y1, x2, y2. The full page for LGIDict maps. */
  bbox: [number, number, number, number];
  toLngLat: PageToLngLat;
  crs?: string;
}

export async function readGeoPdfFrames(buf: ArrayBuffer): Promise<{ doc: PDFDocument; frames: GeoPdfFrame[] }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    throw new Error(`Could not read PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ctx = doc.context;
  const pages = doc.getPages();
  const catalogLgi = toJs(ctx, doc.catalog.get(PDFName.of('LGIDict')));
  const frames: GeoPdfFrame[] = [];

  pages.forEach((page, pageIndex) => {
    const box = page.getCropBox();
    const rotation = page.getRotation().angle;
    const corners = pageCorners(box, rotation);
    const node = page.node;
    let hit = fromViewports(toJs(ctx, node.get(PDFName.of('VP'))), corners);
    if (!hit) {
      const lgi = toJs(ctx, node.get(PDFName.of('LGIDict')));
      if (lgi) hit = fromLgiDict(lgi, corners, box);
    }
    if (!hit && catalogLgi && (pageIndex === 0 || pages.length === 1)) hit = fromLgiDict(catalogLgi, corners, box);
    if (hit) frames.push({ pageIndex, pageBox: box, rotation, bbox: hit.bbox, toLngLat: hit.toLngLat, crs: hit.crs });
  });
  return { doc, frames };
}

export async function readGeoPdfGeoreference(buf: ArrayBuffer): Promise<GeoPdfInfo | null> {
  const { frames } = await readGeoPdfFrames(buf);
  const result: GeoPdfInfo = { pages: [] };
  for (const f of frames) {
    const corners = pageCorners(f.pageBox, f.rotation).map(f.toLngLat) as [LngLat, LngLat, LngLat, LngLat];
    const entry: GeoPdfInfo['pages'][number] = { pageIndex: f.pageIndex, corners };
    if (f.crs) entry.crs = f.crs;
    result.pages.push(entry);
  }
  return result.pages.length ? result : null;
}
