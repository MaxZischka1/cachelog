/**
 * Private helpers for core/tally. Not exported from index.ts.
 * (core/plan has its own newId/geo helpers; this module deliberately does not import it.)
 */
import type { LngLat, Species, SpeciesCount } from '../types';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Random URL-safe id, 16 chars. Uses crypto.getRandomValues when present (Node, web), else Math.random (Hermes without a polyfill). */
export function newId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ID_ALPHABET[bytes[i] & 63];
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------- species count maths ----------

export type CountMap = Map<Species, number>;

export function addCounts(map: CountMap, trees: SpeciesCount[], sign = 1): CountMap {
  for (const t of trees) {
    if (!Number.isFinite(t.count)) continue;
    map.set(t.species, (map.get(t.species) ?? 0) + sign * t.count);
  }
  return map;
}

export function toCounts(map: CountMap, keepZero = false): SpeciesCount[] {
  return [...map.entries()]
    .filter(([, n]) => keepZero || n !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([species, count]) => ({ species, count }));
}

export function sumCounts(trees: SpeciesCount[]): number {
  let n = 0;
  for (const t of trees) if (Number.isFinite(t.count)) n += t.count;
  return n;
}

export function compareSpecies(a: Species, b: Species): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------- geo ----------

const EARTH_RADIUS_M = 6378137;

/**
 * Polygon area in hectares (spherical excess approximation, as used by GeoJSON area tools).
 * Ring need not be closed. Accurate to well under 1% for block-sized polygons.
 */
export function polygonAreaHa(ring: LngLat[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % n];
    total += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  const m2 = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return m2 / 10000;
}
