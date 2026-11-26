/**
 * Shared "add a map to a block" flow, used by the main Import button, "Open in Cachelog" and the
 * Map layers screen: import the file, save its layers on the block, offer its shapes as pieces.
 */
import { newId, nowIso, startDraft, today, updateDraft } from '../core/plan';
import type { Block, ID, Piece } from '../core/types';
import { importMapFile, type ImportResult } from '../import';
import type { Store } from '../core/store';
import { confirm } from './alerts';
import { addPieces } from './planEdits';

const MAP_EXT = /\.(pdf|tiff?|kml|kmz|geojson|shp|zip)$/i;

/** True for files that are maps (go to the map importer), not Cachelog plan/update files. */
export function isMapFileName(name: string): boolean {
  const bare = decodeURIComponent(name.split(/[?#]/)[0]);
  return MAP_EXT.test(bare);
}

/** "Block: E642840" / "Block Number: 0360" / "Opening Number: 5250930360" from the map's text. */
export function blockNameFromText(text: string[], fallback: string): string {
  const joined = text.join(' ').replace(/\s+/g, ' ');
  const pats = [/\bBlock(?:\s+(?:Number|No\.?|ID))?\s*[:#]\s*([A-Z]{0,3}\d[\w-]{2,})/i, /\bOpening(?:\s+(?:Number|No\.?))?\s*[:#]\s*(\d{4,})/i];
  for (const re of pats) {
    const m = re.exec(joined);
    if (m) return `Block ${m[1]}`;
  }
  return fallback.length > 40 ? `${fallback.slice(0, 38)}…` : fallback;
}

async function addPiecesToDraft(store: Store, blockId: ID, pieces: Piece[]): Promise<number> {
  const existing = (await store.getDraft(blockId)) ?? startDraft(blockId, await store.getLatestVersion(blockId), today());
  const names = new Set(existing.content.pieces.map((p) => p.name.toLowerCase()));
  const fresh = pieces.filter((p) => !names.has(p.name.toLowerCase()));
  await store.saveDraft(updateDraft(existing, addPieces(fresh)));
  return fresh.length;
}

export interface MapImportOutcome {
  block: Block;
  result: ImportResult;
  piecesAdded?: number;
}

/** Import a map file into a block (or a new block when `block` is null). Asks before adding pieces. */
export async function importMapIntoBlock(store: Store, block: Block | null, uri: string, name: string): Promise<MapImportOutcome> {
  const result = await importMapFile(uri, name);
  const added = result.kind === 'geopdf' && result.outline ? [result.layer, result.outline] : [result.layer];
  const target: Block = block
    ? { ...block, layers: [...block.layers, ...added] }
    : {
        id: newId(),
        name: blockNameFromText(result.kind === 'geopdf' ? result.text : [], result.layer.name),
        pricesCents: {},
        emergency: {},
        layers: added,
        createdAt: nowIso(),
      };
  await store.saveBlock(target);

  let piecesAdded: number | undefined;
  const pieces = result.kind === 'geopdf' || result.kind === 'vector' ? result.pieces : [];
  if (pieces.length > 0) {
    const src = result.kind === 'geopdf' ? result.outline?.name.split(': ').slice(1).join(': ') || 'the map' : 'the file';
    const yes = await confirm(
      `Found ${pieces.length} shape${pieces.length === 1 ? '' : 's'} in “${src}”`,
      'Add them as pieces to the draft plan? You can rename or delete them before publishing.',
      'Add pieces',
    );
    if (yes) piecesAdded = await addPiecesToDraft(store, target.id, pieces);
  }
  return { block: target, result, piecesAdded };
}
