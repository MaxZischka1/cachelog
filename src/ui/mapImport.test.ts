/**
 * importMapAnywhere against the in-memory store. The file importer, alerts and file system are
 * stubbed; the block choice itself is covered in src/import/target.test.ts.
 */
import type { Block, LngLat, Piece, RasterLayer, VectorLayer } from '../core/types';
import { MemoryStore } from '../db/memoryStore';
import type { ImportResult } from '../import';

const importMapFile = jest.fn<Promise<ImportResult>, [string, string]>();
const choose = jest.fn();
const confirm = jest.fn();
const deleted: string[] = [];

jest.mock('../import', () => ({ importMapFile: (uri: string, name: string) => importMapFile(uri, name) }));
jest.mock('./alerts', () => ({ choose: (...a: unknown[]) => choose(...a), confirm: (...a: unknown[]) => confirm(...a) }));
jest.mock(
  'expo-file-system',
  () => ({ File: class { exists = true; constructor(public uri: string) {} delete() { deleted.push(this.uri); } } }),
  { virtual: true },
);

import { describeMapBatch, describeMapImport, importMapAnywhere } from './mapImport';

const MAP_CORNERS: [LngLat, LngLat, LngLat, LngLat] = [[-114.675, 56.423], [-114.656, 56.424], [-114.654, 56.412], [-114.674, 56.411]];
const raster = (name = 'BLK_5050853586', id = 'r1'): ImportResult => ({
  kind: 'raster',
  layer: { id, kind: 'raster', name, imageUri: `file:///maps/${id}.png`, corners: MAP_CORNERS } as RasterLayer,
  warnings: [],
});
const SHEET = {
  source: 'BLK_5050853586.pdf', openingNumber: '5050853586', plantAreaHa: 3.29,
  prescriptions: [{ species: 'SW', treesPerHa: 600, totalTrees: 2430, boxes: 9, treesPerBox: 270, stockType: 'S410A' }],
};
const withSheet = (r: ImportResult): ImportResult => ({ ...r, sheet: SHEET }) as ImportResult;
const block = (id: string, name: string, layers: Block['layers'] = []): Block =>
  ({ id, name, pricesCents: {}, emergency: {}, layers, createdAt: '2026-05-01T00:00:00.000Z' }) as Block;
const otherLayer = (lng: number, lat: number): RasterLayer => ({
  id: `o${lng}`, kind: 'raster', name: 'old', imageUri: 'file:///o.png',
  corners: [[lng, lat + 0.01], [lng + 0.01, lat + 0.01], [lng + 0.01, lat], [lng, lat]],
});

const file = { uri: 'file:///Inbox/BLK_5050853586.pdf', name: 'BLK_5050853586.pdf' };

beforeEach(() => {
  importMapFile.mockReset();
  choose.mockReset();
  confirm.mockReset();
  deleted.length = 0;
});

test('no blocks: makes a new block named after the file, holding the map', async () => {
  const store = new MemoryStore();
  importMapFile.mockResolvedValue(raster());
  const out = await importMapAnywhere(store, file);
  expect(out!.created).toBe(true);
  const saved = await store.listBlocks();
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe('BLK 5050853586');
  expect(saved[0].layers.map((l) => l.id)).toEqual(['r1']);
  expect(choose).not.toHaveBeenCalled();
  expect(describeMapImport(out!)).toMatch(/new block “BLK 5050853586”/);
});

test('adds the map to the block it lies on, without asking', async () => {
  const store = new MemoryStore();
  await store.saveBlock(block('far', 'Far block', [otherLayer(-120, 50)]));
  await store.saveBlock(block('here', 'Opening 586', [otherLayer(-114.665, 56.415)]));
  importMapFile.mockResolvedValue(raster());
  const out = await importMapAnywhere(store, file);
  expect(out!.created).toBe(false);
  expect(out!.block.id).toBe('here');
  expect((await store.getBlock('here'))!.layers.map((l) => l.id)).toEqual(['o-114.665', 'r1']);
  expect((await store.getBlock('far'))!.layers).toHaveLength(1);
  expect(choose).not.toHaveBeenCalled();
});

test('started inside an empty block: uses that block', async () => {
  const store = new MemoryStore();
  await store.saveBlock(block('empty', 'New opening'));
  importMapFile.mockResolvedValue(raster());
  const out = await importMapAnywhere(store, file, 'empty');
  expect(out!.block.id).toBe('empty');
  expect(await store.listBlocks()).toHaveLength(1);
});

