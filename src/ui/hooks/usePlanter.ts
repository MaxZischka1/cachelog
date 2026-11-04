import { useCallback } from 'react';
import { assignmentFor, decideImport, parsePlanFile } from '../../core/plan';
import { extractImages } from '../planFileImages';
import type { PlanFile, PlanVersion } from '../../core/types';
import { pickFile, readTextFile } from '../files';
import { fmtDateTime } from '../format';
import { useBlock, useBump, useLatestVersion, useSettings, useStore } from '../store';

/** The planter's view of their active block: plan, who they are, their piece and cache. */
export function usePlanterData() {
  const { settings, loading: settingsLoading, update } = useSettings();
  const blockId = settings?.activeBlockId;
  const { data: block } = useBlock(blockId);
  const { data: latest } = useLatestVersion(blockId);

  const plan = latest?.content ?? null;
  const planter = plan && settings?.planterId ? plan.planters.find((p) => p.id === settings.planterId) ?? null : null;
  const assignment = plan && planter ? assignmentFor(plan, planter.id) ?? null : null;
  const piece = plan && assignment ? plan.pieces.find((p) => p.id === assignment.pieceId) ?? null : null;
  const cache = plan && assignment?.cacheId ? plan.caches.find((c) => c.id === assignment.cacheId) ?? null : null;

  const loading = settingsLoading || (!!blockId && (block === undefined || latest === undefined));
  return { settings, update, blockId, block: block ?? null, latest: latest ?? null, plan, planter, assignment, piece, cache, loading };
}

export type ImportOutcome =
  | { status: 'cancelled' }
  | { status: 'imported'; file: PlanFile; replaced: PlanVersion | null; needsPlanter: boolean; droppedMaps: string[] }
  | { status: 'skipped'; file: PlanFile; message: string };

/** Document picker -> parse -> decide -> save block + version -> make it the active block. */
export function useImportPlan() {
  const store = useStore();
  const bump = useBump();
  const { update } = useSettings();

  return useCallback(async (): Promise<ImportOutcome> => {
    const picked = await pickFile();
    if (!picked) return { status: 'cancelled' };
    const text = await readTextFile(picked.uri);
    const file = parsePlanFile(text); // throws PlanFileError with a readable message
    const local = await store.getLatestVersion(file.block.id);
    const decision = decideImport(file, local);
    if (decision.action === 'skip') {
      const message =
        decision.reason === 'same'
          ? `This phone already has v${file.version.version} of ${file.block.name}. Nothing to do.`
          : `This phone already has a newer plan for ${file.block.name} (v${local?.version}, ${local ? fmtDateTime(local.publishedAt) : ''}). The file is v${file.version.version}, so it was not imported. Ask the crew boss for the latest file.`;
      // Still make it the active block so the brief shows the right plan.
      await update({ activeBlockId: file.block.id });
      return { status: 'skipped', file, message };
    }
    const { block, dropped } = await extractImages(file);
    await store.saveBlock(block);
    await store.addVersion(file.version);
    const current = await store.getSettings();
    const stillListed = !!current?.planterId && file.version.content.planters.some((p) => p.id === current.planterId);
    if (current) {
      await store.saveSettings({ ...current, activeBlockId: file.block.id, planterId: stillListed ? current.planterId : undefined });
    }
    bump();
    return { status: 'imported', file, replaced: local, needsPlanter: !stillListed, droppedMaps: dropped };
  }, [store, bump, update]);
}
