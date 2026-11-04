/**
 * Plain-language plan diff for the crew boss Review screen.
 *
 * Order of the output:
 *   1. plan day
 *   2. planters and their assignments (grouped per planter, in the new plan's order; removed planters last)
 *   3. caches (new plan's order, removed caches last)
 *   4. pieces (same)
 *   5. hazards (same)
 *   6. plan notes
 *
 * Entities are matched by id. Point moves under 5 m and polygon edits where every vertex moved
 * under 5 m are ignored (GPS / finger jitter).
 *
 * First publish (before = null): everything is "added", but to stay readable on a phone each
 * category with more than FIRST_PUBLISH_LIST_MAX items collapses into one summary line,
 * e.g. "Added 12 caches (9,600 Sx, 4,800 Pl)" or "12 planters assigned to 5 pieces".
 * Hazards are never collapsed (safety). Later diffs are never collapsed.
 */
import type {
  Assignment,
  Cache,
  Hazard,
  ID,
  LngLat,
  Piece,
  PlanChange,
  PlanContent,
  Planter,
  Prescription,
  SpeciesCount,
} from '../types';
import { bearingDeg, centroid, compass, distanceM, polygonAreaHa } from './geo';

export const MIN_MOVE_M = 5;
export const FIRST_PUBLISH_LIST_MAX = 5;

// ---------- formatting ----------

