import * as UPNG from 'upng-js';
import { encodePng } from './png';

function roundTrip(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const png = encodePng(rgba, w, h);
  // ends with a complete IEND chunk
  expect(Array.from(png.slice(-8, -4))).toEqual([73, 69, 78, 68]);
  const img = UPNG.decode(png.slice().buffer as ArrayBuffer);
  expect([img.width, img.height]).toEqual([w, h]);
  return new Uint8Array(UPNG.toRGBA8(img)[0]);
}

describe('encodePng', () => {
  test('tiny palette image (upng.encode would truncate this)', () => {
    const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 9, 9, 9, 255]);
    expect(Array.from(roundTrip(px, 2, 2))).toEqual(Array.from(px));
  });

  test('noisy truecolour image is lossless', () => {
    const w = 40, h = 30;
    const px = new Uint8Array(w * h * 4);
    let s = 12345;
    for (let i = 0; i < px.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      px[i] = i % 4 === 3 ? 255 : s >>> 24;
    }
    expect(Array.from(roundTrip(px, w, h))).toEqual(Array.from(px));
  });
});
