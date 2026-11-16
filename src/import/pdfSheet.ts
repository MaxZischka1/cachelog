/**
 * Read the form printed on a block map sheet (opening number, areas, planting prescription) from
 * the page's positioned words. Pure (no Expo), runs under Jest.
 *
 * Works on layout, not on one licensee's template: a label is a known phrase ending in ":" and
 * its value is the words to its right on the same row, up to the next label (or, when there is
 * nothing to the right, the words just below it). Rows under a "Prescription N" heading belong to
 * that prescription.
 */
import type { BlockSheet, Prescription, SheetPrescription } from '../core/types';

/** A word on the page in PDF user space (x/y = bottom-left, y up). */
export interface PdfWord {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

type SheetKey = 'openingNumber' | 'operatingArea' | 'plantAreaHa' | 'openingAreaHa';
type RxKey = keyof SheetPrescription;
type Key = SheetKey | RxKey;

/** Label phrases (lower case, no colon) for each field. Longest match wins. */
const LABELS: Record<Key, string[]> = {
  openingNumber: ['opening num', 'opening number', 'opening no', 'opening #', 'opening id', 'opening', 'block id', 'block number', 'block no', 'block #', 'cutblock id', 'cutblock'],
  operatingArea: ['operating area'],
  plantAreaHa: ['plant area', 'planting area', 'plantable area', 'net plantable area', 'net area', 'area to plant', 'treatment area'],
  openingAreaHa: ['opening area', 'gross area', 'block area', 'total area'],
  species: ['species', 'spp'],
  treesPerHa: ['trees/ha', 'trees per ha', 'trees per hectare', 'sph', 'stems/ha', 'density', 'target density', 'planting density'],
  totalTrees: ['total trees', 'number of trees', '# trees', '# of trees', 'total seedlings', 'seedlings', 'trees'],
  boxes: ['boxes', '# boxes', '# of boxes', 'number of boxes'],
  treesPerBox: ['trees/box', 'trees per box', 'seedlings/box', 'seedlings per box'],
  stockType: ['stock type', 'stock'],
  seedlot: ['seed lot', 'seedlot'],
  seedZone: ['seed zone'],
  age: ['age', 'stock age'],
  plantType: ['plant type'],
  access: ['access'],
  startDate: ['plant start date', 'start date', 'planting start date'],
  nursery: ['nursery'],
  orderNumber: ['order number', 'order no', 'order #'],
  deliveryDate: ['delivery date'],
};

const SHEET_KEYS = new Set<Key>(['openingNumber', 'operatingArea', 'plantAreaHa', 'openingAreaHa']);
const NUMBER_KEYS = new Set<Key>(['plantAreaHa', 'openingAreaHa', 'treesPerHa', 'totalTrees', 'boxes', 'treesPerBox']);

const PHRASE_TO_KEY = new Map<string, Key>();
for (const [key, phrases] of Object.entries(LABELS) as [Key, string[]][]) for (const p of phrases) PHRASE_TO_KEY.set(p, key);
const MAX_LABEL_WORDS = 4;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const midY = (w: PdfWord) => w.y + w.h / 2;
const right = (w: PdfWord) => w.x + w.w;

/** Same printed line: vertical centres closer than about a third of the smaller box. */
function sameRow(a: PdfWord, b: PdfWord): boolean {
  return Math.abs(midY(a) - midY(b)) < Math.min(a.h, b.h) * 0.35;
}

/** Next word to the left on the same row, if it sits close (as part of one phrase). */
function leftNeighbour(words: PdfWord[], w: PdfWord): PdfWord | undefined {
  let best: PdfWord | undefined;
  for (const o of words) {
    if (o === w || !sameRow(o, w) || right(o) > w.x + 1) continue;
    const gap = w.x - right(o);
    if (gap > Math.max(w.h, o.h) * 0.9) continue;
    if (!best || right(o) > right(best)) best = o;
  }
  return best;
}

interface Label {
  key: Key | null;
  /** Words that make up the label, left to right. */
  words: PdfWord[];
  x: number;
  end: number;
  row: PdfWord;
}

/** Codes and numbers ("DECOMP", "SW", "2013", "S410A"), as opposed to ordinary label words. */
function looksLikeValue(t: string): boolean {
  return /\d/.test(t) || (/^[A-Z0-9+\-/.]+$/.test(t) && t.length > 1);
}

/** Map-symbol glyphs from symbol fonts come through as odd strings (e.g. "uL with a quote). */
function isJunk(t: string): boolean {
  return /["“”\u0000-\u001f\ue000-\uf8ff]/.test(t);
}

/** Every word ending in ":" is a label (known or not); known ones get a key. */
function findLabels(words: PdfWord[]): Label[] {
  const labels: Label[] = [];
  for (const w of words) {
    if (!w.t.endsWith(':')) continue;
    const chain: PdfWord[] = [w];
    for (let i = 1; i < MAX_LABEL_WORDS; i++) {
      const prev = leftNeighbour(words, chain[0]);
      if (!prev || prev.t.endsWith(':')) break;
      chain.unshift(prev);
    }
    // Longest known phrase ending at this word. Words dropped from the front must look like a
    // value (a code or number, e.g. "DECOMP Access:"), not part of the label ("Describe Access:").
    // Unknown labels keep their own words (so "Source" in "Source ID:" is not read as a value)
    // but not a value printed just before them.
    let first = 0;
    while (first < chain.length - 1 && looksLikeValue(chain[first].t)) first++;
    let found: Label = { key: null, words: chain.slice(first), x: chain[first].x, end: right(w), row: w };
    for (let start = 0; start < chain.length; start++) {
      if (start > 0 && !looksLikeValue(chain[start - 1].t)) break;
      const phrase = norm(chain.slice(start).map((c) => c.t).join(' ').replace(/:$/, ''));
      const key = PHRASE_TO_KEY.get(phrase);
      if (key) {
        found = { key, words: chain.slice(start), x: chain[start].x, end: right(w), row: w };
        break;
      }
    }
    labels.push(found);
  }
  return labels;
}

function valueFor(label: Label, words: PdfWord[], labels: Label[], labelWords: Set<PdfWord>): string {
  // To the right on the same row, up to the next label on that row.
  const nextLabelX = Math.min(
    ...labels.filter((l) => l !== label && sameRow(l.row, label.row) && l.x > label.end - 1).map((l) => l.x),
    Infinity,
  );
  const onRight = words
    .filter((w) => !labelWords.has(w) && sameRow(w, label.row) && w.x >= label.end - 1 && w.x < nextLabelX)
    .sort((a, b) => a.x - b.x);
  // Stop at a wide gap (another column's text that has no label of its own).
  const picked: PdfWord[] = [];
  let edge = label.end;
  for (const w of onRight) {
    if (w.x - edge > Math.max(w.h, label.row.h) * 4) break;
    picked.push(w);
    edge = right(w);
  }
  if (picked.length) return picked.map((w) => w.t).join(' ');

  // Nothing to the right: the words just below, under the label.
  const below = words
    .filter((w) => !labelWords.has(w) && midY(w) < midY(label.row) && midY(label.row) - midY(w) < label.row.h * 1.6 && w.x < label.end && right(w) > label.x)
    .sort((a, b) => midY(b) - midY(a) || a.x - b.x);
  if (!below.length) return '';
  // Only if no label sits between (the line below is the label's own value line).
  const lineBelow = below.filter((w) => sameRow(w, below[0]));
  const blocked = labels.some((l) => l !== label && sameRow(l.row, below[0]) && l.x < label.end && l.end > label.x);
  return blocked ? '' : lineBelow.sort((a, b) => a.x - b.x).map((w) => w.t).join(' ');
}

function parseNumber(s: string): number | undefined {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(s);
  if (!m) return undefined;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Headings like "Prescription 1" / "Rx 2": [word, y] top to bottom. */
function sectionHeadings(words: PdfWord[]): PdfWord[] {
  return words
    .filter((w) => /^(prescription|rx)$/i.test(w.t) && words.some((n) => n !== w && sameRow(n, w) && /^\d+$/.test(n.t) && n.x > w.x && n.x - right(w) < w.h))
    .sort((a, b) => midY(b) - midY(a));
}

/**
 * Read the sheet. Returns null when none of the known fields has a value (not a form, or a
 * plain map). `source` is the file name, kept for reference.
 */
export function readBlockSheet(words: PdfWord[], source: string): BlockSheet | null {
  const clean = words.filter((w) => w.t.trim() && !isJunk(w.t) && Number.isFinite(w.x) && Number.isFinite(w.y) && w.h > 0);
  const labels = findLabels(clean);
  const labelWords = new Set(labels.flatMap((l) => l.words));
  const headings = sectionHeadings(clean);

  const sheet: BlockSheet = { source, prescriptions: [] };
  const sections: SheetPrescription[] = headings.map(() => ({}));
  const loose: SheetPrescription = {};
  let found = 0;

  // Top to bottom, so the first value printed for a field wins.
  for (const label of [...labels].sort((a, b) => midY(b.row) - midY(a.row) || a.x - b.x)) {
    if (!label.key) continue;
    const raw = valueFor(label, clean, labels, labelWords);
    if (!raw) continue;
    const value = NUMBER_KEYS.has(label.key) ? parseNumber(raw) : raw;
    if (value === undefined) continue;
    if (SHEET_KEYS.has(label.key)) {
      const k = label.key as SheetKey;
      if ((sheet as unknown as Record<string, unknown>)[k] === undefined) {
        (sheet as unknown as Record<string, unknown>)[k] = value;
        found++;
      }
      continue;
    }
    // The prescription whose heading is the nearest one above this label.
    let idx = -1;
    headings.forEach((h, i) => {
      if (midY(h) >= midY(label.row) - 1) idx = i;
    });
    const target = idx >= 0 ? sections[idx] : loose;
    const k = label.key as RxKey;
    if ((target as Record<string, unknown>)[k] === undefined) {
      (target as Record<string, unknown>)[k] = value;
      found++;
    }
  }

  for (const rx of [loose, ...sections]) if (Object.keys(rx).length) sheet.prescriptions.push(rx);
  return found ? sheet : null;
}

/** Short one-line summary of a prescription, e.g. "SW · 600/ha · 2,430 trees · 9 boxes of 270 · S410A". */
export function describePrescription(rx: SheetPrescription): string {
  const n = (v: number) => v.toLocaleString('en-CA');
  const parts: string[] = [];
  if (rx.species) parts.push(rx.species);
  if (rx.treesPerHa !== undefined) parts.push(`${n(rx.treesPerHa)}/ha`);
  if (rx.totalTrees !== undefined) parts.push(`${n(rx.totalTrees)} trees`);
  if (rx.boxes !== undefined) parts.push(rx.treesPerBox !== undefined ? `${n(rx.boxes)} boxes of ${n(rx.treesPerBox)}` : `${n(rx.boxes)} boxes`);
  else if (rx.treesPerBox !== undefined) parts.push(`${n(rx.treesPerBox)}/box`);
  if (rx.stockType) parts.push(rx.stockType);
  return parts.join(' · ');
}

/**
 * Piece prescription from the map sheet, used as the default for new pieces and for the planter's
 * brief when a piece has none of its own: the first prescription's density, every species named.
 */
export function pieceRxFromSheet(sheet: BlockSheet | undefined): Prescription | undefined {
  if (!sheet?.prescriptions.length) return undefined;
  const out: Prescription = {};
  const density = sheet.prescriptions.find((p) => p.treesPerHa !== undefined)?.treesPerHa;
  if (density !== undefined) out.densityPerHa = density;
  const species = [...new Set(sheet.prescriptions.map((p) => p.species).filter((s): s is string => !!s))];
  if (species.length) out.species = species;
  return Object.keys(out).length ? out : undefined;
}
