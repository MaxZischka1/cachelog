/**
 * Reads the vector lines drawn on a PDF page, with the PDF layer (optional content group) each
 * one is drawn in. Pure (pdf-lib only), so it runs the same on the phone and under Jest.
 *
 * Used to pull the cutblock boundary out of a GeoPDF: ArcGIS, QGIS and Avenza exports keep each
 * map layer as a PDF layer ("Plant Cutblock", "Retention", "Roads"), drawn as ordinary paths.
 * Only geometry is kept: text, images and colours are skipped. Coordinates are PDF user space
 * of the page (the transforms in the content stream applied), the space GeoPDF georeferencing uses.
 */
import {
  decodePDFRawStream, PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString,
  type PDFDocument, type PDFObject,
} from 'pdf-lib';

export type Pt = [number, number];

export interface PdfPolyline {
  points: Pt[];
  /** Closed with h, s, b, re, or ending where it started. */
  closed: boolean;
}

export interface PdfShape {
  /** Names of the PDF layers it is drawn in, outermost first. Empty: not in any layer. */
  layers: string[];
  parts: PdfPolyline[];
  stroked: boolean;
  filled: boolean;
}

export interface ReadPathsOptions {
  /** Keep only shapes whose layers pass. Checked when the shape is painted, so skipped ones cost nothing. */
  keep?: (layers: string[]) => boolean;
  /** Stop after this many points in kept shapes (protects the phone from huge pages). */
  maxPoints?: number;
}

type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];

