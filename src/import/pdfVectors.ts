/**
 * Vector paths from a GeoPDF page, grouped by PDF layer (optional content group).
 *
 * GIS exports (ArcGIS Pro, QGIS, GDAL) draw each map layer inside a marked-content section tagged
 * with its layer: `/OC /MC12 BDC ... EMC`. Walking the content stream and keeping the paths drawn
 * inside each section gives the block outline, planting units, roads and so on as real geometry.
 * Pure (pdf-lib only), so it runs on the phone and under Jest.
 */
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';

export type Pt = [number, number];

export interface PdfPath {
  /** Subpaths in page user space. */
  parts: Pt[][];
  /** Each subpath was closed (h, re, or ends where it started). */
  closed: boolean[];
  filled: boolean;
  stroked: boolean;
}

export interface PdfLayerPaths {
  /** Layer (OCG) name, outermost first, e.g. ["Map", "BLOCK: Block Outline - Black"]. */
  layers: string[];
  paths: PdfPath[];
}

type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];

/** a × b in PDF's row-vector convention: apply a first, then b. */
function mul(a: M, b: M): M {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function apply(m: M, x: number, y: number): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// ------------------------------------------------------------------ tokenizer

type Tok = number | string | { name: string } | Tok[] | { dict: true } | { str: true };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

/** Minimal content-stream lexer: numbers, names, strings (skipped), arrays, dicts (skipped), operators. */
function* lex(b: Uint8Array): Generator<Tok | { op: string }> {
  let i = 0;
  const n = b.length;
  const stack: Tok[][] = [];
  const emit = function* (t: Tok): Generator<Tok | { op: string }> {
    if (stack.length) stack[stack.length - 1].push(t);
    else yield t;
  };
  while (i < n) {
    const c = b[i];
    if (WS.has(c)) {
      i++;
      continue;
    }
    if (c === 37) {
      // % comment
      while (i < n && b[i] !== 10 && b[i] !== 13) i++;
      continue;
    }
    if (c === 40) {
      // ( string ) with nesting and escapes
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        if (b[i] === 92) i += 2;
        else {
          if (b[i] === 40) depth++;
          else if (b[i] === 41) depth--;
          i++;
        }
      }
      yield* emit({ str: true });
      continue;
    }
    if (c === 60) {
      if (b[i + 1] === 60) {
        // << dict >>: skip to the matching >> (inline dicts only appear in BDC/BI)
        let depth = 1;
        i += 2;
        let name: string | null = null;
        while (i < n && depth > 0) {
          if (b[i] === 60 && b[i + 1] === 60) {
            depth++;
            i += 2;
          } else if (b[i] === 62 && b[i + 1] === 62) {
            depth--;
            i += 2;
          } else i++;
        }
        void name;
        yield* emit({ dict: true });
        continue;
      }
      while (i < n && b[i] !== 62) i++;
      i++;
      yield* emit({ str: true });
      continue;
    }
    if (c === 91) {
      stack.push([]);
      i++;
      continue;
    }
    if (c === 93) {
      const arr = stack.pop() ?? [];
      i++;
      yield* emit(arr);
      continue;
    }
    if (c === 47) {
      // /Name
      let j = i + 1;
      while (j < n && !WS.has(b[j]) && !DELIM.has(b[j])) j++;
      let name = '';
      for (let k = i + 1; k < j; k++) name += String.fromCharCode(b[k]);
      name = name.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      i = j;
      yield* emit({ name });
      continue;
    }
    // number or operator
    let j = i;
    while (j < n && !WS.has(b[j]) && !DELIM.has(b[j])) j++;
    if (j === i) {
      i++;
      continue;
    }
    let word = '';
    for (let k = i; k < j; k++) word += String.fromCharCode(b[k]);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      yield* emit(parseFloat(word));
      continue;
    }
    if (word === 'BI') {
      // inline image: skip to EI
      while (i < n - 2 && !(WS.has(b[i]) && b[i + 1] === 69 && b[i + 2] === 73 && (i + 3 >= n || WS.has(b[i + 3])))) i++;
      i += 3;
      continue;
    }
    if (word === 'true' || word === 'false' || word === 'null') {
      yield* emit(word);
      continue;
    }
    yield { op: word };
  }
}

