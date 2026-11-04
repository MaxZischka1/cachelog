/** Private id helper (core/plan's newId is built concurrently; same shape: ~16 URL-safe chars). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function newImportId(len = 16): string {
  const bytes = new Uint8Array(len);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] & 63];
  return s;
}
