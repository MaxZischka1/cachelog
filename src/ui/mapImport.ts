/**
 * Import a map file (GeoPDF, GeoTIFF, KML, GeoJSON) from anywhere in the app: the Map layers
 * screen, the main Import button, or "Open in Cachelog" from Files, Mail or AirDrop.
 * Without a block given, it works out which block the map belongs to (see chooseMapBlock).
 */
import { File } from 'expo-file-system';
import { describeCutblock } from '../core/cutblock';
import { newId, nowIso, startDraft, today, updateDraft } from '../core/plan';
import type { Store } from '../core/store';
import type { Block, ID, MapLayer, Piece } from '../core/types';
import { importMapFile, type ImportResult } from '../import';
import { describePrescription } from '../import/pdfSheet';
import { chooseMapBlock, footprint, layerBounds } from '../import/target';
import { choose, confirm } from './alerts';
import { addPieces } from './planEdits';

const NEW_BLOCK = '__new__';

export interface MapImportOutcome {
  block: Block;
  /** True when a new block was made for this map. */
  created: boolean;
  /** True when it replaced an older copy of the same map on the block. */
  replaced: boolean;
  result: ImportResult;
  /** Set when polygons were offered as pieces and the boss said yes. */
  piecesAdded?: number;
}

/** Add pieces to the block's draft (starting one if needed); pieces whose name is already there are skipped. */
export async function addPiecesToDraft(store: Store, blockId: ID, pieces: Piece[]): Promise<number> {
  const existing = (await store.getDraft(blockId)) ?? startDraft(blockId, await store.getLatestVersion(blockId), today());
  const names = new Set(existing.content.pieces.map((p) => p.name.toLowerCase()));
  const fresh = pieces.filter((p) => !names.has(p.name.toLowerCase()));
  await store.saveDraft(updateDraft(existing, addPieces(fresh)));
  return fresh.length;
}

/** For a vector map with polygons, offer to add them as pieces. Returns how many were added. */
export async function offerPieces(store: Store, blockId: ID, result: ImportResult): Promise<number | undefined> {
  if (result.kind !== 'vector' || result.pieces.length === 0) return undefined;
  const n = result.pieces.length;
  const yes = await confirm(
    `${n} polygon${n === 1 ? '' : 's'} found`,
    'Add them as pieces to the draft plan? Pieces with a name already in the draft are skipped. You can review before publishing.',
    'Add pieces',
  );
  return yes ? addPiecesToDraft(store, blockId, result.pieces) : undefined;
}

/** A new block's name from the map's file name: "BLK_5050853586" -> "BLK 5050853586". */
export function blockNameFor(layerName: string): string {
  return layerName.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'New block';
}

function deleteImage(layer: MapLayer) {
  if (layer.kind !== 'raster') return;
  try {
    const f = new File(layer.imageUri);
    if (f.exists) f.delete();
  } catch {
    /* leave it; it's only a cache file */
  }
}

/**
 * Put an imported map on a block. A layer with the same name (a revised copy of the same map
 * file) is replaced in place rather than stacked; its old image is deleted. The sheet read from
 * the map (opening number, prescription) is stored on the block, and the cutblock outline drawn
 * on it replaces the block's earlier one (a block has one boundary).
 */
export function applyMapToBlock(block: Block, result: ImportResult): { block: Block; replaced: boolean } {
  const same = block.layers.findIndex((l) => l.kind === result.layer.kind && l.name === result.layer.name);
  let layers = [...block.layers];
  if (same >= 0) {
    deleteImage(layers[same]);
    layers[same] = result.layer;
  } else {
    layers.push(result.layer);
  }
  const next: Block = { ...block, layers };
  if (result.kind === 'raster' && result.sheet) next.sheet = result.sheet;
  if (result.kind === 'raster' && result.cutblock) {
    layers = layers.filter((l) => !(l.kind === 'vector' && l.role === 'cutblock'));
    // Drawn above the map image, below anything imported later.
    layers.splice(layers.indexOf(result.layer) + 1, 0, result.cutblock);
    next.layers = layers;
  }
  return { block: next, replaced: same >= 0 };
}

/**
 * Import `file` and put it on the right block: the block it lies on, the block the import was
 * started from (`currentBlockId`) if that block is still empty, or a new block named after the
 * file. Asks only when several blocks could fit. Resolves null if the boss cancels.
 */
