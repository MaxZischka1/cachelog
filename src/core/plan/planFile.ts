import { isValidLogEntry } from '../tally/logFile';
import type { Block, Draft, PlanFile, PlanSuggestion, PlanVersion } from '../types';
import { deepCopy } from './content';
import { nowIso } from './ids';

export const PLAN_FILE_EXTENSION = '.cachelog';
export const PLAN_FILE_FORMAT = 'cachelog-plan';
export const PLAN_FILE_FORMAT_VERSION = 1;

export class PlanFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanFileError';
    Object.setPrototypeOf(this, PlanFileError.prototype);
  }
}

export type ImportDecision = { action: 'import' } | { action: 'skip'; reason: 'older' | 'same' };

export function makePlanFile(block: Block, version: PlanVersion): PlanFile {
  if (block.id !== version.blockId) {
    throw new Error(`Plan version belongs to block ${version.blockId}, not ${block.id}`);
  }
  return {
    format: PLAN_FILE_FORMAT,
    formatVersion: PLAN_FILE_FORMAT_VERSION,
    block: deepCopy(block),
    version: deepCopy(version),
    exportedAt: nowIso(),
  };
}

export function serializePlanFile(f: PlanFile): string {
  return JSON.stringify(f);
}

// ---------- validation ----------

const NOT_A_PLAN = "This file isn't a Cachelog plan. Ask your crew boss to send the plan again from Cachelog.";

/** Thrown internally with a short plain-language detail; wrapped into a PlanFileError. */
class Damaged extends Error {}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, what: string): Obj {
  if (!isObj(v)) throw new Damaged(`${what} is missing`);
  return v;
}

function str(v: unknown, what: string, opts: { optional?: boolean; nonEmpty?: boolean } = {}): void {
  if (v === undefined && opts.optional) return;
  if (typeof v !== 'string') throw new Damaged(`${what} is missing`);
  if (opts.nonEmpty && v.trim() === '') throw new Damaged(`${what} is empty`);
}

function num(v: unknown, what: string, opts: { optional?: boolean; min?: number; integer?: boolean } = {}): void {
  if (v === undefined && opts.optional) return;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Damaged(`${what} is not a valid number`);
  if (opts.integer && !Number.isInteger(v)) throw new Damaged(`${what} is not a whole number`);
  if (opts.min !== undefined && v < opts.min) throw new Damaged(`${what} is too small`);
}

function arr(v: unknown, what: string, opts: { optional?: boolean } = {}): unknown[] {
  if (v === undefined && opts.optional) return [];
  if (!Array.isArray(v)) throw new Damaged(`${what} is missing`);
  return v;
}

function lngLat(v: unknown, what: string, opts: { optional?: boolean } = {}): void {
  if (v === undefined && opts.optional) return;
  if (
    !Array.isArray(v) ||
    v.length < 2 ||
    typeof v[0] !== 'number' ||
    typeof v[1] !== 'number' ||
    !Number.isFinite(v[0]) ||
    !Number.isFinite(v[1]) ||
    v[0] < -180 ||
    v[0] > 180 ||
    v[1] < -90 ||
    v[1] > 90
  ) {
    throw new Damaged(`${what} has an invalid map position`);
  }
}

function speciesCounts(v: unknown, what: string): void {
  arr(v, `${what} tree counts`).forEach((t, i) => {
    const o = obj(t, `${what} tree count ${i + 1}`);
    str(o.species, `${what} species code`, { nonEmpty: true });
    num(o.count, `${what} ${String(o.species)} count`, { min: 0 });
  });
}

function label(o: Obj, kind: string, i: number): string {
  return typeof o.name === 'string' && o.name.trim() ? o.name : `${kind} ${i + 1}`;
}

function uniqueIds(list: unknown[], what: string): void {
  const seen = new Set<unknown>();
  for (const x of list) {
    const id = (x as Obj).id;
    if (seen.has(id)) throw new Damaged(`two ${what} have the same id`);
    seen.add(id);
  }
}

