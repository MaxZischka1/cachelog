/** KML / GeoJSON -> FeatureCollection -> plan pieces. Pure. */
import { DOMParser } from '@xmldom/xmldom';
import { kml } from '@tmcw/togeojson';
import type { GeoJSONFeature, GeoJSONFeatureCollection, GeoJSONGeometry, LngLat, Piece, Prescription } from '../core/types';
import { newImportId } from './ids';

export function kmlToGeoJSON(text: string): GeoJSONFeatureCollection {
  let doc;
  try {
    // Quiet handler: warnings/recoverable errors are ignored, fatal errors still throw.
    doc = new DOMParser({ onError: () => undefined }).parseFromString(text, 'text/xml');
  } catch (e) {
    throw new Error(`Could not read KML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!doc || !doc.documentElement) throw new Error('Could not read KML: not valid XML.');
  // togeojson accepts xmldom documents; its types reference the browser Document.
  const fc = kml(doc as unknown as Document);
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => ({
      type: 'Feature',
      geometry: (f.geometry as GeoJSONGeometry | null) ?? null,
      properties: (f.properties as Record<string, any> | null) ?? {},
      ...(f.id !== undefined ? { id: f.id } : {}),
    })),
  };
}

/** Accept a FeatureCollection, a single Feature, a bare geometry or GeometryCollection. */
export function normalizeGeoJSON(input: unknown): GeoJSONFeatureCollection {
  const o = input as any;
  if (!o || typeof o !== 'object' || typeof o.type !== 'string') {
    throw new Error('Not a GeoJSON file (missing "type").');
  }
  if (o.type === 'FeatureCollection') {
    if (!Array.isArray(o.features)) throw new Error('GeoJSON FeatureCollection has no "features" array.');
    return { type: 'FeatureCollection', features: o.features.flatMap((f: any) => normalizeGeoJSON(f).features) };
  }
  if (o.type === 'Feature') {
    if (o.geometry?.type === 'GeometryCollection') {
      return {
        type: 'FeatureCollection',
        features: (o.geometry.geometries ?? []).map((g: any) => ({ type: 'Feature', geometry: g, properties: o.properties ?? {} })),
      };
    }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: o.geometry ?? null, properties: o.properties ?? {}, ...(o.id !== undefined ? { id: o.id } : {}) }] };
  }
  if (o.type === 'GeometryCollection') {
    return { type: 'FeatureCollection', features: (o.geometries ?? []).map((g: any) => ({ type: 'Feature', geometry: g, properties: {} })) };
  }
  if (['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'].includes(o.type)) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: o, properties: {} }] };
  }
  throw new Error(`Unsupported GeoJSON type "${o.type}".`);
}

function nameOf(props: Record<string, any> | null): string | null {
  if (!props) return null;
  for (const k of ['name', 'Name', 'NAME', 'label', 'Label', 'LABEL', 'title', 'Title']) {
    const v = props[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(/,(?=\d{3}\b)/g, ''));
    if (m) {
      const n = parseFloat(m[0].replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** Look for obvious prescription keys (case-insensitive). */
function prescriptionOf(props: Record<string, any> | null): Prescription | undefined {
  if (!props) return undefined;
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) lower[k.toLowerCase().replace(/[\s-]+/g, '_')] = v;
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const n = num(lower[k]);
      if (n !== undefined && n > 0) return n;
    }
    return undefined;
  };
  const densityPerHa = pick(['density', 'density_per_ha', 'densityperha', 'density_ha', 'sph', 'stems_per_ha', 'trees_per_ha', 'target_density']);
  const spacingM = pick(['spacing', 'spacing_m', 'spacingm', 'inter_tree_distance', 'itd']);
  let species: string[] | undefined;
  const sp = lower['species'] ?? lower['spp'];
  if (typeof sp === 'string' && sp.trim()) species = sp.split(/[,;/ ]+/).map((s) => s.trim()).filter(Boolean);
  else if (Array.isArray(sp)) species = sp.map(String).filter(Boolean);
  if (densityPerHa === undefined && spacingM === undefined && !species) return undefined;
  const p: Prescription = {};
  if (densityPerHa !== undefined) p.densityPerHa = densityPerHa;
  if (spacingM !== undefined) p.spacingM = spacingM;
  if (species) p.species = species;
  return p;
}

/** Outer ring as LngLat[] without the repeated closing point (and without z). */
function cleanRing(ring: unknown): LngLat[] | null {
  if (!Array.isArray(ring)) return null;
  const pts: LngLat[] = [];
  for (const c of ring) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const x = Number(c[0]), y = Number(c[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = pts[pts.length - 1];
    if (last && last[0] === x && last[1] === y) continue; // consecutive duplicate
    pts.push([x, y]);
  }
  while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts.length >= 3 ? pts : null;
}

function polygonsOf(f: GeoJSONFeature): unknown[][] {
  const g = f.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates ?? [];
  if ((g as any).type === 'GeometryCollection') {
    return ((g as any).geometries ?? []).flatMap((sub: GeoJSONGeometry) => polygonsOf({ type: 'Feature', geometry: sub, properties: null }));
  }
  return [];
}

/** Polygons and MultiPolygon parts -> pieces. Holes are ignored (pieces are simple rings). */
export function featuresToPieces(fc: GeoJSONFeatureCollection): Piece[] {
  const pieces: Piece[] = [];
  for (const f of fc.features ?? []) {
    const polys = polygonsOf(f);
    const base = nameOf(f.properties);
    const prescription = prescriptionOf(f.properties);
    const desc = f.properties?.description;
    polys.forEach((poly, partIdx) => {
      const ring = cleanRing(Array.isArray(poly) ? poly[0] : null);
      if (!ring) return;
      const n = pieces.length + 1;
      const name = base ? (polys.length > 1 ? `${base} (${partIdx + 1})` : base) : `Piece ${n}`;
      const piece: Piece = { id: newImportId(), name, polygon: ring };
      if (prescription) piece.prescription = { ...prescription, ...(prescription.species ? { species: [...prescription.species] } : {}) };
      if (typeof desc === 'string' && desc.trim() && !/<[a-z][\s\S]*>/i.test(desc)) piece.notes = desc.trim();
      pieces.push(piece);
    });
  }
  return pieces;
}
