import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import proj4 from 'proj4';
import type { LngLat } from '../core/types';
import { readGeoPdfGeoreference } from './index';

const UTM10 = '+proj=utm +zone=10 +ellps=GRS80 +units=m +no_defs';
const inv = (e: number, n: number) => proj4(UTM10, 'WGS84', [e, n]) as LngLat;

function metres(a: LngLat, b: LngLat): number {
  const R = 6371008.8, r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function expectNear(actual: LngLat[], expected: LngLat[], tolM = 1) {
  expect(actual).toHaveLength(4);
  actual.forEach((p, i) => expect(metres(p, expected[i])).toBeLessThan(tolM));
}

/**
 * Page 612x792 pt; map frame (viewport BBox) 36,36 - 576,756 at 10 m/pt in UTM 10N with the
 * frame's bottom-left at E 500000, N 5800000. Page corners therefore sit 360 m outside the frame.
 */
const E0 = 500000, N0 = 5800000, M = 10, X1 = 36, Y1 = 36, X2 = 576, Y2 = 756;
const pageToUtm = (x: number, y: number): LngLat => inv(E0 + (x - X1) * M, N0 + (y - Y1) * M);
const EXPECTED: LngLat[] = [pageToUtm(0, 792), pageToUtm(612, 792), pageToUtm(612, 0), pageToUtm(0, 0)];

async function avenzaStylePdf(opts: { rotate?: number } = {}): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (opts.rotate) page.setRotation(degrees(opts.rotate));
  const ctx = doc.context;
  // GPTS: lat, lon of the frame corners in LPTS order (unit square of the BBox).
  const lpts = [0, 0, 0, 1, 1, 1, 1, 0];
  const gpts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [lon, lat] = inv(E0 + lpts[2 * i] * (X2 - X1) * M, N0 + lpts[2 * i + 1] * (Y2 - Y1) * M);
    gpts.push(lat, lon);
  }
  const gcs = ctx.obj({ Type: 'PROJCS', EPSG: 26910 });
  gcs.set(PDFName.of('WKT'), PDFString.of('PROJCS["NAD83 / UTM zone 10N",GEOGCS["NAD83"]]'));
  const measure = ctx.obj({ Type: 'Measure', Subtype: 'GEO', Bounds: lpts, GPTS: gpts, LPTS: lpts, GCS: ctx.register(gcs) });
  const mapVp = ctx.obj({ Type: 'Viewport', BBox: [X1, Y1, X2, Y2], Measure: measure });
  // A decoy viewport (legend) without georeferencing.
  const legend = ctx.obj({ Type: 'Viewport', BBox: [0, 0, 30, 30] });
  page.node.set(PDFName.of('VP'), ctx.obj([legend, ctx.register(mapVp)]));
  const bytes = await doc.save();
  return bytes.slice().buffer as ArrayBuffer;
}

describe('readGeoPdfGeoreference', () => {
  test('ISO 32000 /VP /Measure /GEO (GPTS + LPTS)', async () => {
    const info = await readGeoPdfGeoreference(await avenzaStylePdf());
    expect(info).not.toBeNull();
    expect(info!.pages).toHaveLength(1);
    expect(info!.pages[0].pageIndex).toBe(0);
    expect(info!.pages[0].crs).toBe('EPSG:26910');
    expectNear(info!.pages[0].corners, EXPECTED);
  });

  test('page /Rotate 90 rotates the corner order', async () => {
    const info = await readGeoPdfGeoreference(await avenzaStylePdf({ rotate: 90 }));
    const [tl, tr, br, bl] = EXPECTED;
    expectNear(info!.pages[0].corners, [bl, tl, tr, br]);
  });

  test('TerraGo LGIDict with CTM and UTM projection', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const ctx = doc.context;
    // CTM: page point -> UTM (same geometry as above).
    const ctm = [M, 0, 0, M, E0 - X1 * M, N0 - Y1 * M].map((v) => PDFString.of(String(v)));
    const proj = ctx.obj({ Type: 'Projection' });
    proj.set(PDFName.of('ProjectionType'), PDFString.of('UT'));
    proj.set(PDFName.of('Zone'), ctx.obj(10));
    proj.set(PDFName.of('Hemisphere'), PDFString.of('N'));
    proj.set(PDFName.of('Datum'), PDFString.of('NAR'));
    const lgi = ctx.obj({ Type: 'LGIDict', Version: '2.1' });
    lgi.set(PDFName.of('CTM'), ctx.obj(ctm));
    lgi.set(PDFName.of('Projection'), proj);
    page.node.set(PDFName.of('LGIDict'), ctx.obj([lgi]));
    const info = await readGeoPdfGeoreference((await doc.save()).slice().buffer as ArrayBuffer);
    expect(info!.pages[0].crs).toMatch(/LGIDict UT zone 10N/);
    expectNear(info!.pages[0].corners, EXPECTED);
  });

  test('plain PDF -> null', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    expect(await readGeoPdfGeoreference((await doc.save()).slice().buffer as ArrayBuffer)).toBeNull();
  });

  test('not a PDF -> readable error', async () => {
    await expect(readGeoPdfGeoreference(new TextEncoder().encode('hello').buffer as ArrayBuffer)).rejects.toThrow(/Could not read PDF/);
  });
});
