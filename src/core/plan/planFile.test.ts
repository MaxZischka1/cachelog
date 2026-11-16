import type { PlanFile } from '../types';
import { PLAN_FILE_EXTENSION, PlanFileError, decideImport, makePlanFile, parsePlanFile, serializePlanFile } from './planFile';
import { sampleBlock, sampleVersion } from './testFixtures';
import * as api from './index';

function validFile(): PlanFile {
  return makePlanFile(sampleBlock(), sampleVersion(2));
}

/** Serialize, apply a mutation to the raw JSON object, return text. */
function mutated(fn: (raw: any) => void): string {
  const raw = JSON.parse(serializePlanFile(validFile()));
  fn(raw);
  return JSON.stringify(raw);
}

function expectPlanFileError(text: string, pattern: RegExp) {
  let err: unknown;
  try {
    parsePlanFile(text);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(PlanFileError);
  expect((err as Error).message).toMatch(pattern);
  // messages are for planters: no JSON / stack jargon
  expect((err as Error).message).not.toMatch(/JSON|undefined|null|token|TypeError/i);
}

describe('plan files', () => {
  it('extension', () => {
    expect(PLAN_FILE_EXTENSION).toBe('.cachelog');
  });
  it('makePlanFile wraps a deep copy', () => {
    const block = sampleBlock();
    const v = sampleVersion(2);
    const f = makePlanFile(block, v);
    expect(f.format).toBe('cachelog-plan');
    expect(f.formatVersion).toBe(1);
    expect(f.block).toEqual(block);
    expect(f.block).not.toBe(block);
    expect(f.version.content).not.toBe(v.content);
    expect(Date.parse(f.exportedAt)).not.toBeNaN();
  });
  it('carries the map sheet (opening, prescription) to the crew', () => {
    const sheet = { source: 'BLK_5050853586.pdf', openingNumber: '5050853586', plantAreaHa: 3.29, prescriptions: [{ species: 'SW', treesPerHa: 600, stockType: 'S410A' }] };
    const f = makePlanFile({ ...sampleBlock(), sheet }, sampleVersion(2));
    expect(parsePlanFile(serializePlanFile(f)).block.sheet).toEqual(sheet);
  });

  it('makePlanFile rejects a version from another block', () => {
    expect(() => makePlanFile({ ...sampleBlock(), id: 'other' }, sampleVersion(1))).toThrow();
  });
  it('round-trips', () => {
    const f = validFile();
    const text = serializePlanFile(f);
    expect(typeof text).toBe('string');
    expect(parsePlanFile(text)).toEqual(f);
  });
  it('accepts a leading BOM and pretty-printed JSON', () => {
    const f = validFile();
    expect(parsePlanFile('﻿' + JSON.stringify(f, null, 2))).toEqual(f);
  });
  it('accepts a quick version with message and optional fields absent', () => {
    const text = mutated((r) => {
      r.version.quick = true;
      r.version.message = 'Sam moved';
      delete r.block.contract;
      delete r.block.licensee;
      r.block.emergency = {};
      r.block.layers = [];
      delete r.version.content.pieces[0].prescription;
    });
    expect(parsePlanFile(text).version.quick).toBe(true);
  });
  it('index exports the whole contract', () => {
    for (const name of [
      'newId', 'nowIso', 'today', 'distanceM', 'bearingDeg', 'compass', 'polygonAreaHa', 'centroid', 'pointInPolygon',
      'emptyPlan', 'loadList', 'assignmentFor', 'startDraft', 'updateDraft', 'hasChanges', 'diffPlans', 'publish',
      'quickPublish', 'revertTo', 'PublishConflictError', 'makePlanFile', 'serializePlanFile', 'parsePlanFile',
      'decideImport', 'PlanFileError', 'PLAN_FILE_EXTENSION',
    ]) {
      expect((api as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});

describe('parsePlanFile: malformed input', () => {
  it('empty file', () => {
    expectPlanFileError('', /empty/);
    expectPlanFileError('   \n', /empty/);
  });
  it('not JSON / truncated', () => {
    expectPlanFileError('hello', /couldn't be read/);
    const t = serializePlanFile(validFile());
    expectPlanFileError(t.slice(0, t.length / 2), /partly received/);
  });
  it('JSON that is not a plan', () => {
    expectPlanFileError('[]', /isn't a Cachelog plan/);
    expectPlanFileError('42', /isn't a Cachelog plan/);
    expectPlanFileError('{"type":"FeatureCollection","features":[]}', /isn't a Cachelog plan/);
  });
  it('newer format version', () => {
    expectPlanFileError(mutated((r) => (r.formatVersion = 2)), /newer version of Cachelog/);
  });
  it('unknown format version', () => {
    expectPlanFileError(mutated((r) => (r.formatVersion = 'one')), /damaged/);
  });
  const damaged: [string, (r: any) => void, RegExp][] = [
    ['missing block', (r) => delete r.block, /the block is missing/],
    ['missing version', (r) => delete r.version, /plan version is missing/],
    ['missing content', (r) => delete r.version.content, /the plan is missing/],
    ['bad version number', (r) => (r.version.version = 0), /version number/],
    ['fractional version', (r) => (r.version.version = 1.5), /whole number/],
    ['parent after version', (r) => (r.version.parentVersion = 5), /out of order/],
    ['missing caches', (r) => delete r.version.content.caches, /cache list/],
    ['cache without position', (r) => delete r.version.content.caches[1].position, /Cache 2 has an invalid map position/],
    ['cache latitude out of range', (r) => (r.version.content.caches[0].position = [-122, 95]), /Cache 1 has an invalid map position/],
    ['cache negative count', (r) => (r.version.content.caches[0].trees[0].count = -5), /Cache 1 Sx count is too small/],
    ['cache count is text', (r) => (r.version.content.caches[0].trees[0].count = '1200'), /not a valid number/],
    ['cache is not an object', (r) => (r.version.content.caches[0] = 'x'), /cache 1 is missing/],
    ['piece with 2 corners', (r) => (r.version.content.pieces[0].polygon = r.version.content.pieces[0].polygon.slice(0, 2)), /Piece 1 outline has fewer than 3 corners/],
    ['bad density', (r) => (r.version.content.pieces[0].prescription.densityPerHa = 'lots'), /Piece 1 density/],
    ['duplicate cache ids', (r) => (r.version.content.caches[1].id = r.version.content.caches[0].id), /same id/],
    ['planter without name', (r) => delete r.version.content.planters[0].name, /planter 1 name/],
    ['assignment without piece', (r) => delete r.version.content.assignments[0].pieceId, /assignment 1 piece/],
    ['unknown hazard kind', (r) => (r.version.content.hazards[0].kind = 'zone'), /hazard 1 is of an unknown type/],
    ['hazard without location', (r) => (r.version.content.hazards[0].geometry = []), /hazard 1 has no location/],
    ['bad plan day', (r) => (r.version.content.day = 'tomorrow'), /plan day/],
    ['block mismatch', (r) => (r.version.content.blockId = 'other'), /doesn't match its block/],
    ['version block mismatch', (r) => (r.version.blockId = 'other'), /doesn't match its block/],
    ['bad muster point', (r) => (r.block.emergency.musterPoint = ['a', 'b']), /muster point/],
    ['bad price', (r) => (r.block.pricesCents.Sx = null), /Sx tree price/],
    ['bad raster corners', (r) => (r.block.layers[0].corners = [[0, 0]]), /corners are incomplete/],
    ['unknown layer kind', (r) => (r.block.layers[0].kind = 'tiles'), /unknown type/],
    ['missing exportedAt', (r) => delete r.exportedAt, /export date/],
    ['quick flag not boolean', (r) => (r.version.quick = 'yes'), /quick-publish/],
  ];
  it.each(damaged)('%s', (_name, fn, pattern) => {
    expectPlanFileError(mutated(fn), pattern);
    expectPlanFileError(mutated(fn), /damaged/);
  });
});

describe('decideImport', () => {
  const file = (version: number, blockId = 'blk1'): PlanFile => ({
    ...validFile(),
    version: { ...sampleVersion(version), blockId },
  });
  it('imports when nothing local', () => {
    expect(decideImport(file(1), null)).toEqual({ action: 'import' });
  });
  it('imports a newer version', () => {
    expect(decideImport(file(3), sampleVersion(2))).toEqual({ action: 'import' });
  });
  it('skips the same version', () => {
    expect(decideImport(file(2), sampleVersion(2))).toEqual({ action: 'skip', reason: 'same' });
  });
  it('skips an older version', () => {
    expect(decideImport(file(1), sampleVersion(2))).toEqual({ action: 'skip', reason: 'older' });
  });
  it('imports a different block regardless of local version numbers', () => {
    expect(decideImport(file(1, 'blk2'), sampleVersion(7))).toEqual({ action: 'import' });
  });
});

describe('embedded map images', () => {
  const { sampleBlock, sampleVersion } = require('./testFixtures');
  const { makePlanFile, serializePlanFile, parsePlanFile, PlanFileError } = require('./index');
  test('round-trips images', () => {
    const f = { ...makePlanFile(sampleBlock(), sampleVersion()), images: { r1: 'iVBORw0KGgo=' } };
    expect(parsePlanFile(serializePlanFile(f)).images).toEqual({ r1: 'iVBORw0KGgo=' });
  });
  test('rejects an empty image entry', () => {
    const f = { ...makePlanFile(sampleBlock(), sampleVersion()), images: { r1: '' } };
    expect(() => parsePlanFile(serializePlanFile(f))).toThrow(PlanFileError);
  });
});
