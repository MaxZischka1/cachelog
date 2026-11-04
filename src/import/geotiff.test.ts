// quick-lru (used only by geotiff's HTTP source) ships ESM only, which Jest's CJS runtime can't load.
jest.mock('quick-lru', () => ({ __esModule: true, default: class QuickLRU<K, V> extends Map<K, V> {} }));

import { writeArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import * as UPNG from 'upng-js';
import type { LngLat } from '../core/types';
import { geotiffToRaster, MAX_RASTER_SIDE } from './index';

function metres(a: LngLat, b: LngLat): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function expectNear(actual: LngLat[], expected: LngLat[], tolM = 3) {
  expect(actual).toHaveLength(4);
  actual.forEach((p, i) => expect(metres(p, expected[i])).toBeLessThan(tolM));
}

function decode(png: Uint8Array) {
  const img = UPNG.decode(png.slice().buffer as ArrayBuffer);
  return { width: img.width, height: img.height, rgba: new Uint8Array(UPNG.toRGBA8(img)[0]) };
}

const toBuf = (ab: ArrayBuffer) => ab;

describe('geotiffToRaster', () => {
  test('EPSG:4326 RGB', async () => {
    const w = 8, h = 6;
    const px: number[] = [];
    for (let i = 0; i < w * h; i++) px.push(200, 100, 50);
    const buf = writeArrayBuffer(px, {
      width: w, height: h,
      ModelPixelScale: [0.001, 0.001, 0],
      ModelTiepoint: [0, 0, 0, -120, 52, 0],
      GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 1,
    });
    const r = await geotiffToRaster(toBuf(buf));
    expectNear(r.corners, [[-120, 52], [-119.992, 52], [-119.992, 51.994], [-120, 51.994]], 0.5);
    expect(r.warnings).toEqual([]);
    const img = decode(r.png);
    expect([img.width, img.height]).toEqual([w, h]);
    expect(Array.from(img.rgba.slice(0, 4))).toEqual([200, 100, 50, 255]);
  });

  test('NAD83 / UTM zone 10N (EPSG:26910) grayscale', async () => {
    const w = 20, h = 10;
    const px = Array.from({ length: w * h }, (_, i) => i % 256);
    const buf = writeArrayBuffer(px, {
      width: w, height: h,
      ModelPixelScale: [10, 10, 0],
      ModelTiepoint: [0, 0, 0, 500000, 5800000, 0],
      ProjectedCSTypeGeoKey: 26910, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1,
    });
    const r = await geotiffToRaster(toBuf(buf));
    const def = '+proj=utm +zone=10 +ellps=GRS80 +units=m +no_defs';
    const inv = (x: number, y: number) => proj4(def, 'WGS84', [x, y]) as LngLat;
    expectNear(r.corners, [inv(500000, 5800000), inv(500200, 5800000), inv(500200, 5799900), inv(500000, 5799900)]);
    // Zone 10 central meridian is 123° W.
    expect(r.corners[0][0]).toBeCloseTo(-123, 6);
    const img = decode(r.png);
    expect([img.width, img.height]).toEqual([w, h]);
    expect(Array.from(img.rgba.slice(4 * 7, 4 * 8))).toEqual([7, 7, 7, 255]);
  });

  test('BC Albers (EPSG:3005)', async () => {
    const buf = writeArrayBuffer(new Array(16).fill(128), {
      width: 4, height: 4,
      ModelPixelScale: [25, 25, 0],
      ModelTiepoint: [0, 0, 0, 1000000, 1000000, 0],
      ProjectedCSTypeGeoKey: 3005, GTModelTypeGeoKey: 1,
    });
    const r = await geotiffToRaster(toBuf(buf));
    // x_0 = 1,000,000 lies on the central meridian 126° W.
    expect(r.corners[0][0]).toBeCloseTo(-126, 6);
    expect(r.corners[0][1]).toBeGreaterThan(53);
    expect(r.corners[0][1]).toBeLessThan(55);
    expect(metres(r.corners[0], r.corners[1])).toBeCloseTo(100, 0);
  });

  test('PixelIsPoint shifts corners half a pixel', async () => {
    const buf = writeArrayBuffer([1, 2, 3, 4], {
      width: 2, height: 2,
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, -100, 50, 0],
      GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 2,
    });
    const r = await geotiffToRaster(toBuf(buf));
    expect(r.corners[0]).toEqual([-100.5, 50.5]);
    expect(r.corners[2]).toEqual([-98.5, 48.5]);
  });

  test('downsamples to the max side and warns', async () => {
    const w = MAX_RASTER_SIDE + 904, h = 4;
    const buf = writeArrayBuffer(new Uint8Array(w * h).fill(9), {
      width: w, height: h,
      ModelPixelScale: [0.0001, 0.0001, 0],
      ModelTiepoint: [0, 0, 0, -118, 54, 0],
      GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2,
    });
    const r = await geotiffToRaster(toBuf(buf));
    const img = decode(r.png);
    expect(img.width).toBe(MAX_RASTER_SIDE);
    expect(img.height).toBe(3);
    expect(r.warnings.join(' ')).toMatch(/downsampled/);
    // Corners still describe the full image.
    expect(r.corners[1][0]).toBeCloseTo(-118 + w * 0.0001, 9);
  });

  test('16-bit single band is stretched; nodata transparent', async () => {
    const buf = writeArrayBuffer(new Uint16Array([1000, 2000, 3000, 0]), {
      width: 2, height: 2,
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, -100, 50, 0],
      GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2,
      GDAL_NODATA: '0',
    });
    const r = await geotiffToRaster(toBuf(buf));
    const { rgba } = decode(r.png);
    expect(rgba[0]).toBe(0);
    expect(rgba[8]).toBe(255);
    expect(rgba[15]).toBe(0);
  });

  test('throws a readable error without georeferencing', async () => {
    const buf = writeArrayBuffer([1, 2, 3, 4], {
      width: 2, height: 2,
      ModelPixelScale: [1000, 1000, 0], ModelTiepoint: [0, 0, 0, 9e6, 9e6, 0],
      ProjectedCSTypeGeoKey: 2193, GTModelTypeGeoKey: 1,
    });
    await expect(geotiffToRaster(toBuf(buf))).rejects.toThrow(/Unsupported or missing projection/);
  });
});
