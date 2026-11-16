import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { readPagePaths } from './pdfPaths';

/** A page whose content stream is `content`, with layers OC1 "Plant Cutblock" and OC2 "Roads". */
async function pdfWith(content: string, opts: { form?: string; formOc?: boolean; split?: boolean } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 600]);
  const ctx = doc.context;
  const ocg = (name: string) => ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(name) }));
  const cut = ocg('Plant Cutblock');
  const roads = ocg('Roads');
  const res = ctx.obj({ Properties: { OC1: cut, OC2: roads } });
  if (opts.form) {
    const form = ctx.flateStream(opts.form, {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 600, 600], Matrix: [2, 0, 0, 2, 10, 0],
      ...(opts.formOc ? { OC: cut } : {}),
    });
    res.set(PDFName.of('XObject'), ctx.obj({ Fm1: ctx.register(form) }));
  }
  page.node.set(PDFName.of('Resources'), res);
  if (opts.split) {
    // Content split across two streams in the middle of a path.
    const half = content.indexOf('l') + 1;
    page.node.set(PDFName.of('Contents'), ctx.obj([ctx.register(ctx.flateStream(content.slice(0, half))), ctx.register(ctx.stream(content.slice(half)))]));
  } else {
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  }
  return PDFDocument.load(await doc.save());
}

describe('readPagePaths', () => {
  test('paths with their layer, with cm and q/Q applied', async () => {
    const doc = await pdfWith(`
      /OC /OC1 BDC
      q 1 0 0 1 100 50 cm
      0 0 m 10 0 l 10 10 l h S
      Q
      EMC
      /OC /OC2 BDC 0 0 m 5 5 l S EMC
      20 20 30 40 re f
    `);
    const shapes = readPagePaths(doc, 0);
    expect(shapes).toHaveLength(3);
    expect(shapes[0]).toEqual({ layers: ['Plant Cutblock'], stroked: true, filled: false, parts: [{ closed: true, points: [[100, 50], [110, 50], [110, 60]] }] });
    expect(shapes[1].layers).toEqual(['Roads']);
    expect(shapes[1].parts[0].closed).toBe(false);
    expect(shapes[2]).toMatchObject({ layers: [], filled: true, stroked: false });
    expect(shapes[2].parts[0]).toEqual({ closed: true, points: [[20, 20], [50, 20], [50, 60], [20, 60]] });
  });

  test('clip paths are not shapes; strings, dicts and inline images do not confuse it', async () => {
    const doc = await pdfWith(`
      q 0 0 600 600 re W n
      BT /F1 12 Tf (a \\) tricky \\( (nested) 0 0 m 9 9 l S EMC) Tj ET
      /Span << /MCID 0 /Alt (x) >> BDC EMC
      BI /W 2 /H 1 /BPC 8 /CS /G ID 0 0 m 9 9 l S\x00\xff EI
      /OC /OC1 BDC 1 1 m 2 2 l 3 1 l 1 1 l S EMC
      Q
    `);
    const shapes = readPagePaths(doc, 0);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].layers).toEqual(['Plant Cutblock']);
    // Ends where it started: closed.
    expect(shapes[0].parts[0].closed).toBe(true);
  });

  test('curves are flattened through their end point', async () => {
    const doc = await pdfWith('/OC /OC1 BDC 0 0 m 0 10 10 10 10 0 c S EMC');
    const pts = readPagePaths(doc, 0)[0].parts[0].points;
    expect(pts.length).toBeGreaterThan(4);
    expect(pts[pts.length - 1]).toEqual([10, 0]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(7.5, 5);
  });

  test('form XObjects are followed with their matrix and layer', async () => {
    const doc = await pdfWith('q 1 0 0 1 0 100 cm /Fm1 Do Q', { form: '0 0 m 10 0 l 10 10 l h S', formOc: true });
    const [s] = readPagePaths(doc, 0);
    expect(s.layers).toEqual(['Plant Cutblock']);
    expect(s.parts[0].points).toEqual([[10, 100], [30, 100], [30, 120]]);
  });

  test('content split across streams; keep filter', async () => {
    const doc = await pdfWith('/OC /OC1 BDC 0 0 m 10 0 l 10 10 l h S EMC /OC /OC2 BDC 0 0 m 1 1 l S EMC', { split: true });
    expect(readPagePaths(doc, 0)).toHaveLength(2);
    const kept = readPagePaths(doc, 0, { keep: (ls) => ls.includes('Plant Cutblock') });
    expect(kept).toHaveLength(1);
    expect(kept[0].parts[0].points).toHaveLength(3);
  });
});
