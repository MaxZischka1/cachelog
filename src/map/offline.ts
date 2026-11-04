import { OfflineManager, type OfflinePack } from '@maplibre/maplibre-react-native';
import type { Block, PlanContent } from '../core/types';
import { blockBounds, padBounds, toLngLatBounds } from './geo';
import { BASEMAP_STYLE_URL, OFFLINE_MAX_ZOOM, OFFLINE_MIN_ZOOM, OFFLINE_PAD_M } from './style';

/**
 * Downloads basemap tiles for the block area (padded ~1 km, zoom 10–16) for use without signal.
 * Replaces any earlier pack for the same block. `onProgress` receives 0–100.
 * Resolves when the pack is complete; rejects with a readable Error.
 */
export async function downloadOfflineRegion(
  block: Block,
  plan: PlanContent | null,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const b = blockBounds(block, plan);
  if (!b) {
    throw new Error('Nothing to download yet: import a block map or add pieces/caches first.');
  }
  const bounds = toLngLatBounds(padBounds(b, OFFLINE_PAD_M));

  // Drop older packs for this block so re-downloading doesn't pile up storage.
  try {
    const packs = await OfflineManager.getPacks();
    for (const p of packs) {
      if (p.metadata?.blockId === block.id) await OfflineManager.deletePack(p.id);
    }
  } catch {
    // Non-fatal: worst case an old pack lingers.
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let packId: string | null = null;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (packId) OfflineManager.removeListener(packId);
      if (err) reject(err);
      else {
        onProgress?.(100);
        resolve();
      }
    };

    OfflineManager.createPack(
      {
        mapStyle: BASEMAP_STYLE_URL,
        bounds,
        minZoom: OFFLINE_MIN_ZOOM,
        maxZoom: OFFLINE_MAX_ZOOM,
        metadata: { blockId: block.id, name: block.name, createdAt: new Date().toISOString() },
      },
      (_pack, status) => {
        if (settled) return;
        const pct = Number.isFinite(status.percentage) ? Math.max(0, Math.min(100, status.percentage)) : 0;
        onProgress?.(pct);
        if (status.state === 'complete') finish();
      },
      (_pack, error) => {
        finish(new Error(`Offline map download failed: ${error?.message || 'unknown error'}. Check your connection and try again.`));
      },
    )
      .then(async (pack: OfflinePack) => {
        packId = pack.id;
        if (settled) {
          OfflineManager.removeListener(pack.id);
          return;
        }
        // If everything was already cached, the "complete" event may fire before listeners attach.
        try {
          const st = await pack.status();
          if (st.state === 'complete') finish();
        } catch {
          // ignore; progress events will settle it
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        finish(new Error(`Could not start offline map download: ${msg}`));
      });
  });
}
