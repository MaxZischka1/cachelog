import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import proj4 from 'proj4';
import { polygonAreaHa } from '../core/plan';
import type { LngLat } from '../core/types';
import { boundaryLayerScore, cutblockFromPdf, cutblockGeoJSON, cutblockLayer, findCutblock, ringsFromShapes } from './cutblock';
import { georeferenceOf, pageToLngLat } from './geopdf';
import type { PdfShape, Pt } from './pdfPaths';

// 10 m per point in UTM 11N: page (0, 0) is E 500000, N 6000000.
const UTM11 = '+proj=utm +zone=11 +ellps=GRS80 +units=m +no_defs';
const ground = (p: Pt): LngLat => proj4(UTM11, 'WGS84', [500000 + p[0] * 10, 6000000 + p[1] * 10]) as LngLat;
const sq = (x: number, y: number, s: number): Pt[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const shape = (layers: string[], ...parts: { points: Pt[]; closed: boolean }[]): PdfShape => ({ layers, parts, stroked: true, filled: false });
const ring = (points: Pt[]) => ({ points, closed: true });

describe('boundaryLayerScore', () => {
  test.each([
    ['Plant Cutblock', 4],
    ['Planting_Area', 4],
    ['Plantable units', 4],
    ['Cutblock', 3],
    ['Cut Block Boundary', 3],
    ['Treatment Unit', 3],
    ['Block Boundary', 3],
    ['Openings - Default', 2],
    ['Boundary', 2],
    ['Retention', 0],
    ['Opening Labels - Default', 0],
    ['Roads', 0],
    ['Image', 0],
    ['Trapper Trail', 0],
    ['Other 3', 0],
  ])('%s -> %i', (name, score) => expect(boundaryLayerScore(name)).toBe(score));
});

describe('findCutblock', () => {
  test('outer ring with an island; labels, retention and small rings are left out', () => {
    const shapes = [
      shape(['Layers', 'Plant Cutblock'], ring(sq(100, 100, 100)), ring(sq(140, 140, 10)), ring(sq(400, 400, 1))),
      // Same outline painted again as a fill: counted once.
      { ...shape(['Layers', 'Plant Cutblock'], ring(sq(100, 100, 100))), filled: true, stroked: false },
      shape(['Layers', 'Retention'], ring(sq(0, 0, 300))),
      shape(['Layers', 'Labels', 'Openings - Default'], ring(sq(0, 0, 500))),
    ];
    const b = findCutblock(shapes, ground)!;
    expect(b.layer).toBe('Plant Cutblock');
    expect(b.polygons).toHaveLength(1);
    expect(b.polygons[0]).toHaveLength(2); // outer + island
    // 1 km square = 100 ha less a 1 ha island, in UTM metres; on the ground 1/0.9996² larger.
    expect(b.areaHa).toBeCloseTo(99 / 0.9996 ** 2, 1);
    expect(b.islandsHa).toBeCloseTo(1, 1);
  });

  test('a better-named layer wins; a lower one is used when it is all there is', () => {
    const opening = shape(['Openings'], ring(sq(0, 0, 300)));
    const cut = shape(['Cutblock'], ring(sq(100, 100, 50)));
    expect(findCutblock([opening, cut], ground)!.layer).toBe('Cutblock');
    expect(findCutblock([opening], ground)!.layer).toBe('Openings');
  });

  test('two separate outlines, and an island inside an island counted as block again', () => {
    const shapes = [shape(['Cutblock'], ring(sq(0, 0, 100)), ring(sq(200, 0, 50)), ring(sq(20, 20, 60)), ring(sq(40, 40, 20)))];
    const b = findCutblock(shapes, ground)!;
    expect(b.polygons.map((p) => p.length).sort()).toEqual([1, 1, 2]);
  });

  test('nothing that looks like a block', () => {
    expect(findCutblock([shape(['Roads'], ring(sq(0, 0, 100)))], ground)).toBeNull();
    expect(findCutblock([shape(['Cutblock'], { points: [[0, 0], [100, 0], [100, 100]], closed: false })], ground)).toBeNull();
    expect(findCutblock([shape(['Cutblock'], ring(sq(0, 0, 1)))], ground)).toBeNull(); // 100 m²
  });
});

describe('ringsFromShapes', () => {
  test('an outline drawn in pieces is joined, in either direction', () => {
    const rings = ringsFromShapes([
      shape(['Cutblock'], { points: [[0, 0], [10, 0], [10, 10]], closed: false }),
      shape(['Cutblock'], { points: [[0, 0], [0, 10]], closed: false }), // reversed piece
      shape(['Cutblock'], { points: [[10, 10.2], [0, 10]], closed: false }),
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4); // the 0.2 pt gap is joined, not kept as a corner
  });

  test('a line ending where it started is a ring even without h', () => {
    expect(ringsFromShapes([shape(['x'], { points: [...sq(0, 0, 10), [0, 0]], closed: false })])).toEqual([sq(0, 0, 10)]);
  });
});

/** A GeoPDF: map frame 0..600 pt at 10 m/pt in UTM 11N, cutblock layer drawn inside a form. */
async function geoPdf(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const lpts = [0, 0, 0, 1, 1, 1, 1, 0];
  const gpts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [lon, lat] = ground([lpts[2 * i] * 600, lpts[2 * i + 1] * 600]);
    gpts.push(lat, lon);
  }
  const measure = ctx.obj({ Type: 'Measure', Subtype: 'GEO', GPTS: gpts, LPTS: lpts, GCS: ctx.obj({ Type: 'PROJCS', EPSG: 26911 }) });
  page.node.set(PDFName.of('VP'), ctx.obj([ctx.obj({ Type: 'Viewport', BBox: [0, 0, 600, 600], Measure: measure })]));
  const cut = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Plant Cutblock') }));
  const form = ctx.flateStream('100 100 m 200 100 l 200 200 l 100 200 l h 140 140 m 150 140 l 150 150 l 140 150 l h S', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792],
  });
  page.node.set(PDFName.of('Resources'), ctx.obj({ Properties: { OC6: cut }, XObject: { Fm0: ctx.register(form) } }));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('/OC /OC6 BDC q 0 1 0.8 RG 2 w /Fm0 Do Q EMC')));
  return PDFDocument.load(await doc.save());
}

