import type { Block, DayString, LngLat, PlanContent, SpeciesCount } from '../core/types';

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtCountsInline(v: SpeciesCount[]): string {
  if (v.length === 0) return 'none';
  return v.map((s) => `${fmtInt(s.count)} ${s.species}`).join(', ');
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

export function fmtDay(day: DayString): string {
  const [y, m, d] = day.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function shiftDay(day: DayString, delta: number): DayString {
  const [y, m, d] = day.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d + delta);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export function fmtLngLat(p: LngLat | undefined): string {
  if (!p) return 'not set';
  return `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
}

export function fmtHa(ha: number): string {
  return `${ha.toFixed(ha < 10 ? 2 : 1)} ha`;
}

export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Price in cents (may be fractional, e.g. 16.5) to a "$0.165" style string. */
export function fmtPrice(cents: number): string {
  const dollars = cents / 100;
  const s = dollars.toFixed(3).replace(/0$/, '');
  return `$${s}`;
}

/** "$0.165" / "0.16" / "16.5c" -> cents (one decimal of a cent kept). */
export function parsePriceToCents(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  const isCents = /c$|¢$/.test(t);
  const n = parseFloat(t.replace(/[$c¢\s]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return undefined;
  const cents = isCents ? n : n * 100;
  return Math.round(cents * 10) / 10;
}

/** Earnings estimate in cents from tree counts and block prices. */
export function earningsFor(trees: SpeciesCount[], block: Block): number {
  return trees.reduce((sum, t) => sum + t.count * (block.pricesCents[t.species] ?? 0), 0);
}

export function speciesFromBlock(block: Block | null | undefined, plan?: PlanContent | null): string[] {
  const set = new Set<string>(Object.keys(block?.pricesCents ?? {}));
  for (const rx of block?.sheet?.prescriptions ?? []) if (rx.species) set.add(rx.species);
  for (const c of plan?.caches ?? []) for (const t of c.trees) set.add(t.species);
  return [...set].sort();
}

export function sumCounts(lists: SpeciesCount[][]): SpeciesCount[] {
  const map = new Map<string, number>();
  for (const l of lists) for (const s of l) map.set(s.species, (map.get(s.species) ?? 0) + s.count);
  return [...map.entries()].map(([species, count]) => ({ species, count })).sort((a, b) => a.species.localeCompare(b.species));
}

export function safeFileName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plan';
}

/** "2 h 05 min", "12 min". */
export function fmtDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

/** "$1,234" from cents, whole dollars. */
export function fmtDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-CA')}`;
}
