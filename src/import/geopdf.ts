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

export type Corners = [LngLat, LngLat, LngLat, LngLat];

export interface GeoPdfInfo {
  pages: {
    pageIndex: number;
    /** Whole page (crop box) as displayed: top-left, top-right, bottom-right, bottom-left. */
    corners: Corners;
    crs?: string;
    /**
     * The georeferenced map frame when it is smaller than the page (ISO /VP viewports), so the
     * legend and title block can be left out. `box` is [x1, y1, x2, y2] in PDF user space
     * (x1 < x2, y1 < y2); `corners` are the frame's corners as displayed, in the same order.
     */
    region?: { box: [number, number, number, number]; corners: Corners };
    /**
     * Page user space -> ground: lngLat = toWgs84(def, applyAffine(affine, [x, y])). Lets vector
     * content drawn on the page (the cutblock boundary) be placed on the map. See pageToLngLat.
     */
    ground: Ground;
  }[];
}

export interface Ground {
  def: string;
  affine: Affine;
}

/** A point in the page's PDF user space (as drawn, before /Rotate) -> [lng, lat]. */
export function pageToLngLat(ground: Ground, p: [number, number]): LngLat {
  return toWgs84(ground.def, applyAffine(ground.affine, p));
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

type Box = { x: number; y: number; width: number; height: number };

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
function groundFromControl(pagePts: [number, number][], lngLats: LngLat[]): Ground | null {
  if (pagePts.length < 3) return null;
  const c: LngLat = [
    lngLats.reduce((s, p) => s + p[0], 0) / lngLats.length,
    lngLats.reduce((s, p) => s + p[1], 0) / lngLats.length,
  ];
  const def = localUtmFor(c);
  const affine = fitAffine(pagePts, lngLats.map((p) => fromWgs84(def, p)));
  return affine ? { def, affine } : null;
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

type Hit = { corners: LngLat[]; ground: Ground; crs?: string; region?: { box: [number, number, number, number]; corners: LngLat[] } };

function fromViewports(vps: Js, corners: [number, number][], rotation: number): Hit | null {
  const list = Array.isArray(vps) ? vps : asDict(vps) ? [vps] : [];
  let best: (Hit & { area: number }) | null = null;
  for (const raw of list) {
    const vp = asDict(raw);
    if (!vp) continue;
    const measure = asDict(vp.Measure);
    if (!measure || (measure.Subtype !== 'GEO' && measure.Subtype !== undefined)) continue;
    const bb = nums(vp.BBox);
    if (bb.length !== 4) continue;
    const x1 = Math.min(bb[0], bb[2]), x2 = Math.max(bb[0], bb[2]);
    const y1 = Math.min(bb[1], bb[3]), y2 = Math.max(bb[1], bb[3]);
    if (x2 - x1 <= 0 || y2 - y1 <= 0) continue;
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
      // LPTS are fractions of the BBox *as written*: (0, 0) is its first corner. Writers such as
      // ArcGIS give the top edge first ([x0 yTop x1 yBottom]); sorting would flip the map.
      // This matches GDAL's PDF driver.
      const u = lpts[2 * i], v = lpts[2 * i + 1];
      pagePts.push([bb[0] + u * (bb[2] - bb[0]), bb[1] + v * (bb[3] - bb[1])]);
      const a = gpts[2 * i], b = gpts[2 * i + 1];
      lls.push(swapped ? [a, b] : [b, a]);
    }
    const ground = groundFromControl(pagePts, lls);
    if (!ground) continue;
    const ll = corners.map((p) => pageToLngLat(ground, p));
    const frame = pageCorners({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, rotation).map((p) => pageToLngLat(ground, p));
    if (!finiteCorners(ll)) continue;
    const area = (x2 - x1) * (y2 - y1);
    if (!best || area > best.area) {
      best = { corners: ll, ground, crs: crsName(asDict(measure.GCS)), area };
      if (finiteCorners(frame)) best.region = { box: [x1, y1, x2, y2], corners: frame };
    }
  }
  if (!best) return null;
  const { area: _area, ...hit } = best;
  return hit;
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

function fromLgiDict(raw: Js, corners: [number, number][]): Hit | null {
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
    // Some geographic LGIDicts use arc-seconds rather than degrees.
    if (geographic && corners.some((p) => { const [x, y] = applyAffine(t!, p); return Math.abs(x) > 180 || Math.abs(y) > 90; })) {
      t = t.map((v) => v / 3600) as Affine;
    }
    const ground: Ground = { def, affine: t };
    const ll = corners.map((p) => pageToLngLat(ground, p));
    if (finiteCorners(ll)) return { corners: ll, ground, crs: label };
  }
  return null;
}

// ---------------------------------------------------------------- entry

export async function loadPdf(buf: ArrayBuffer): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    throw new Error(`Could not read PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function readGeoPdfGeoreference(buf: ArrayBuffer): Promise<GeoPdfInfo | null> {
  return georeferenceOf(await loadPdf(buf));
}

export function georeferenceOf(doc: PDFDocument): GeoPdfInfo | null {
  const ctx = doc.context;
  const pages = doc.getPages();
  const catalogLgi = toJs(ctx, doc.catalog.get(PDFName.of('LGIDict')));
  const result: GeoPdfInfo = { pages: [] };

  pages.forEach((page, pageIndex) => {
    const box = page.getCropBox();
    const rotation = page.getRotation().angle;
    const corners = pageCorners(box, rotation);
    const node = page.node;
    let hit = fromViewports(toJs(ctx, node.get(PDFName.of('VP'))), corners, rotation);
    if (!hit) {
      const lgi = toJs(ctx, node.get(PDFName.of('LGIDict')));
      if (lgi) hit = fromLgiDict(lgi, corners);
    }
    if (!hit && catalogLgi && (pageIndex === 0 || pages.length === 1)) hit = fromLgiDict(catalogLgi, corners);
    if (hit) {
      const entry: GeoPdfInfo['pages'][number] = { pageIndex, corners: hit.corners as Corners, ground: hit.ground };
      if (hit.crs) entry.crs = hit.crs;
      if (hit.region) entry.region = { box: hit.region.box, corners: hit.region.corners as Corners };
      result.pages.push(entry);
    }
  });

  return result.pages.length ? result : null;
}