/** m applied first, then n (PDF row-vector convention: m × n). */
function mul(m: M, n: M): M {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const apply = (m: M, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ---------------------------------------------------------------- tokenizer

type Operand = number | { name: string } | Operand[] | { dict: Map<string, Operand> } | { str: true };

const isWs = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
// ( ) < > [ ] { } / %
const isDelim = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;

const ARRAY = Symbol('array');
const DICT = Symbol('dict');
type Mark = typeof ARRAY | typeof DICT;

/**
 * Calls `op(operator, operands)` for each operator in a content stream. Strings and inline image
 * data are skipped without being decoded.
 */
function scan(b: Uint8Array, op: (name: string, args: Operand[]) => boolean | void) {
  const stack: (Operand | Mark)[] = [];
  let i = 0;
  const n = b.length;
  const regular = () => {
    const s = i;
    while (i < n && !isWs(b[i]) && !isDelim(b[i])) i++;
    let t = '';
    for (let k = s; k < i; k++) t += String.fromCharCode(b[k]);
    return t;
  };
  while (i < n) {
    const c = b[i];
    if (isWs(c)) { i++; continue; }
    if (c === 0x25) { // % comment
      while (i < n && b[i] !== 0x0a && b[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x2f) { // /Name
      i++;
      stack.push({ name: regular() });
      continue;
    }
    if (c === 0x28) { // (string) with nesting and escapes
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        if (b[i] === 0x5c) i += 2;
        else { if (b[i] === 0x28) depth++; else if (b[i] === 0x29) depth--; i++; }
      }
      stack.push({ str: true });
      continue;
    }
    if (c === 0x3c) {
      if (b[i + 1] === 0x3c) { i += 2; stack.push(DICT); continue; }
      while (i < n && b[i] !== 0x3e) i++; // <hex>
      i++;
      stack.push({ str: true });
      continue;
    }
    if (c === 0x3e) {
      i += b[i + 1] === 0x3e ? 2 : 1;
      const at = stack.lastIndexOf(DICT);
      if (at < 0) continue;
      const items = stack.splice(at).slice(1) as Operand[];
      const dict = new Map<string, Operand>();
      for (let k = 0; k + 1 < items.length; k += 2) {
        const key = items[k];
        if (typeof key === 'object' && key && 'name' in key) dict.set(key.name, items[k + 1]);
      }
      stack.push({ dict });
      continue;
    }
    if (c === 0x5b) { i++; stack.push(ARRAY); continue; }
    if (c === 0x5d) {
      i++;
      const at = stack.lastIndexOf(ARRAY);
      if (at >= 0) stack.push(stack.splice(at).slice(1) as Operand[]);
      continue;
    }
    if (c === 0x7b || c === 0x7d) { i++; continue; }
    const t = regular();
    if (t === '') { i++; continue; }
    const first = t.charCodeAt(0);
    if ((first >= 0x30 && first <= 0x39) || first === 0x2d || first === 0x2b || first === 0x2e) {
      const v = Number(t);
      stack.push(Number.isFinite(v) ? v : 0);
      continue;
    }
    if (t === 'true' || t === 'false' || t === 'null') { stack.push(0); continue; }
    if (t === 'BI') {
      // Inline image: skip to the whitespace-delimited EI after the ID data.
      const id = findWord(b, i, 'ID');
      if (id < 0) return;
      const ei = findEI(b, id + 3);
      i = ei < 0 ? n : ei + 2;
      stack.length = 0;
      continue;
    }
    if (op(t, stack.filter((x): x is Operand => x !== ARRAY && x !== DICT)) === false) return;
    stack.length = 0;
  }
}

function findWord(b: Uint8Array, from: number, w: string): number {
  const c0 = w.charCodeAt(0), c1 = w.charCodeAt(1);
  for (let k = from; k + 1 < b.length; k++) {
    if (b[k] === c0 && b[k + 1] === c1 && (k === 0 || isWs(b[k - 1])) && (k + 2 >= b.length || isWs(b[k + 2]) || isDelim(b[k + 2]))) return k;
  }
  return -1;
}

function findEI(b: Uint8Array, from: number): number {
  for (let k = from; k + 1 < b.length; k++) {
    if (b[k] === 0x45 && b[k + 1] === 0x49 && isWs(b[k - 1]) && (k + 2 >= b.length || isWs(b[k + 2]))) return k;
  }
  return -1;
}

// ---------------------------------------------------------------- PDF objects

function text(o: PDFObject | undefined): string | null {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  if (o instanceof PDFName) return o.decodeText();
  return null;
}

function streamBytes(doc: PDFDocument, o: PDFObject | undefined): Uint8Array | null {
  const s = o instanceof PDFRef ? doc.context.lookup(o) : o;
  try {
    if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
    if (s instanceof PDFStream) return s.getContents();
  } catch {
    return null; // a filter pdf-lib can't decode (e.g. on an image): nothing to read
  }
  return null;
}

/** Layer names for an OCG or OCMD dictionary. */
function ocNames(doc: PDFDocument, o: PDFObject | undefined): string[] {
  const d = o instanceof PDFRef ? doc.context.lookup(o) : o;
  if (!(d instanceof PDFDict)) return [];
  const name = text(d.lookup(PDFName.of('Name')));
  if (name !== null) return [name];
  const ocgs = d.lookup(PDFName.of('OCGs'));
  if (ocgs instanceof PDFArray) return ocgs.asArray().flatMap((x) => ocNames(doc, x));
  if (ocgs instanceof PDFDict) return ocNames(doc, ocgs);
  return [];
}

function matrixOf(o: PDFObject | undefined): M {
  if (!(o instanceof PDFArray) || o.size() !== 6) return IDENTITY;
  const v = o.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : NaN));
  return v.every(Number.isFinite) ? (v as M) : IDENTITY;
}

// ---------------------------------------------------------------- interpreter

const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
const CURVE_STEPS = 6;

/** The vector shapes painted on a page. Form XObjects are followed (with their own layers). */
export function readPagePaths(doc: PDFDocument, pageIndex: number, opts: ReadPathsOptions = {}): PdfShape[] {
  const page = doc.getPages()[pageIndex];
  if (!page) return [];
  const out: PdfShape[] = [];
  const maxPoints = opts.maxPoints ?? 500_000;
  let budget = maxPoints;

  const contents = page.node.get(PDFName.of('Contents'));
  const resolved = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  const parts = resolved instanceof PDFArray ? resolved.asArray() : resolved ? [resolved] : [];
  // Page content may be split across streams at any token boundary: join them.
  const chunks = parts.map((p) => streamBytes(doc, p)).filter((x): x is Uint8Array => x !== null);
  const all = new Uint8Array(chunks.reduce((s, c) => s + c.length + 1, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; all[at++] = 0x0a; }

  const run = (bytes: Uint8Array, resources: PDFDict | undefined, base: M, layers: string[], seen: Set<PDFObject>, depth: number) => {
    let ctm = base;
    const ctmStack: M[] = [];
    // One entry per marked-content section: the layer names it adds (often none).
    const marked: string[][] = [];
    const current = () => [...layers, ...marked.flat()];
    let path: PdfPolyline[] = [];
    let sub: PdfPolyline | null = null;
    let cur: Pt = [0, 0]; // current point in user space of the stream (before ctm)
    let start: Pt = [0, 0];
    const props = resources?.lookup(PDFName.of('Properties'));
    const xobjects = resources?.lookup(PDFName.of('XObject'));

    const moveTo = (x: number, y: number) => {
      sub = { points: [apply(ctm, x, y)], closed: false };
      path.push(sub);
      cur = [x, y];
      start = [x, y];
    };
    const lineTo = (x: number, y: number) => {
      if (!sub) moveTo(cur[0], cur[1]);
      sub!.points.push(apply(ctm, x, y));
      cur = [x, y];
    };
    const curveTo = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      const [x0, y0] = cur;
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        lineTo(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
      }
    };
    const close = () => {
      if (sub) { sub.closed = true; sub = null; cur = start; }
    };

    scan(bytes, (name, a) => {
      const num = (k: number) => (typeof a[k] === 'number' ? (a[k] as number) : 0);
      switch (name) {
        case 'q': ctmStack.push(ctm); break;
        case 'Q': ctm = ctmStack.pop() ?? base; break;
        case 'cm':
          if (a.length >= 6) ctm = mul([num(a.length - 6), num(a.length - 5), num(a.length - 4), num(a.length - 3), num(a.length - 2), num(a.length - 1)], ctm);
          break;
        case 'm': moveTo(num(0), num(1)); break;
        case 'l': lineTo(num(0), num(1)); break;
        case 'c': curveTo(num(0), num(1), num(2), num(3), num(4), num(5)); break;
        case 'v': curveTo(cur[0], cur[1], num(0), num(1), num(2), num(3)); break;
        case 'y': curveTo(num(0), num(1), num(2), num(3), num(2), num(3)); break;
        case 're': {
          const [x, y, w, h] = [num(0), num(1), num(2), num(3)];
          moveTo(x, y); lineTo(x + w, y); lineTo(x + w, y + h); lineTo(x, y + h); close();
          break;
        }
        case 'h': close(); break;
        case 'BDC': case 'BMC': {
          let names: string[] = [];
          const tag = a[0];
          const p = a[1];
          if (name === 'BDC' && typeof tag === 'object' && tag && 'name' in tag && tag.name === 'OC' && typeof p === 'object' && p && 'name' in p && props instanceof PDFDict) {
            names = ocNames(doc, props.get(PDFName.of(p.name)));
          }
          marked.push(names);
          break;
        }
        case 'EMC': marked.pop(); break;
        case 'Do': {
          const ref = a[0];
          if (depth >= 8 || !(typeof ref === 'object' && ref && 'name' in ref) || !(xobjects instanceof PDFDict)) break;
          const raw = xobjects.get(PDFName.of(ref.name));
          const xo = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
          if (!(xo instanceof PDFRawStream) || seen.has(xo)) break;
          if (text(xo.dict.lookup(PDFName.of('Subtype'))) !== 'Form') break;
          const bytesXo = streamBytes(doc, xo);
          if (!bytesXo) break;
          const res = xo.dict.lookup(PDFName.of('Resources'));
          const own = ocNames(doc, xo.dict.get(PDFName.of('OC')));
          seen.add(xo);
          run(bytesXo, res instanceof PDFDict ? res : resources, mul(matrixOf(xo.dict.lookup(PDFName.of('Matrix'))), ctm), [...current(), ...own], seen, depth + 1);
          seen.delete(xo);
          break;
        }
        default:
          if (!PAINT.has(name)) break;
          if (name === 's' || name === 'b' || name === 'b*') close();
          if (name !== 'n') {
            const ls = current();
            const shape: PdfShape = {
              layers: ls,
              parts: path.filter((p) => p.points.length >= 2),
              stroked: name === 'S' || name === 's' || name.startsWith('B') || name.startsWith('b'),
              filled: name !== 'S' && name !== 's',
            };
            if (shape.parts.length && (!opts.keep || opts.keep(ls))) {
              for (const p of shape.parts) {
                const [f, l] = [p.points[0], p.points[p.points.length - 1]];
                if (!p.closed && p.points.length > 2 && f[0] === l[0] && f[1] === l[1]) p.closed = true;
                budget -= p.points.length;
              }
              out.push(shape);
              if (budget <= 0) return false;
            }
          }
          path = [];
          sub = null;
      }
      return budget > 0;
    });
  };

  const res = page.node.Resources();
  run(all, res, IDENTITY, [], new Set(), 0);
  return out;
}
