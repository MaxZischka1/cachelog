/**
 * Turn a GeoPDF's drawn layers into map features: each layer with closed shapes inside the map
 * frame becomes a candidate (planting units, block outline...), with a guess at which one holds
 * the pieces to plant. Pure.
 */
import type { PDFDocument } from 'pdf-lib';
import { pointInPolygon, polygonAreaHa } from '../core/plan';
import type { GeoJSONFeatureCollection, LngLat } from '../core/types';
import type { GeoPdfFrame } from './geopdf';
import { extractLayerPaths, type PdfLayerPaths, type Pt } from './pdfVectors';

export interface PdfPolygonLayer {
  name: string;
  /** Polygons as GeoJSON coordinates: [outer ring, ...holes], lon/lat, closed rings. */
  polygons: LngLat[][][];
  areaHa: number;
  /** Higher = more likely to be the planting units / the block to plant. */
  score: number;
}

/** Shapes smaller than this are symbols, labels or slivers, not something to plant. */
const MIN_HA = 0.1;

const POSITIVE: [RegExp, number][] = [
  [/planting|prescription|treatment|\bunits?\b|\bpu\b/i, 6],
  [/highlight|silv|selected|target|opening/i, 3],
  [/\bp\d+\b|cut ?block|\bblocks?\b|boundary|outline/i, 2],
];
const NEGATIVE = /harvest|as ?built|label|legend|township|grid|rectangle|frame|reservation|wildlife|contour|stream|river|lake|hydro|road|dids|crossing|seed ?zone|cutline|pipeline|wellsite|breeding|scale|north|text|picture|group|imagery/i;

export function scoreLayerName(name: string): number {
  if (NEGATIVE.test(name)) return -5;
  return POSITIVE.reduce((s, [re, w]) => s + (re.test(name) ? w : 0), 0);
}

const key = (r: LngLat[]) => r.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join(';');

function inside(p: Pt, b: [number, number, number, number], tol: number) {
  return p[0] >= b[0] - tol && p[0] <= b[2] + tol && p[1] >= b[1] - tol && p[1] <= b[3] + tol;
}

/** Group a layer's closed rings into polygons: a ring inside another ring of the layer is its hole. */
function toPolygons(rings: LngLat[][]): LngLat[][][] {
  const sorted = [...rings].sort((a, b) => polygonAreaHa(b) - polygonAreaHa(a));
  const polys: LngLat[][][] = [];
  for (const r of sorted) {
    const parent = polys.find((p) => p.length && pointInPolygon(r[0], p[0]) && polygonAreaHa(p[0]) > polygonAreaHa(r));
    if (parent) parent.push(r);
    else polys.push([r]);
  }
  return polys;
}

export function polygonLayers(groups: PdfLayerPaths[], frame: GeoPdfFrame): PdfPolygonLayer[] {
  const byName = new Map<string, Map<string, LngLat[]>>();
  for (const g of groups) {
    const name = g.layers[g.layers.length - 1];
    for (const path of g.paths) {
      path.parts.forEach((part, i) => {
        if (!path.closed[i] || part.length < 4) return;
        if (!part.every((p) => inside(p, frame.bbox, 1))) return;
        const ring = part.map(frame.toLngLat);
        const first = ring[0], last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
        if (polygonAreaHa(ring) < MIN_HA) return;
        let m = byName.get(name);
        if (!m) byName.set(name, (m = new Map()));
        m.set(key(ring), ring); // fill and outline draw the same ring twice
      });
    }
  }
  const out: PdfPolygonLayer[] = [];
  for (const [name, rings] of byName) {
    const polygons = toPolygons([...rings.values()]);
    const areaHa = polygons.reduce((s, p) => s + polygonAreaHa(p[0]) - p.slice(1).reduce((h, r) => h + polygonAreaHa(r), 0), 0);
    out.push({ name, polygons, areaHa, score: scoreLayerName(name) });
  }
  return out.sort((a, b) => b.score - a.score || a.areaHa - b.areaHa);
}

/** Polygon layers from one georeferenced page. */
export function geoPdfPolygonLayers(doc: PDFDocument, frame: GeoPdfFrame): PdfPolygonLayer[] {
  return polygonLayers(extractLayerPaths(doc, frame.pageIndex), frame);
}

/** The layer most likely to be the area to plant, or null when nothing scores above zero. */
export function bestPlantingLayer(layers: PdfPolygonLayer[]): PdfPolygonLayer | null {
  const best = layers.find((l) => l.score > 0 && l.polygons.length > 0);
  return best ?? null;
}

export function layerToGeoJSON(l: PdfPolygonLayer): GeoJSONFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: l.polygons.map((coords, i) => ({
      type: 'Feature',
      properties: { name: l.polygons.length > 1 ? `${shortName(l.name)} ${i + 1}` : shortName(l.name), layer: l.name },
      geometry: { type: 'Polygon', coordinates: coords },
    })),
  };
}

/** "PLANTING: Planting Prescription Units" -> "Planting Prescription Units". */
export function shortName(layer: string): string {
  const s = layer.includes(':') ? layer.slice(layer.indexOf(':') + 1) : layer;
  return s.replace(/\s+-\s+.*$/, '').trim() || layer;
}
