import type { DayString, Timestamp } from '../types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ID_LENGTH = 16;

type CryptoLike = { getRandomValues<T extends ArrayBufferView | null>(array: T): T };

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    try {
      c.getRandomValues(bytes);
      return bytes;
    } catch {
      // fall through to Math.random (some Hermes builds expose a stub that throws)
    }
  }
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** Random, URL-safe, 16 characters (96 bits). */
export function newId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let out = '';
  for (let i = 0; i < ID_LENGTH; i++) out += ALPHABET[bytes[i] & 63];
  return out;
}

export function nowIso(): Timestamp {
  return new Date().toISOString();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar date as YYYY-MM-DD. */
export function dayString(d: Date): DayString {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today's local date as YYYY-MM-DD. */
export function today(): DayString {
  return dayString(new Date());
}