test('empty blocks and no overlap: asks; picking "New block" makes one', async () => {
  const store = new MemoryStore();
  await store.saveBlock(block('empty', 'New opening'));
  importMapFile.mockResolvedValue(raster());
  choose.mockResolvedValue('__new__');
  const out = await importMapAnywhere(store, file);
  expect(choose.mock.calls[0][2].map((o: { label: string }) => o.label)).toEqual(['New opening', 'New block']);
  expect(out!.created).toBe(true);
  expect(await store.listBlocks()).toHaveLength(2);
});

test('cancelling the question saves nothing and removes the rendered image', async () => {
  const store = new MemoryStore();
  await store.saveBlock(block('empty', 'New opening'));
  importMapFile.mockResolvedValue(raster());
  choose.mockResolvedValue(undefined);
  expect(await importMapAnywhere(store, file)).toBeNull();
  expect((await store.getBlock('empty'))!.layers).toEqual([]);
  expect(deleted).toEqual(['file:///maps/r1.png']);
});

test('vector map with polygons: offers pieces and adds them to the draft', async () => {
  const store = new MemoryStore();
  const piece = { id: 'p1', name: 'A', polygon: [[-114.67, 56.415], [-114.66, 56.415], [-114.66, 56.42], [-114.67, 56.415]] } as unknown as Piece;
  const layer: VectorLayer = {
    id: 'v1', kind: 'vector', name: 'bounds',
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [piece.polygon] } }] },
  } as unknown as VectorLayer;
  importMapFile.mockResolvedValue({ kind: 'vector', layer, pieces: [piece], warnings: [] });
  confirm.mockResolvedValue(true);
  const out = await importMapAnywhere(store, { uri: 'file:///b.kml', name: 'bounds.kml' });
  expect(out!.piecesAdded).toBe(1);
  expect((await store.getDraft(out!.block.id))!.content.pieces.map((p) => p.name)).toEqual(['A']);
  expect(describeMapImport(out!)).toMatch(/1 piece added/);
});

test('map sheet: new block is named by opening number and keeps the sheet', async () => {
  const store = new MemoryStore();
  importMapFile.mockResolvedValue(withSheet(raster()));
  const out = await importMapAnywhere(store, file);
  expect(out!.block.name).toBe('5050853586');
  expect((await store.getBlock(out!.block.id))!.sheet).toEqual(SHEET);
  expect(describeMapImport(out!)).toMatch(/Plant area 3.29 ha\. SW · 600\/ha · 2,430 trees · 9 boxes of 270 · S410A/);
});

test('map sheet: goes to the block with that opening number even when the map lies elsewhere', async () => {
  const store = new MemoryStore();
  await store.saveBlock(block('mine', 'Opening 5050853586', [otherLayer(-120, 50)]));
  await store.saveBlock(block('here', 'Neighbour', [otherLayer(-114.665, 56.415)]));
  importMapFile.mockResolvedValue(withSheet(raster()));
  const out = await importMapAnywhere(store, file);
  expect(out!.block.id).toBe('mine');
});

test('re-importing a revised map replaces the old copy and deletes its image', async () => {
  const store = new MemoryStore();
  importMapFile.mockResolvedValueOnce(raster('BLK_5050853586', 'r1'));
  const first = await importMapAnywhere(store, file);
  importMapFile.mockResolvedValueOnce(raster('BLK_5050853586', 'r2'));
  const second = await importMapAnywhere(store, file);
  expect(second!.block.id).toBe(first!.block.id);
  expect(second!.replaced).toBe(true);
  expect((await store.getBlock(first!.block.id))!.layers.map((l) => l.id)).toEqual(['r2']);
  expect(deleted).toEqual(['file:///maps/r1.png']);
  expect(describeMapImport(second!)).toMatch(/replaced the older copy/);
});

test('batch summary lists each block and what failed', async () => {
  const store = new MemoryStore();
  importMapFile.mockResolvedValue(withSheet(raster()));
  const out = await importMapAnywhere(store, file);
  const text = describeMapBatch([out!], [{ name: 'scan.pdf', reason: 'This PDF has no georeferencing' }]);
  expect(text).toMatch(/• 5050853586: new block · SW · 600\/ha/);
  expect(text).toMatch(/Not imported:\n• scan.pdf: This PDF has no georeferencing/);
});
