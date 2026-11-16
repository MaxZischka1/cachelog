/**
 * Finds the cutblock boundary among a GeoPDF's vector layers and turns it into ground polygons.
 * Pure.
 *
 * Licensee map sheets keep the block outline as its own PDF layer ("Plant Cutblock", "Cutblock",
 * "Treatment Unit", "Block Boundary"). The outline is usually stroked as one or more closed lines;
 * lines inside it are islands that are not planted (wet areas, reserves), so they become holes.
 */
import type { PDFDocument } from 'pdf-lib';
import type { GeoJSONFeatureCollection, LngLat, VectorLayer } from '../core/types';
import { polygonAreaHa } from '../core/plan/geo';
import { pageToLngLat, type Ground } from './geopdf';
import { newImportId } from './ids';
import { readPagePaths, type PdfShape, type Pt } from './pdfPaths';

export interface CutblockBoundary {
  /** The PDF layer it was read from, e.g. "Plant Cutblock". */
  layer: string;
  /** Each polygon is [outer ring, ...island rings]; rings are not closed (first point not repeated). */
  polygons: LngLat[][][];
  /** Area inside the outer rings, islands taken out. */
  areaHa: number;
  /** Area of the islands that were taken out. */
  islandsHa: number;
}

const NOT_BOUNDARY = /label|text|annot|anno\b|buffer|road|trail|stream|river|creek|lake|wetland|culvert|bridge|contour|retention|reserve|wtp|riparian|image|ortho|photo|hillshade|dem\b|grid|graticule|legend|scale|north|title|plot|survey|access|landing|deck|pipeline|powerline|seismic|cutline/i;

/**
 * How strongly a PDF layer name says "the block to plant". 0: not a boundary layer.
 * The first layer with the highest score wins.
 */
export function boundaryLayerScore(name: string): number {
  // Also the keep filter for readPagePaths: a shape in any layer scoring > 0 may be the block.
  const s = name.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || NOT_BOUNDARY.test(s)) return 0;
  if (/\bplant(ing|able|ed)?\b.*\b(cut ?blocks?|blocks?|areas?|units?|boundar(y|ies)|polygons?|net|nar)\b/i.test(s)) return 4;
  if (/\bcut ?blocks?\b|\btreatment units?\b|\bharvest (areas?|units?|boundar(y|ies))\b|\bblock boundar(y|ies)\b|\bnet (area|plantable)|\bNAR\b|\bsilv(iculture)? (units?|polygons?)\b|\bSU\b|\bTU\b/i.test(s)) return 3;
  if (/\bboundar(y|ies)\b|\bopenings?\b|\bblocks?\b|\bunits?\b|\bpolygons?\b/i.test(s)) return 2;
  return 0;
}

/** Outer rings smaller than this are labels, symbols or slivers, not a block. */
const MIN_OUTER_M2 = 500;
/** Islands smaller than this are ignored. */
const MIN_ISLAND_M2 = 25;

/** `page`: page points (containment is the same on the page as on the ground). `area`: ground m². */
type Ring = { page: Pt[]; ground: LngLat[]; area: number; box: [number, number, number, number] };

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
  }
  return out;
}

/** Closed rings from a layer's lines: closed ones as they are, open ones joined end to end. */
export function ringsFromShapes(shapes: PdfShape[], tolerance = 0.75): Pt[][] {
  const rings: Pt[][] = [];
  const open: Pt[][] = [];
  for (const s of shapes) {
    for (const part of s.parts) {
      const pts = dedupe(part.points);
      if (pts.length < 2) continue;
      if (part.closed || (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) <= tolerance)) {
        if (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) <= tolerance) pts.pop();
        if (pts.length >= 3) rings.push(pts);
      } else {
        open.push(pts);
      }
    }
  }
  // Lines that together close a ring (an outline drawn in pieces, e.g. split at the map frame).
  while (open.length) {
    let chain = open.shift()!;
    for (let grew = true; grew && dist(chain[0], chain[chain.length - 1]) > tolerance;) {
      grew = false;
      const end = chain[chain.length - 1];
      for (let k = 0; k < open.length; k++) {
        const o = open[k];
        if (dist(end, o[0]) <= tolerance) chain = [...chain, ...o.slice(1)];
        else if (dist(end, o[o.length - 1]) <= tolerance) chain = [...chain, ...o.slice(0, -1).reverse()];
        else if (dist(chain[0], o[o.length - 1]) <= tolerance) chain = [...o.slice(0, -1), ...chain];
        else if (dist(chain[0], o[0]) <= tolerance) chain = [...o.slice(1).reverse(), ...chain];
        else continue;
        open.splice(k, 1);
        grew = true;
        break;
      }
    }
    if (chain.length > 3 && dist(chain[0], chain[chain.length - 1]) <= tolerance) {
      chain.pop();
      rings.push(chain);
    }
  }
  return rings;
}