// ------------------------------------------------------------------ interpreter

function streamBytes(ctx: PDFDocument['context'], obj: PDFObject | undefined): Uint8Array[] {
  const o = obj instanceof PDFRef ? ctx.lookup(obj) : obj;
  if (o instanceof PDFArray) return o.asArray().flatMap((x) => streamBytes(ctx, x));
  if (o instanceof PDFRawStream) return [decodePDFRawStream(o).decode()];
  if (o instanceof PDFStream) return [o.getContents()];
  return [];
}

function ocgName(ctx: PDFDocument['context'], obj: PDFObject | undefined): string | null {
  const d = obj instanceof PDFRef ? ctx.lookup(obj) : obj;
  if (!(d instanceof PDFDict)) return null;
  const type = d.lookup(PDFName.of('Type'));
  if (type instanceof PDFName && type.decodeText() === 'OCMD') {
    const ocgs = d.lookup(PDFName.of('OCGs'));
    if (ocgs instanceof PDFArray) return ocgName(ctx, ocgs.get(0));
    return ocgName(ctx, ocgs);
  }
  const name = d.lookup(PDFName.of('Name'));
  if (!name) return null;
  const anyName = name as unknown as { decodeText?: () => string };
  return typeof anyName.decodeText === 'function' ? anyName.decodeText() : String(name);
}

interface State {
  ctm: M;
}

/**
 * Walk a page's content (and the form XObjects it draws) and collect painted paths, grouped by the
 * stack of layers they were drawn in. `maxOps` bounds work on huge maps.
 */
