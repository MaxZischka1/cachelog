import realSheetJson from './__fixtures__/plant-opening-sheet.words.json';
import { describePrescription, pieceRxFromSheet, readBlockSheet, type PdfWord } from './pdfSheet';

/** Words (with positions, as the iOS module returns them) from the form area of a real 2026 plant opening map. */
const realSheet: PdfWord[] = realSheetJson;

/** Lay out "label value" rows for a made-up sheet: each item is [text, x], rows top to bottom. */
function sheet(rows: [string, number][][], rowHeight = 14, top = 700): PdfWord[] {
  const words: PdfWord[] = [];
  rows.forEach((row, r) => {
    for (const [text, x0] of row) {
      let x = x0;
      for (const t of text.split(' ')) {
        words.push({ t, x, y: top - r * rowHeight, w: t.length * 5, h: 10 });
        x += t.length * 5 + 3;
      }
    }
  });
  return words;
}

describe('readBlockSheet', () => {
  test('real plant opening map sheet', () => {
    const s = readBlockSheet(realSheet, 'BLK_5050853586.pdf')!;
    expect(s).toMatchObject({ source: 'BLK_5050853586.pdf', openingNumber: '5050853586', operatingArea: '085055', plantAreaHa: 3.29 });
    expect(s.openingAreaHa).toBeCloseTo(49.986758, 5);
    // Prescription 2 on the sheet is blank, so only one comes back.
    expect(s.prescriptions).toEqual([
      {
        plantType: 'DECOMP', access: 'ATV', startDate: '6/1/2026', seedlot: 'TIC I G205 SO 2013 SW', seedZone: 'LBH1.3',
        species: 'SW', stockType: 'S410A', age: '1+0', treesPerHa: 600, totalTrees: 2430, boxes: 9, treesPerBox: 270,
        nursery: 'BFN', orderNumber: '14614',
      },
    ]);
    expect(describePrescription(s.prescriptions[0])).toBe('SW · 600/ha · 2,430 trees · 9 boxes of 270 · S410A');
  });

  test('another layout: values under labels, other label words, two prescriptions', () => {
    const words = sheet([
      [['Block ID:', 20], ['Net Area:', 200], ['Licensee Ref:', 380]],
      [['CP-2231-04', 20], ['12.5 ha', 200], ['ABC 77', 380]],
      [['Rx 1', 20]],
      [['Species:', 20], ['PL', 80], ['Density:', 200], ['1,600', 260], ['Stock:', 380], ['PSB 412', 430]],
      [['Rx 2', 20]],
      [['Species:', 20], ['SX', 80], ['Density:', 200], ['1,200', 260]],
      [['Describe Access:', 20], ['quad trail from the north', 140]],
    ]);
    const s = readBlockSheet(words, 'cp2231.pdf')!;
    expect(s.openingNumber).toBe('CP-2231-04');
    expect(s.plantAreaHa).toBe(12.5);
    expect(s.prescriptions).toEqual([
      { species: 'PL', treesPerHa: 1600, stockType: 'PSB 412' },
      { species: 'SX', treesPerHa: 1200 },
    ]);
  });

  test('a value printed right before a label is not part of it', () => {
    const words = sheet([[['Plant Type:', 20], ['DECOMP', 90], ['Access:', 200], ['ATV', 250]]]);
    expect(readBlockSheet(words, 'x.pdf')!.prescriptions).toEqual([{ plantType: 'DECOMP', access: 'ATV' }]);
  });

  test('symbol-font junk next to a label is ignored', () => {
    const words = [...sheet([[['Operating Area:', 20]], [['085055', 20]]]), { t: '"uL', x: 110, y: 700, w: 8, h: 10 }];
    expect(readBlockSheet(words, 'x.pdf')!.operatingArea).toBe('085055');
  });

  test('a map with no form fields gives null', () => {
    expect(readBlockSheet(sheet([[['Legend', 20], ['Roads', 80]], [['1:20,000', 20]]]), 'x.pdf')).toBeNull();
    expect(readBlockSheet([], 'x.pdf')).toBeNull();
  });
});

describe('pieceRxFromSheet', () => {
  test('density from the first prescription that has one, every species', () => {
    expect(pieceRxFromSheet({ source: 'x', prescriptions: [{ species: 'SW', treesPerHa: 600 }, { species: 'PL', treesPerHa: 1600 }, { species: 'SW' }] }))
      .toEqual({ densityPerHa: 600, species: ['SW', 'PL'] });
  });
  test('nothing useful: undefined', () => {
    expect(pieceRxFromSheet(undefined)).toBeUndefined();
    expect(pieceRxFromSheet({ source: 'x', prescriptions: [{ nursery: 'BFN' }] })).toBeUndefined();
  });
});
