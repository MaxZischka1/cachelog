jest.mock('../import', () => ({ importMapFile: jest.fn() }));
jest.mock('./alerts', () => ({ confirm: jest.fn() }));
import { blockNameFromText, isMapFileName } from './mapImport';

describe('isMapFileName', () => {
  it('spots map files by extension, even in encoded file URLs', () => {
    expect(isMapFileName('Silv - Planting Prescription AB (11x17)_E642840_01Jun26.pdf')).toBe(true);
    expect(isMapFileName('file:///var/mobile/Inbox/P20_EnRLD_2024%20Blocks.PDF')).toBe(true);
    expect(isMapFileName('ortho.tif')).toBe(true);
    expect(isMapFileName('block.kml')).toBe(true);
  });
  it('leaves Cachelog files to the plan importer', () => {
    expect(isMapFileName('Block 7 v3.cachelog')).toBe(false);
    expect(isMapFileName('sam-block7.updates.cachelog')).toBe(false);
  });
});

describe('blockNameFromText', () => {
  it('reads the block from an Alberta planting prescription', () => {
    expect(blockNameFromText(['Planting Prescription', 'Block:', 'E642840', 'Gross Block Area (ha): 183.7'], 'file')).toBe('Block E642840');
  });
  it('reads "Block Number" from a herbicide map', () => {
    expect(blockNameFromText(['Block Number:', '0360', 'Opening Number:', '5250930360'], 'file')).toBe('Block 0360');
  });
  it('falls back to a trimmed file name', () => {
    expect(blockNameFromText(['no ids here'], 'Silv - Planting Prescription AB (11x17)_E642840_01Jun26')).toBe('Silv - Planting Prescription AB (11x17…');
  });
});
