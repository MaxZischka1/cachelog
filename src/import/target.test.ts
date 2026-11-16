import type { Block, LngLat, RasterLayer } from '../core/types';
import type { Bounds } from '../map/geo';
import { boundsOverlap, chooseMapBlock, footprint, layerBounds, type BlockFootprint } from './target';

const box = (w: number, s: number, e: number, n: number): Bounds => [[w, s], [e, n]];
const MAP = box(-114.676, 56.411, -114.655, 56.424); // the plant opening map
const ON_MAP = box(-114.67, 56.415, -114.66, 56.42);
const ELSEWHERE = box(-120, 50, -119.9, 50.1);

const fp = (id: string, bounds: Bounds | null): BlockFootprint => ({ id, bounds });

describe('chooseMapBlock', () => {
  test('the one block the map covers', () => {
    expect(chooseMapBlock(MAP, [fp('a', ELSEWHERE), fp('b', ON_MAP), fp('c', null)])).toEqual({ kind: 'block', blockId: 'b', why: 'overlap' });
  });

  test('overlap wins over the block the import started in', () => {
    expect(chooseMapBlock(MAP, [fp('a', ELSEWHERE), fp('b', ON_MAP)], 'a')).toEqual({ kind: 'block', blockId: 'b', why: 'overlap' });
  });

  test('several covered: the current block if it is one, else ask', () => {
    const blocks = [fp('a', ON_MAP), fp('b', MAP), fp('c', ELSEWHERE)];
    expect(chooseMapBlock(MAP, blocks, 'b')).toEqual({ kind: 'block', blockId: 'b', why: 'current' });
    expect(chooseMapBlock(MAP, blocks, 'c')).toEqual({ kind: 'ask', candidates: ['a', 'b'] });
  });

  test('nothing covered, started inside an empty block: that block', () => {
    expect(chooseMapBlock(MAP, [fp('a', ELSEWHERE), fp('b', null)], 'b')).toEqual({ kind: 'block', blockId: 'b', why: 'current' });
  });

  test('nothing covered, started inside a block mapped elsewhere: not that block', () => {
    expect(chooseMapBlock(MAP, [fp('a', ELSEWHERE)], 'a')).toEqual({ kind: 'new' });
  });

  test('nothing covered and no empty blocks: new block', () => {
    expect(chooseMapBlock(MAP, [])).toEqual({ kind: 'new' });
    expect(chooseMapBlock(MAP, [fp('a', ELSEWHERE)])).toEqual({ kind: 'new' });
  });

  test('nothing covered but empty blocks exist: ask', () => {
    expect(chooseMapBlock(MAP, [fp('a', ELSEWHERE), fp('b', null), fp('c', null)])).toEqual({ kind: 'ask', candidates: ['b', 'c'] });
  });

  test('opening number on the sheet wins, even for a block with nothing on its map yet', () => {
    const blocks: BlockFootprint[] = [{ id: 'a', bounds: ON_MAP }, { id: 'b', bounds: null, opening: '5050853586' }];
    expect(chooseMapBlock(MAP, blocks, undefined, '5050853586')).toEqual({ kind: 'block', blockId: 'b', why: 'opening' });
    // No block has that opening: falls back to where the map lies.
    expect(chooseMapBlock(MAP, blocks, undefined, '999999')).toEqual({ kind: 'block', blockId: 'a', why: 'overlap' });
  });

  test('a map with no usable coordinates never matches by overlap', () => {
    expect(chooseMapBlock(null, [fp('a', ON_MAP)])).toEqual({ kind: 'new' });
  });
});

describe('helpers', () => {
  test('boundsOverlap includes touching edges', () => {
    expect(boundsOverlap(box(0, 0, 1, 1), box(1, 1, 2, 2))).toBe(true);
    expect(boundsOverlap(box(0, 0, 1, 1), box(1.1, 0, 2, 1))).toBe(false);
  });

  test('layerBounds and footprint', () => {
    const corners: [LngLat, LngLat, LngLat, LngLat] = [[-114.675, 56.423], [-114.656, 56.424], [-114.654, 56.412], [-114.674, 56.411]];
    const layer: RasterLayer = { id: 'r', kind: 'raster', name: 'm', imageUri: 'file:///m.png', corners };
    expect(layerBounds(layer)).toEqual(box(-114.675, 56.411, -114.654, 56.424));
    const block = { id: 'b', name: 'B', pricesCents: {}, emergency: {}, layers: [layer], createdAt: '' } as unknown as Block;
    expect(footprint(block, null)).toEqual({ id: 'b', bounds: box(-114.675, 56.411, -114.654, 56.424) });
    expect(footprint({ ...block, layers: [] }, null)).toEqual({ id: 'b', bounds: null });
    expect(footprint({ ...block, layers: [], name: 'Opening 5050853586' }, null).opening).toBe('5050853586');
    expect(footprint({ ...block, layers: [], sheet: { source: 'x.pdf', openingNumber: 'CP-22', prescriptions: [] } }, null).opening).toBe('CP-22');
  });
});
