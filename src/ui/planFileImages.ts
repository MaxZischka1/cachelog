import { Directory, File, Paths } from 'expo-file-system';
import type { Block, PlanFile } from '../core/types';

/**
 * Raster layers point at image files on the crew boss's phone. When sharing, pack each image into
 * the plan file as base64; when importing, write them into this phone's maps folder and repoint
 * imageUri. Layers whose image is missing are dropped so the map never shows a broken overlay.
 */

export async function attachImages(file: PlanFile): Promise<{ file: PlanFile; missing: string[] }> {
  const images: Record<string, string> = {};
  const missing: string[] = [];
  for (const layer of file.block.layers) {
    if (layer.kind !== 'raster') continue;
    try {
      const f = new File(layer.imageUri);
      if (!f.exists) throw new Error('missing');
      images[layer.id] = await f.base64();
    } catch {
      missing.push(layer.name);
    }
  }
  return { file: Object.keys(images).length ? { ...file, images } : file, missing };
}

export async function extractImages(file: PlanFile): Promise<{ block: Block; dropped: string[] }> {
  const dir = new Directory(Paths.document, 'maps');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dropped: string[] = [];
  const layers: Block['layers'] = [];
  for (const layer of file.block.layers) {
    if (layer.kind !== 'raster') {
      layers.push(layer);
      continue;
    }
    const data = file.images?.[layer.id];
    if (!data) {
      dropped.push(layer.name);
      continue;
    }
    const out = new File(dir, `${file.block.id}-${layer.id}.png`);
    if (out.exists) out.delete();
    out.create();
    await out.write(data, { encoding: 'base64' });
    layers.push({ ...layer, imageUri: out.uri });
  }
  return { block: { ...file.block, layers }, dropped };
}