export async function importMapAnywhere(store: Store, file: { uri: string; name: string }, currentBlockId?: ID): Promise<MapImportOutcome | null> {
  const result = await importMapFile(file.uri, file.name);
  const sheet = result.kind === 'raster' ? result.sheet : undefined;
  const blocks = await store.listBlocks();
  const footprints = await Promise.all(blocks.map(async (b) => footprint(b, (await store.getLatestVersion(b.id))?.content ?? null)));
  const target = chooseMapBlock(layerBounds(result.layer), footprints, currentBlockId, sheet?.openingNumber);

  let blockId: ID | undefined;
  if (target.kind === 'block') {
    blockId = target.blockId;
  } else if (target.kind === 'ask') {
    const picked = await choose(`Which block is “${result.layer.name}” for?`, undefined, [
      ...target.candidates.map((id) => ({ label: blocks.find((b) => b.id === id)?.name ?? id, value: id })),
      { label: 'New block', value: NEW_BLOCK },
    ]);
    if (picked === undefined) {
      deleteImage(result.layer);
      return null;
    }
    if (picked !== NEW_BLOCK) blockId = picked;
  }

  const existing = blockId ? blocks.find((b) => b.id === blockId) : undefined;
  const base: Block = existing ?? {
    id: newId(),
    name: sheet?.openingNumber ?? blockNameFor(result.layer.name),
    pricesCents: {},
    emergency: {},
    layers: [],
    createdAt: nowIso(),
  };
  const { block, replaced } = applyMapToBlock(base, result);
  await store.saveBlock(block);
  const piecesAdded = await offerPieces(store, block.id, result);
  return { block, created: !existing, replaced, result, piecesAdded };
}

/** Summary after importing several maps at once. */
export function describeMapBatch(outcomes: MapImportOutcome[], failed: { name: string; reason: string }[]): string {
  const lines = outcomes.map((o) => {
    const sheet = o.result.kind === 'raster' ? o.result.sheet : undefined;
    const rx = sheet?.prescriptions.map(describePrescription).filter(Boolean).join('; ');
    const what = o.created ? 'new block' : o.replaced ? 'map updated' : 'map added';
    const cut = o.result.kind === 'raster' ? describeCutblock(o.result.cutblock) : null;
    return `• ${o.block.name}: ${what}${cut ? ` · cutblock ${cut}` : ''}${rx ? ` · ${rx}` : ''}`;
  });
  if (failed.length) lines.push('', 'Not imported:', ...failed.map((f) => `• ${f.name}: ${f.reason}`));
  const warnings = outcomes.flatMap((o) => o.result.warnings.map((w) => `${o.result.layer.name}: ${w}`));
  if (warnings.length) lines.push('', ...warnings);
  return lines.join('\n');
}

/** One-paragraph summary for an alert after an import. */
export function describeMapImport(o: MapImportOutcome): string {
  const what = o.result.kind === 'raster' ? 'map' : 'map layer';
  const lines = [
    o.created
      ? `Made a new block “${o.block.name}” with this ${what}. Tap Edit at the top of the block to add prices and emergency info.`
      : o.replaced
        ? `Updated the ${what} “${o.result.layer.name}” on ${o.block.name} (replaced the older copy).`
        : `Added the ${what} “${o.result.layer.name}” to ${o.block.name}.`,
  ];
  const sheet = o.result.kind === 'raster' ? o.result.sheet : undefined;
  if (sheet) {
    const area = sheet.plantAreaHa !== undefined ? `Plant area ${sheet.plantAreaHa} ha. ` : '';
    const rx = sheet.prescriptions.map(describePrescription).filter(Boolean);
    if (area || rx.length) lines.push(`From the map sheet: ${area}${rx.join('; ')}`.trim());
  }
  const cut = o.result.kind === 'raster' ? describeCutblock(o.result.cutblock) : null;
  if (cut) lines.push(`Block outline read from the map: ${cut}. It's on the map, and planters see when they leave the block.`);
  if (o.piecesAdded !== undefined) lines.push(`${o.piecesAdded} piece${o.piecesAdded === 1 ? '' : 's'} added to the draft plan.`);
  lines.push(...o.result.warnings);
  return lines.join('\n\n');
}
