/** Minimal typings for upng-js (the package ships none). */
declare module 'upng-js' {
  export interface CompressedPng {
    ctype: number;
    depth: number;
    /** Palette entries as 0xAABBGGRR. */
    plte: number[];
    gotAlpha: boolean;
    frames: { cimg: Uint8Array; rect: { x: number; y: number; width: number; height: number } }[];
  }
  /**
   * Encode RGBA frames as PNG. cnum 0 = lossless.
   * NOTE: sizes its output buffer as input+100 bytes, which truncates tiny or incompressible
   * images; see png.ts for the safe wrapper.
   */
  export function encode(bufs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
  export namespace encode {
    function compressPNG(bufs: ArrayBuffer[], w: number, h: number, ps: number, forbidPlte?: boolean): CompressedPng;
  }
  export const crc: { crc(b: Uint8Array, o: number, l: number): number };
  export function decode(buf: ArrayBuffer): { width: number; height: number; depth: number; ctype: number; frames: unknown[]; tabs: Record<string, unknown>; data: ArrayBuffer };
  export function toRGBA8(img: ReturnType<typeof decode>): ArrayBuffer[];
}
