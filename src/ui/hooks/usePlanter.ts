import { assignmentFor } from '../../core/plan';
import { useBlock, useLatestVersion, useSettings } from '../store';

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