/** 1200 -> "1,200"; -1500 -> "-1,500"; non-integers keep up to 2 decimals. */
export function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const neg = n < 0;
  const abs = Math.abs(n);
  const rounded = Math.round(abs * 100) / 100;
  const [int, frac] = String(rounded).split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${withSep}${frac ? `.${frac}` : ''}`;
}

/** Distances rounded the way people say them: 5 m steps under 100 m, 10 m under 1 km, then km. */
export function fmtDistance(m: number): string {
  if (m < 100) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  if (m < 995) return `${Math.round(m / 10) * 10} m`;
  if (m < 9950) return `${(Math.round(m / 100) / 10).toFixed(1)} km`;
  return `${fmtNumber(Math.round(m / 1000))} km`;
}

/** Hectares with 1 decimal (2 decimals for tiny areas under 0.1 ha). */
export function fmtHa(ha: number): string {
  if (ha > 0 && ha < 0.095) return `${ha.toFixed(2)} ha`;
  return `${ha.toFixed(1)} ha`;
}

/** Merge duplicate species, keeping the order the crew boss entered them; zeros dropped. */
function mergeSpecies(trees: SpeciesCount[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trees) m.set(t.species, (m.get(t.species) ?? 0) + t.count);
  for (const [k, v] of m) if (v === 0) m.delete(k);
  return m;
}

function fmtTrees(trees: SpeciesCount[]): string {
  const sums = [...mergeSpecies(trees)];
  if (sums.length === 0) return 'no trees';
  return sums.map(([species, count]) => `${fmtNumber(count)} ${species}`).join(', ');
}

const NOTE_MAX = 60;
function quote(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return `“${t.length > NOTE_MAX ? `${t.slice(0, NOTE_MAX - 1)}…` : t}”`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-05-13" -> "Wed May 13" (timezone independent). */
export function fmtDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return day;
  return `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[mo - 1]} ${d}`;
}

function hazardLabel(h: Hazard): string {
  const t = h.note.trim().replace(/\s+/g, ' ');
  if (!t) return 'unnamed hazard';
  return t.length > NOTE_MAX ? `${t.slice(0, NOTE_MAX - 1)}…` : t;
}

// ---------- geometry comparisons ----------

function moveText(a: LngLat, b: LngLat): string | null {
  const d = distanceM(a, b);
  if (!(d >= MIN_MOVE_M)) return null;
  return `moved ${fmtDistance(d)} ${compass(bearingDeg(a, b))}`;
}

function ringChanged(a: LngLat[], b: LngLat[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (distanceM(a[i], b[i]) >= MIN_MOVE_M) return true;
  }
  return false;
}

// ---------- helpers ----------

function byId<T extends { id: ID }>(list: T[]): Map<ID, T> {
  const m = new Map<ID, T>();
  for (const x of list) if (!m.has(x.id)) m.set(x.id, x);
  return m;
}

function assignmentsByPlanter(list: Assignment[]): Map<ID, Assignment> {
  const m = new Map<ID, Assignment>();
  for (const a of list) if (!m.has(a.planterId)) m.set(a.planterId, a);
  return m;
}

function notesText(prefix: string, before: string | undefined, after: string | undefined): string | null {
  const b = (before ?? '').trim();
  const a = (after ?? '').trim();
  if (a === b) return null;
  if (!a) return `${prefix} notes removed`;
  if (!b) return `${prefix} notes added: ${quote(a)}`;
  return `${prefix} notes changed: ${quote(a)}`;
}

function treeChanges(before: SpeciesCount[], after: SpeciesCount[]): string[] {
  const b = mergeSpecies(before);
  const a = mergeSpecies(after);
  const species = [...new Set([...a.keys(), ...b.keys()])];
  const out: string[] = [];
  for (const s of species) {
    const x = b.get(s) ?? 0;
    const y = a.get(s) ?? 0;
    if (x !== y) out.push(`${s} ${fmtNumber(x)} → ${fmtNumber(y)}`);
  }
  return out;
}

function prescriptionChanges(before: Prescription | undefined, after: Prescription | undefined): string[] {
  const b = before ?? {};
  const a = after ?? {};
  const out: string[] = [];
  const num = (label: string, unit: string, x: number | undefined, y: number | undefined) => {
    if (x === y) return;
    if (y === undefined) out.push(`${label} removed`);
    else if (x === undefined) out.push(`${label} set to ${fmtNumber(y)}${unit}`);
    else out.push(`${label} ${fmtNumber(x)} → ${fmtNumber(y)}${unit}`);
  };
  num('density', '/ha', b.densityPerHa, a.densityPerHa);
  num('spacing', ' m', b.spacingM, a.spacingM);
  const bs = (b.species ?? []).join(', ');
  const as = (a.species ?? []).join(', ');
  if (bs !== as) {
    if (!as) out.push('species removed');
    else if (!bs) out.push(`species set to ${as}`);
    else out.push(`species ${bs} → ${as}`);
  }
  return out;
}

// ---------- sections ----------

interface Ctx {
  before: PlanContent;
  after: PlanContent;
}

function pieceName(ctx: Ctx, id: ID, side: 'before' | 'after'): string {
  const primary = side === 'after' ? ctx.after : ctx.before;
  const other = side === 'after' ? ctx.before : ctx.after;
  return (
    primary.pieces.find((p) => p.id === id)?.name ?? other.pieces.find((p) => p.id === id)?.name ?? 'an unknown piece'
  );
}

function cacheName(ctx: Ctx, id: ID, side: 'before' | 'after'): string {
  const primary = side === 'after' ? ctx.after : ctx.before;
  const other = side === 'after' ? ctx.before : ctx.after;
  return (
    primary.caches.find((c) => c.id === id)?.name ?? other.caches.find((c) => c.id === id)?.name ?? 'an unknown cache'
  );
}

function assignmentChange(ctx: Ctx, name: string, planterId: ID, b?: Assignment, a?: Assignment): PlanChange | null {
  if (!b && !a) return null;
  if (!b && a) {
    const cache = a.cacheId ? ` (${cacheName(ctx, a.cacheId, 'after')})` : '';
    return {
      kind: 'assignment-added',
      text: `${name} assigned to ${pieceName(ctx, a.pieceId, 'after')}${cache}`,
      ids: [planterId, a.pieceId, ...(a.cacheId ? [a.cacheId] : [])],
    };
  }
  if (b && !a) {
    return { kind: 'assignment-removed', text: `${name} unassigned`, ids: [planterId, b.pieceId] };
  }
  const x = b as Assignment;
  const y = a as Assignment;
  const parts: string[] = [];
  const ids: ID[] = [planterId];
  if (x.pieceId !== y.pieceId) {
    parts.push(`${pieceName(ctx, x.pieceId, 'before')} → ${pieceName(ctx, y.pieceId, 'after')}`);
    ids.push(x.pieceId, y.pieceId);
  }
  if ((x.cacheId ?? null) !== (y.cacheId ?? null)) {
    const from = x.cacheId ? cacheName(ctx, x.cacheId, 'before') : 'no cache';
    const to = y.cacheId ? cacheName(ctx, y.cacheId, 'after') : 'no cache';
    parts.push(`${from} → ${to}`);
    if (x.cacheId) ids.push(x.cacheId);
    if (y.cacheId) ids.push(y.cacheId);
  }
  if (parts.length === 0) return null;
  return { kind: 'assignment-changed', text: `${name}: ${parts.join(', ')}`, ids };
}

function plantersSection(ctx: Ctx): PlanChange[] {
  const out: PlanChange[] = [];
  const bp = byId(ctx.before.planters);
  const ap = byId(ctx.after.planters);
  const ba = assignmentsByPlanter(ctx.before.assignments);
  const aa = assignmentsByPlanter(ctx.after.assignments);
  const seen = new Set<ID>();

  for (const p of ap.values()) {
    seen.add(p.id);
    const old = bp.get(p.id);
    if (!old) out.push({ kind: 'planter-added', text: `Added planter ${p.name}`, ids: [p.id] });
    else if (old.name !== p.name)
      out.push({ kind: 'planter-renamed', text: `Planter ${old.name} renamed to ${p.name}`, ids: [p.id] });
    const c = assignmentChange(ctx, p.name, p.id, ba.get(p.id), aa.get(p.id));
    if (c) out.push(c);
  }
  for (const p of bp.values()) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    // A removed planter's assignment going away is implied; don't add "unassigned".
    out.push({ kind: 'planter-removed', text: `Removed planter ${p.name}`, ids: [p.id] });
    const a = aa.get(p.id);
    if (a) {
      const c = assignmentChange(ctx, p.name, p.id, ba.get(p.id), a);
      if (c) out.push(c);
    }
  }
  // Assignments for planters in neither list (inconsistent data): still report.
  for (const id of new Set([...ba.keys(), ...aa.keys()])) {
    if (seen.has(id)) continue;
    const c = assignmentChange(ctx, 'Unknown planter', id, ba.get(id), aa.get(id));
    if (c) out.push(c);
  }
  return out;
}

function cachesSection(ctx: Ctx): PlanChange[] {
  const out: PlanChange[] = [];
  const bc = byId(ctx.before.caches);
  const ac = byId(ctx.after.caches);
  for (const c of ac.values()) {
    const old = bc.get(c.id);
    if (!old) {
      out.push({ kind: 'cache-added', text: `Added ${c.name} (${fmtTrees(c.trees)})`, ids: [c.id] });
      continue;
    }
    if (old.name !== c.name)
      out.push({ kind: 'cache-renamed', text: `${old.name} renamed to ${c.name}`, ids: [c.id] });
    const mv = moveText(old.position, c.position);
    if (mv) out.push({ kind: 'cache-moved', text: `${c.name} ${mv}`, ids: [c.id] });
    const tc = treeChanges(old.trees, c.trees);
    if (tc.length) out.push({ kind: 'cache-trees', text: `${c.name}: ${tc.join(', ')}`, ids: [c.id] });
    const nt = notesText(c.name, old.notes, c.notes);
    if (nt) out.push({ kind: 'cache-notes', text: nt, ids: [c.id] });
  }
  for (const c of bc.values()) {
    if (!ac.has(c.id)) out.push({ kind: 'cache-removed', text: `Removed ${c.name}`, ids: [c.id] });
  }
  return out;
}

function pieceAddedText(p: Piece): string {
  const extra = p.prescription?.densityPerHa !== undefined ? `, ${fmtNumber(p.prescription.densityPerHa)}/ha` : '';
  return `Added ${p.name} (${fmtHa(polygonAreaHa(p.polygon))}${extra})`;
}

function piecesSection(ctx: Ctx): PlanChange[] {
  const out: PlanChange[] = [];
  const bp = byId(ctx.before.pieces);
  const ap = byId(ctx.after.pieces);
  for (const p of ap.values()) {
    const old = bp.get(p.id);
    if (!old) {
      out.push({ kind: 'piece-added', text: pieceAddedText(p), ids: [p.id] });
      continue;
    }
    if (old.name !== p.name)
      out.push({ kind: 'piece-renamed', text: `${old.name} renamed to ${p.name}`, ids: [p.id] });
    if (ringChanged(old.polygon, p.polygon)) {
      const x = fmtHa(polygonAreaHa(old.polygon));
      const y = fmtHa(polygonAreaHa(p.polygon));
      const text =
        x === y ? `${p.name} reshaped (still ${y})` : `${p.name} reshaped (${x.replace(' ha', '')} → ${y})`;
      out.push({ kind: 'piece-reshaped', text, ids: [p.id] });
    }
    const rx = prescriptionChanges(old.prescription, p.prescription);
    if (rx.length)
      out.push({ kind: 'piece-prescription', text: `${p.name} prescription: ${rx.join(', ')}`, ids: [p.id] });
    const nt = notesText(p.name, old.notes, p.notes);
    if (nt) out.push({ kind: 'piece-notes', text: nt, ids: [p.id] });
  }
  for (const p of bp.values()) {
    if (!ap.has(p.id)) out.push({ kind: 'piece-removed', text: `Removed ${p.name}`, ids: [p.id] });
  }
  return out;
}

function hazardPoint(h: Hazard): LngLat | null {
  if (h.geometry.length === 0) return null;
  return h.kind === 'point' || h.geometry.length < 3 ? h.geometry[0] : centroid(h.geometry);
}

function hazardsSection(ctx: Ctx): PlanChange[] {
  const out: PlanChange[] = [];
  const bh = byId(ctx.before.hazards);
  const ah = byId(ctx.after.hazards);
  for (const h of ah.values()) {
    const old = bh.get(h.id);
    if (!old) {
      const what = h.kind === 'area' ? 'New hazard area' : 'New hazard';
      out.push({ kind: 'hazard-added', text: `${what}: ${hazardLabel(h)}`, ids: [h.id] });
      continue;
    }
    const parts: string[] = [];
    const noteChanged = old.note.trim() !== h.note.trim();
    if (h.kind === 'point' && old.kind === 'point') {
      const a = hazardPoint(old);
      const b = hazardPoint(h);
      const mv = a && b ? moveText(a, b) : null;
      if (mv) parts.push(mv);
    } else if (h.kind !== old.kind || ringChanged(old.geometry, h.geometry)) {
      parts.push(h.kind === 'area' ? 'area changed' : 'now a point');
    }
    if (!noteChanged && parts.length === 0) continue;
    const text = noteChanged
      ? `Hazard changed: ${hazardLabel(old)} → ${hazardLabel(h)}${parts.length ? `, ${parts.join(', ')}` : ''}`
      : `Hazard ${parts.join(', ')}: ${hazardLabel(h)}`;
    out.push({ kind: 'hazard-changed', text, ids: [h.id] });
  }
  for (const h of bh.values()) {
    if (!ah.has(h.id)) out.push({ kind: 'hazard-removed', text: `Hazard removed: ${hazardLabel(h)}`, ids: [h.id] });
  }
  return out;
}

function planNotesChange(before: string | undefined, after: string | undefined): PlanChange[] {
  const t = notesText('Plan', before, after);
  return t ? [{ kind: 'notes-changed', text: t, ids: [] }] : [];
}

// ---------- first publish ----------

function plural(n: number, one: string, many: string): string {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}

function firstPublish(after: PlanContent): PlanChange[] {
  const out: PlanChange[] = [];
  const empty: PlanContent = { ...after, planters: [], caches: [], pieces: [], assignments: [], hazards: [], notes: undefined };
  const ctx: Ctx = { before: empty, after };

  // Planters + assignments
  const planters: Planter[] = [...byId(after.planters).values()];
  const assignments = [...assignmentsByPlanter(after.assignments).values()];
  if (planters.length > FIRST_PUBLISH_LIST_MAX) {
    out.push({ kind: 'planter-added', text: `Added ${plural(planters.length, 'planter', 'planters')}`, ids: planters.map((p) => p.id) });
    if (assignments.length) {
      const pieces = new Set(assignments.map((a) => a.pieceId));
      out.push({
        kind: 'assignment-added',
        text: `${plural(assignments.length, 'planter', 'planters')} assigned to ${plural(pieces.size, 'piece', 'pieces')}`,
        ids: [...new Set([...assignments.map((a) => a.planterId), ...pieces])],
      });
    }
  } else {
    out.push(...plantersSection(ctx));
  }

  // Caches
  const caches: Cache[] = [...byId(after.caches).values()];
  if (caches.length > FIRST_PUBLISH_LIST_MAX) {
    out.push({
      kind: 'cache-added',
      text: `Added ${plural(caches.length, 'cache', 'caches')} (${fmtTrees(caches.flatMap((c) => c.trees))})`,
      ids: caches.map((c) => c.id),
    });
  } else {
    out.push(...cachesSection(ctx));
  }

  // Pieces
  const pieces: Piece[] = [...byId(after.pieces).values()];
  if (pieces.length > FIRST_PUBLISH_LIST_MAX) {
    const total = pieces.reduce((s, p) => s + polygonAreaHa(p.polygon), 0);
    out.push({
      kind: 'piece-added',
      text: `Added ${plural(pieces.length, 'piece', 'pieces')} (${fmtHa(total)})`,
      ids: pieces.map((p) => p.id),
    });
  } else {
    out.push(...piecesSection(ctx));
  }

  // Hazards: always listed (safety)
  out.push(...hazardsSection(ctx));
  out.push(...planNotesChange(undefined, after.notes));
  return out;
}

// ---------- entry point ----------

export function diffPlans(before: PlanContent | null, after: PlanContent): PlanChange[] {
  if (before === null) return firstPublish(after);
  const ctx: Ctx = { before, after };
  const out: PlanChange[] = [];
  if (before.day !== after.day) {
    out.push({ kind: 'day-changed', text: `Plan day: ${fmtDay(before.day)} → ${fmtDay(after.day)}`, ids: [] });
  }
  out.push(...plantersSection(ctx));
  out.push(...cachesSection(ctx));
  out.push(...piecesSection(ctx));
  out.push(...hazardsSection(ctx));
  out.push(...planNotesChange(before.notes, after.notes));
  return out;
}
