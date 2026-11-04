/**
 * PNG encoding via upng-js's compressor, with our own exactly-sized chunk writer:
 * UPNG.encode allocates input+100 bytes and silently truncates small or noisy images.
 */
import * as UPNG from 'upng-js';

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, UPNG.crc.crc(out, 4, 4 + body.length) >>> 0);
  return out;
}

/** Lossless PNG (palette when <= 256 colours, else RGB(A)) from RGBA8 pixels. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: buffer size does not match dimensions');
  const buf = rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength ? (rgba.buffer as ArrayBuffer) : (rgba.slice().buffer as ArrayBuffer);
  const nimg = UPNG.encode.compressPNG([buf], width, height, 0, false);

  const parts: Uint8Array[] = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = nimg.depth;
  ihdr[9] = nimg.ctype;
  parts.push(chunk('IHDR', ihdr));
  parts.push(chunk('sRGB', new Uint8Array([1])));
  if (nimg.ctype === 3) {
    const n = nimg.plte.length;
    const plte = new Uint8Array(n * 3);
    const trns = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = nimg.plte[i];
      plte[i * 3] = c & 255;
      plte[i * 3 + 1] = (c >>> 8) & 255;
      plte[i * 3 + 2] = (c >>> 16) & 255;
      trns[i] = (c >>> 24) & 255;
    }
    parts.push(chunk('PLTE', plte));
    if (nimg.gotAlpha) parts.push(chunk('tRNS', trns));
  }
  parts.push(chunk('IDAT', nimg.frames[0].cimg));
  parts.push(chunk('IEND', new Uint8Array(0)));

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