function validateBlock(v: unknown): void {
  const b = obj(v, 'the block');
  str(b.id, 'the block id', { nonEmpty: true });
  str(b.name, 'the block name');
  str(b.contract, 'the contract number', { optional: true });
  str(b.licensee, 'the licensee', { optional: true });
  str(b.createdAt, 'the block creation date');
  const prices = obj(b.pricesCents, 'the tree prices');
  for (const [sp, c] of Object.entries(prices)) num(c, `the ${sp} tree price`, { min: 0 });
  const e = obj(b.emergency, 'the emergency info');
  lngLat(e.musterPoint, 'the muster point', { optional: true });
  lngLat(e.helipad, 'the helipad', { optional: true });
  for (const k of ['evacRoute', 'nearestHospital', 'radioChannel', 'notes'] as const) {
    str(e[k], `the emergency ${k}`, { optional: true });
  }
  arr(b.layers, 'the map layers').forEach((l, i) => {
    const o = obj(l, `map layer ${i + 1}`);
    str(o.id, `map layer ${i + 1} id`, { nonEmpty: true });
    if (o.kind === 'raster') {
      const corners = arr(o.corners, `map layer ${i + 1} corners`);
      if (corners.length !== 4) throw new Damaged(`map layer ${i + 1} corners are incomplete`);
      corners.forEach((c) => lngLat(c, `map layer ${i + 1}`));
    } else if (o.kind === 'vector') {
      const g = obj(o.geojson, `map layer ${i + 1} shapes`);
      if (g.type !== 'FeatureCollection' || !Array.isArray(g.features))
        throw new Damaged(`map layer ${i + 1} shapes are unreadable`);
    } else {
      throw new Damaged(`map layer ${i + 1} is of an unknown type`);
    }
  });
}