function inside(p: [number, number], ring: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Most of `a`'s vertices lie inside `b` (robust to rings that share a stretch of edge). */
function within(a: Ring, b: Ring): boolean {
  const step = Math.max(1, Math.floor(a.page.length / 15));
  let yes = 0, all = 0;
  for (let k = 0; k < a.page.length; k += step, all++) if (inside(a.page[k], b.page)) yes++;
  return yes * 2 > all;
}

/** The same outline drawn twice (a fill and its outline): same extent and area. */
const sameRing = (a: Ring, b: Ring) =>
  Math.abs(a.area - b.area) <= 0.002 * Math.max(a.area, b.area) && a.box.every((v, i) => Math.abs(v - b.box[i]) <= 1);

function boxOf(pts: Pt[]): [number, number, number, number] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Outer rings with their islands (even-odd nesting), areas in square metres. */
function nest(rings: Ring[]): { outer: Ring; islands: Ring[] }[] {
  const sorted = [...rings].sort((a, b) => b.area - a.area);
  const unique: Ring[] = [];
  for (const r of sorted) if (!unique.some((u) => sameRing(u, r))) unique.push(r); // fill + outline of one ring
  const depth = new Map<Ring, number>();
  const parent = new Map<Ring, Ring | null>();
  for (const r of unique) {
    // The smallest larger ring that contains it.
    let p: Ring | null = null;
    for (const big of unique) {
      if (big === r || big.area <= r.area) continue;
      if (within(r, big) && (!p || big.area < p.area)) p = big;
    }
    parent.set(r, p);
    depth.set(r, p ? depth.get(p)! + 1 : 0);
  }
  const out: { outer: Ring; islands: Ring[] }[] = [];
  for (const r of unique) if (depth.get(r)! % 2 === 0 && r.area >= MIN_OUTER_M2) out.push({ outer: r, islands: [] });
  for (const r of unique) {
    if (depth.get(r)! % 2 === 0 || r.area < MIN_ISLAND_M2) continue;
    out.find((o) => o.outer === parent.get(r))?.islands.push(r);
  }
  return out;
}

/**
 * The cutblock from the shapes of a GeoPDF page. `toLngLat` places a page point on the ground.
 * Null when no layer looks like a block boundary or it has no closed outline of block size.
 */
export function findCutblock(shapes: PdfShape[], toLngLat: (p: Pt) => LngLat): CutblockBoundary | null {
  const byLayer = new Map<string, PdfShape[]>();
  for (const s of shapes) {
    // A layer inside a group such as "Labels" is never the boundary, whatever its own name.
    if (s.layers.some((l) => NOT_BOUNDARY.test(l))) continue;
    // The innermost layer that looks like a boundary (layers nest, e.g. "Layers" > "Plant Cutblock").
    const name = [...s.layers].reverse().find((l) => boundaryLayerScore(l) > 0);
    if (name) byLayer.set(name, [...(byLayer.get(name) ?? []), s]);
  }
  const layers = [...byLayer.keys()].sort((a, b) => boundaryLayerScore(b) - boundaryLayerScore(a));
  for (const layer of layers) {
    const rings = ringsFromShapes(byLayer.get(layer)!);
    if (!rings.length) continue;
    const rs: Ring[] = rings.map((page) => {
      const ground = page.map(toLngLat);
      // The app's own polygon area, so the cutblock and its pieces add up the same way.
      return { page, ground, area: polygonAreaHa(ground) * 10_000, box: boxOf(page) };
    });
    const polys = nest(rs);
    if (!polys.length) continue;
    const outerM2 = polys.reduce((s, p) => s + p.outer.area, 0);
    const islandsM2 = polys.reduce((s, p) => s + p.islands.reduce((t, r) => t + r.area, 0), 0);
    return {
      layer,
      polygons: polys.map((p) => [p.outer.ground, ...p.islands.map((r) => r.ground)]),
      areaHa: round2((outerM2 - islandsM2) / 10_000),
      islandsHa: round2(islandsM2 / 10_000),
    };
  }
  return null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const closed = (ring: LngLat[]): LngLat[] => [...ring, ring[0]];

/** The boundary as GeoJSON for a map layer: one Polygon feature per outline, islands as holes. */
export function cutblockGeoJSON(b: CutblockBoundary, name: string): GeoJSONFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: b.polygons.map((rings, i) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: rings.map(closed) },
      properties: { name: b.polygons.length > 1 ? `${name} (${i + 1})` : name, role: 'cutblock', sourceLayer: b.layer },
    })),
  };
}

/** True when a shape in these PDF layers could be the boundary (the readPagePaths keep filter). */
export function mayBeBoundary(layers: string[]): boolean {
  return !layers.some((l) => NOT_BOUNDARY.test(l)) && layers.some((l) => boundaryLayerScore(l) > 0);
}

/** The cutblock drawn on a georeferenced GeoPDF page, or null. */
export function cutblockFromPdf(doc: PDFDocument, page: { pageIndex: number; ground: Ground }): CutblockBoundary | null {
  const shapes = readPagePaths(doc, page.pageIndex, { keep: mayBeBoundary });
  return findCutblock(shapes, (p) => pageToLngLat(page.ground, p));
}

/** The map layer for a cutblock. */
export function cutblockLayer(b: CutblockBoundary): VectorLayer {
  return { id: newImportId(), kind: 'vector', name: 'Cutblock', role: 'cutblock', areaHa: b.areaHa, geojson: cutblockGeoJSON(b, 'Cutblock') };
}