export function extractLayerPaths(doc: PDFDocument, pageIndex = 0, maxOps = 3_000_000): PdfLayerPaths[] {
  const ctx = doc.context;
  const page = doc.getPage(pageIndex);
  const groups = new Map<string, PdfLayerPaths>();
  let ops = 0;

  const run = (bytesList: Uint8Array[], resources: PDFDict | undefined, start: M, outerLayers: string[], depth: number) => {
    if (depth > 8) return;
    const props = resources?.lookup(PDFName.of('Properties'));
    const xobjects = resources?.lookup(PDFName.of('XObject'));
    const stack: State[] = [];
    let st: State = { ctm: start };
    const mc: (string | null)[] = [];
    const operands: Tok[] = [];
    let parts: Pt[][] = [];
    let closed: boolean[] = [];
    let cur: Pt[] | null = null;
    let curStart: Pt | null = null;

    const layers = () => [...outerLayers, ...mc.filter((x): x is string => !!x)];
    const finishSub = (close: boolean) => {
      if (cur && cur.length > 1) {
        const first = cur[0], last = cur[cur.length - 1];
        const isClosed = close || (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6);
        parts.push(cur);
        closed.push(isClosed);
      }
      cur = null;
    };
    const paint = (filled: boolean, stroked: boolean) => {
      finishSub(false);
      if (parts.length && (filled || stroked)) {
        const ls = layers();
        if (ls.length) {
          const key = ls.join('\u0000');
          let g = groups.get(key);
          if (!g) groups.set(key, (g = { layers: ls, paths: [] }));
          g.paths.push({ parts, closed, filled, stroked });
        }
      }
      parts = [];
      closed = [];
    };
    const num = (k: number) => {
      const v = operands[operands.length - k];
      return typeof v === 'number' ? v : 0;
    };

    for (const bytes of bytesList) {
      for (const t of lex(bytes)) {
        if (!(t && typeof t === 'object' && 'op' in t)) {
          operands.push(t as Tok);
          continue;
        }
        if (++ops > maxOps) return;
        const op = t.op;
        switch (op) {
          case 'q':
            stack.push(st);
            st = { ctm: st.ctm };
            break;
          case 'Q':
            st = stack.pop() ?? st;
            break;
          case 'cm':
            st = { ctm: mul([num(6), num(5), num(4), num(3), num(2), num(1)], st.ctm) };
            break;
          case 'm':
            finishSub(false);
            cur = [apply(st.ctm, num(2), num(1))];
            curStart = cur[0];
            break;
          case 'l':
            if (cur) cur.push(apply(st.ctm, num(2), num(1)));
            break;
          case 'c':
            if (cur) cur.push(apply(st.ctm, num(2), num(1)));
            break;
          case 'v':
          case 'y':
            if (cur) cur.push(apply(st.ctm, num(2), num(1)));
            break;
          case 'h':
            if (cur && curStart) {
              cur.push(curStart);
              finishSub(true);
            }
            break;
          case 're': {
            finishSub(false);
            const x = num(4), y = num(3), w = num(2), h = num(1);
            const r: Pt[] = [apply(st.ctm, x, y), apply(st.ctm, x + w, y), apply(st.ctm, x + w, y + h), apply(st.ctm, x, y + h)];
            r.push(r[0]);
            parts.push(r);
            closed.push(true);
            break;
          }
          case 'S':
          case 's':
            if (op === 's' && cur && curStart) cur.push(curStart);
            paint(false, true);
            break;
          case 'f':
          case 'F':
          case 'f*':
            paint(true, false);
            break;
          case 'B':
          case 'B*':
          case 'b':
          case 'b*':
            paint(true, true);
            break;
          case 'n':
            finishSub(false);
            parts = [];
            closed = [];
            break;
          case 'BDC': {
            const tag = operands[operands.length - 2];
            const prop = operands[operands.length - 1];
            let name: string | null = null;
            if (tag && typeof tag === 'object' && 'name' in tag && tag.name === 'OC' && prop && typeof prop === 'object' && 'name' in prop && props instanceof PDFDict) {
              name = ocgName(ctx, props.get(PDFName.of(prop.name)));
            }
            mc.push(name);
            break;
          }
          case 'BMC':
            mc.push(null);
            break;
          case 'EMC':
            mc.pop();
            break;
          case 'Do': {
            const nm = operands[operands.length - 1];
            if (nm && typeof nm === 'object' && 'name' in nm && xobjects instanceof PDFDict) {
              const ref = xobjects.get(PDFName.of(nm.name));
              const xo = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
              if (xo instanceof PDFRawStream || xo instanceof PDFStream) {
                const dict = xo.dict;
                const sub = dict.lookup(PDFName.of('Subtype'));
                if (sub instanceof PDFName && sub.decodeText() === 'Form') {
                  const mArr = dict.lookup(PDFName.of('Matrix'));
                  const fm: M = mArr instanceof PDFArray && mArr.size() === 6
                    ? (mArr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) as M)
                    : IDENTITY;
                  const ocName = ocgName(ctx, dict.get(PDFName.of('OC')));
                  const res = dict.lookup(PDFName.of('Resources'));
                  run(streamBytes(ctx, xo), res instanceof PDFDict ? res : resources, mul(fm, st.ctm), ocName ? [...layers(), ocName] : layers(), depth + 1);
                }
              }
            }
            break;
          }
          default:
            break;
        }
        operands.length = 0;
      }
    }
  };

  const res = page.node.Resources();
  run(streamBytes(ctx, page.node.get(PDFName.of('Contents'))), res, IDENTITY, [], 0);
  return [...groups.values()];
}

/** Every layer name that has paths, with counts (deepest layer name last). */
export function summarizeLayers(groups: PdfLayerPaths[]): { name: string; paths: number; closedParts: number }[] {
  const by = new Map<string, { paths: number; closedParts: number }>();
  for (const g of groups) {
    const name = g.layers[g.layers.length - 1];
    const e = by.get(name) ?? { paths: 0, closedParts: 0 };
    e.paths += g.paths.length;
    for (const p of g.paths) e.closedParts += p.closed.filter(Boolean).length;
    by.set(name, e);
  }
  return [...by.entries()].map(([name, v]) => ({ name, ...v }));
}

/** All paths drawn inside a layer (at any depth). */
export function pathsInLayer(groups: PdfLayerPaths[], layer: string): PdfPath[] {
  return groups.filter((g) => g.layers.includes(layer)).flatMap((g) => g.paths);
}