function validateContent(v: unknown): void {
  const c = obj(v, 'the plan');
  str(c.blockId, 'the plan block id', { nonEmpty: true });
  str(c.day, 'the plan day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.day as string)) throw new Damaged('the plan day is not a valid date');
  str(c.notes, 'the plan notes', { optional: true });

  const planters = arr(c.planters, 'the planter list');
  planters.forEach((p, i) => {
    const o = obj(p, `planter ${i + 1}`);
    str(o.id, `planter ${i + 1} id`, { nonEmpty: true });
    str(o.name, `planter ${i + 1} name`);
  });
  uniqueIds(planters, 'planters');

  const caches = arr(c.caches, 'the cache list');
  caches.forEach((x, i) => {
    const o = obj(x, `cache ${i + 1}`);
    const name = label(o, 'cache', i);
    str(o.id, `${name} id`, { nonEmpty: true });
    str(o.name, `${name} name`);
    lngLat(o.position, name);
    speciesCounts(o.trees, name);
    str(o.notes, `${name} notes`, { optional: true });
  });
  uniqueIds(caches, 'caches');

  const pieces = arr(c.pieces, 'the piece list');
  pieces.forEach((x, i) => {
    const o = obj(x, `piece ${i + 1}`);
    const name = label(o, 'piece', i);
    str(o.id, `${name} id`, { nonEmpty: true });
    str(o.name, `${name} name`);
    const ring = arr(o.polygon, `${name} outline`);
    if (ring.length < 3) throw new Damaged(`${name} outline has fewer than 3 corners`);
    ring.forEach((p) => lngLat(p, name));
    if (o.prescription !== undefined) {
      const rx = obj(o.prescription, `${name} prescription`);
      num(rx.densityPerHa, `${name} density`, { optional: true, min: 0 });
      num(rx.spacingM, `${name} spacing`, { optional: true, min: 0 });
      arr(rx.species, `${name} species list`, { optional: true }).forEach((s) =>
        str(s, `${name} species code`, { nonEmpty: true }),
      );
    }
    str(o.notes, `${name} notes`, { optional: true });
  });
  uniqueIds(pieces, 'pieces');

  arr(c.assignments, 'the assignment list').forEach((x, i) => {
    const o = obj(x, `assignment ${i + 1}`);
    str(o.planterId, `assignment ${i + 1} planter`, { nonEmpty: true });
    str(o.pieceId, `assignment ${i + 1} piece`, { nonEmpty: true });
    str(o.cacheId, `assignment ${i + 1} cache`, { optional: true });
  });

  const hazards = arr(c.hazards, 'the hazard list');
  hazards.forEach((x, i) => {
    const o = obj(x, `hazard ${i + 1}`);
    str(o.id, `hazard ${i + 1} id`, { nonEmpty: true });
    str(o.note, `hazard ${i + 1} description`);
    const g = arr(o.geometry, `hazard ${i + 1} location`);
    if (o.kind === 'point') {
      if (g.length < 1) throw new Damaged(`hazard ${i + 1} has no location`);
    } else if (o.kind === 'area') {
      if (g.length < 3) throw new Damaged(`hazard ${i + 1} area has fewer than 3 corners`);
    } else {
      throw new Damaged(`hazard ${i + 1} is of an unknown type`);
    }
    g.forEach((p) => lngLat(p, `hazard ${i + 1}`));
  });
  uniqueIds(hazards, 'hazards');
}

function validateVersion(v: unknown): void {
  const pv = obj(v, 'the plan version');
  str(pv.blockId, 'the plan block id', { nonEmpty: true });
  num(pv.version, 'the plan version number', { integer: true, min: 1 });
  if (pv.parentVersion !== null) {
    num(pv.parentVersion, 'the previous version number', { integer: true, min: 1 });
    if ((pv.parentVersion as number) >= (pv.version as number))
      throw new Damaged('the version numbers are out of order');
  }
  str(pv.publishedAt, 'the publish date');
  str(pv.author, 'the author');
  str(pv.message, 'the version message', { optional: true });
  if (pv.quick !== undefined && typeof pv.quick !== 'boolean') throw new Damaged('the quick-publish flag is invalid');
  validateContent(pv.content);
}

/** Parse and validate a plan file. Throws PlanFileError with a message a planter can understand. */
export function parsePlanFile(text: string): PlanFile {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new PlanFileError('This file is empty. Ask your crew boss to send the plan again.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new PlanFileError(
      "This file couldn't be read. It may be damaged or only partly received. Ask your crew boss to send the plan again.",
    );
  }
  if (!isObj(raw) || raw.format !== PLAN_FILE_FORMAT) throw new PlanFileError(NOT_A_PLAN);
  if (typeof raw.formatVersion === 'number' && raw.formatVersion > PLAN_FILE_FORMAT_VERSION) {
    throw new PlanFileError('This plan was made with a newer version of Cachelog. Update the app, then open the plan again.');
  }
  try {
    if (raw.formatVersion !== PLAN_FILE_FORMAT_VERSION) throw new Damaged('the file version is unknown');
    str(raw.exportedAt, 'the export date');
    validateBlock(raw.block);
    validateVersion(raw.version);
    const block = raw.block as Obj;
    const version = raw.version as Obj;
    const content = version.content as Obj;
    if (version.blockId !== block.id || content.blockId !== block.id) {
      throw new Damaged("the plan doesn't match its block");
    }
    if (raw.pins !== undefined) {
      const pins = arr(raw.pins, 'the crew pins');
      const blockId = block.id as string;
      if (!pins.every((e) => isValidLogEntry(e, blockId))) throw new Damaged('a crew pin is invalid');
    }
    if (raw.images !== undefined) {
      const images = obj(raw.images, 'the map images');
      for (const [id, data] of Object.entries(images)) {
        if (typeof data !== 'string' || data.length === 0) throw new Damaged(`map image ${id} is missing`);
      }
    }
  } catch (e) {
    if (e instanceof Damaged) {
      throw new PlanFileError(
        `This plan file is damaged and can't be opened (${e.message}). Ask your crew boss to send the plan again.`,
      );
    }
    throw e;
  }
  return raw as unknown as PlanFile;
}

