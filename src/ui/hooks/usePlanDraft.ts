import { useCallback, useEffect, useRef, useState } from 'react';
import { diffPlans, hasChanges, publish, PublishConflictError, startDraft, today, updateDraft } from '../../core/plan';
import type { Draft, ID, PlanChange, PlanContent, PlanVersion } from '../../core/types';
import { useBlock, useBump, useDraft, useLatestVersion, useSettings, useStore } from '../store';

/**
 * Everything the crew boss needs to edit today's draft.
 * Edits are applied to local state immediately and persisted in order.
 */
export function usePlanDraft(blockId: ID | undefined) {
  const store = useStore();
  const bump = useBump();
  const { settings } = useSettings();
  const blockQ = useBlock(blockId);
  const latestQ = useLatestVersion(blockId);
  const draftQ = useDraft(blockId);

  const [local, setLocal] = useState<Draft | null>(null);
  const localRef = useRef<Draft | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  // Adopt the stored draft whenever it reloads (but never overwrite newer local edits).
  useEffect(() => {
    if (draftQ.data === undefined || pending.current > 0) return;
    const stored = draftQ.data;
    const cur = localRef.current;
    if (!cur || !stored || stored.updatedAt >= cur.updatedAt || stored.blockId !== cur.blockId) {
      localRef.current = stored;
      setLocal(stored);
    }
  }, [draftQ.data]);

  const latest = latestQ.data ?? null;
  const loading = blockQ.data === undefined || latestQ.data === undefined || draftQ.data === undefined;

  const persist = useCallback(
    (d: Draft) => {
      pending.current += 1;
      saving.current = saving.current
        .catch(() => undefined)
        .then(() => store.saveDraft(d))
        .finally(() => {
          pending.current -= 1;
          bump();
        });
      return saving.current;
    },
    [store, bump],
  );

  /** Returns the draft, creating one from the latest published version (for today) if needed. */
  const ensureDraft = useCallback(async (): Promise<Draft> => {
    if (!blockId) throw new Error('No block selected.');
    if (localRef.current) return localRef.current;
    const stored = await store.getDraft(blockId);
    if (stored) {
      localRef.current = stored;
      setLocal(stored);
      return stored;
    }
    const fresh = startDraft(blockId, await store.getLatestVersion(blockId), today());
    localRef.current = fresh;
    setLocal(fresh);
    await persist(fresh);
    return fresh;
  }, [blockId, store, persist]);

  const edit = useCallback(
    async (fn: (c: PlanContent) => PlanContent) => {
      const base = await ensureDraft();
      const next = updateDraft(localRef.current ?? base, fn);
      localRef.current = next;
      setLocal(next);
      await persist(next);
    },
    [ensureDraft, persist],
  );

  const discard = useCallback(async () => {
    if (!blockId) return;
    await saving.current;
    await store.deleteDraft(blockId);
    localRef.current = null;
    setLocal(null);
    bump();
  }, [blockId, store, bump]);

  /** Publishes the draft. Throws PublishConflictError (with a readable message) when the base is stale. */
  const publishDraft = useCallback(
    async (message?: string): Promise<PlanVersion> => {
      if (!blockId) throw new Error('No block selected.');
      await saving.current;
      const draft = await store.getDraft(blockId);
      if (!draft) throw new Error('There is no draft to publish.');
      const cur = await store.getLatestVersion(blockId);
      let v: PlanVersion;
      try {
        v = publish(draft, cur, settings?.userName ?? 'Crew boss', message?.trim() || undefined);
      } catch (e) {
        if (e instanceof PublishConflictError) {
          throw new PublishConflictError(
            `This draft was started from v${draft.baseVersion ?? '–'}, but v${cur?.version} has been published since (quick change or revert). Discard the draft and plan again from v${cur?.version}.`,
          );
        }
        throw e;
      }
      await store.addVersion(v);
      await store.deleteDraft(blockId);
      localRef.current = null;
      setLocal(null);
      bump();
      return v;
    },
    [blockId, store, settings, bump],
  );

  const changes: PlanChange[] = local ? diffPlans(latest?.content ?? null, local.content) : [];
  const dirty = local ? hasChanges(local, latest) : false;

  return {
    block: blockQ.data ?? null,
    latest,
    draft: local,
    /** What the editor shows: the draft if any, else the latest published plan. */
    content: local?.content ?? latest?.content ?? null,
    changes,
    dirty,
    loading,
    ensureDraft,
    edit,
    discard,
    publishDraft,
  };
}