describe('cutblockFromPdf', () => {
  test('reads the outline from a GeoPDF and places it on the ground', async () => {
    const doc = await geoPdf();
    const page = georeferenceOf(doc)!.pages[0];
    expect(pageToLngLat(page.ground, [100, 100])[0]).toBeCloseTo(ground([100, 100])[0], 7);
    const b = cutblockFromPdf(doc, page)!;
    expect(b.layer).toBe('Plant Cutblock');
    expect(b.areaHa).toBeCloseTo(99 / 0.9996 ** 2, 1);
    const [outer] = b.polygons[0];
    outer.forEach((p, i) => {
      const e = ground(sq(100, 100, 100)[i]);
      expect(Math.abs(p[0] - e[0])).toBeLessThan(1e-6);
      expect(Math.abs(p[1] - e[1])).toBeLessThan(1e-6);
    });
    // The map layer: a closed polygon with its island as a hole, and the net area.
    const layer = cutblockLayer(b);
    expect(layer).toMatchObject({ kind: 'vector', name: 'Cutblock', role: 'cutblock', areaHa: b.areaHa });
    const poly = layer.geojson.features[0].geometry!;
    expect(poly.type).toBe('Polygon');
    expect(poly.coordinates).toHaveLength(2);
    expect(poly.coordinates[0][0]).toEqual(poly.coordinates[0][4]);
    // Same area as the app's own polygon maths.
    expect(polygonAreaHa(poly.coordinates[0]) - polygonAreaHa(poly.coordinates[1])).toBeCloseTo(b.areaHa, 1);
  });

  test('a map without a cutblock layer', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(cutblockFromPdf(doc, { pageIndex: 0, ground: { def: '+proj=longlat +datum=WGS84 +no_defs', affine: [1, 0, 0, 0, 1, 0] } })).toBeNull();
  });

  test('GeoJSON names several outlines apart', () => {
    const fc = cutblockGeoJSON({ layer: 'x', polygons: [[sq(0, 0, 1)], [sq(5, 5, 1)]], areaHa: 1, islandsHa: 0 }, 'Cutblock');
    expect(fc.features.map((f) => f.properties!.name)).toEqual(['Cutblock (1)', 'Cutblock (2)']);
  });
});