/**
 * Decide whether to import a received plan file, given this phone's latest version for that block.
 * Older or identical version numbers are skipped, so a planter never goes backwards.
 */
export function decideImport(incoming: PlanFile, latestLocal: PlanVersion | null): ImportDecision {
  if (!latestLocal || latestLocal.blockId !== incoming.version.blockId) return { action: 'import' };
  if (incoming.version.version < latestLocal.version) return { action: 'skip', reason: 'older' };
  if (incoming.version.version === latestLocal.version) return { action: 'skip', reason: 'same' };
  return { action: 'import' };
}

// ---------- Suggestions (a proposed plan change sent to whoever publishes) ----------

export const SUGGESTION_FILE_EXTENSION = '.suggestion.cachelog';

export function makeSuggestion(block: Block, draft: Draft, author: string, message?: string): PlanSuggestion {
  if (draft.blockId !== block.id) throw new Error('This draft belongs to a different block.');
  const s: PlanSuggestion = {
    format: 'cachelog-suggestion',
    formatVersion: 1,
    blockId: block.id,
    blockName: block.name,
    baseVersion: draft.baseVersion,
    author,
    createdAt: nowIso(),
    content: deepCopy(draft.content),
  };
  if (message && message.trim()) s.message = message.trim();
  return s;
}

export function serializeSuggestion(s: PlanSuggestion): string {
  return JSON.stringify(s);
}

export function parseSuggestion(text: string): PlanSuggestion {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new PlanFileError("This suggestion file couldn't be read. Ask for it to be sent again.");
  }
  if (!isObj(raw) || raw.format !== 'cachelog-suggestion') throw new PlanFileError("This file isn't a Cachelog plan suggestion.");
  if (typeof raw.formatVersion === 'number' && raw.formatVersion > 1) {
    throw new PlanFileError('This suggestion was made with a newer version of Cachelog. Update the app, then open it again.');
  }
  try {
    str(raw.blockId, 'the block id', { nonEmpty: true });
    str(raw.blockName, 'the block name');
    str(raw.author, 'the author');
    str(raw.message, 'the message', { optional: true });
    str(raw.createdAt, 'the date');
    if (raw.baseVersion !== null) num(raw.baseVersion, 'the base version', { integer: true, min: 1 });
    validateContent(raw.content);
    if ((raw.content as Obj).blockId !== raw.blockId) throw new Damaged("the suggestion doesn't match its block");
  } catch (e) {
    if (e instanceof Damaged) throw new PlanFileError(`This suggestion file is damaged (${e.message}). Ask for it to be sent again.`);
    throw e;
  }
  return raw as unknown as PlanSuggestion;
}

/** Which kind of Cachelog file this is, so one Import button (or tapping an AirDropped file) can route it. */
export type CachelogFileKind = 'plan' | 'updates' | 'suggestion' | 'unknown';
export function sniffFile(text: string): CachelogFileKind {
  // The format marker is the first key; avoid parsing multi-megabyte plan files twice.
  const head = text.slice(0, 200);
  if (/"format"\s*:\s*"cachelog-plan"/.test(head)) return 'plan';
  if (/"format"\s*:\s*"cachelog-log"/.test(head)) return 'updates';
  if (/"format"\s*:\s*"cachelog-suggestion"/.test(head)) return 'suggestion';
  try {
    const f = (JSON.parse(text) as { format?: unknown }).format;
    return f === 'cachelog-plan' ? 'plan' : f === 'cachelog-log' ? 'updates' : f === 'cachelog-suggestion' ? 'suggestion' : 'unknown';
  } catch {
    return 'unknown';
  }
}
