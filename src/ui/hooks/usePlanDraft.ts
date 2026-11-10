import { useCallback, useEffect, useRef, useState } from 'react';
import { diffPlans, hasChanges, makeSuggestion, publish, PublishConflictError, rebaseDraft, startDraft, today, updateDraft } from '../../core/plan';
import type { Draft, ID, PlanChange, PlanContent, PlanSuggestion, PlanVersion } from '../../core/types';
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

  // The plan moved on under an open draft (quick change, revert, or a newer plan file was imported):
  // carry the draft's own edits onto the latest version instead of making the boss start over.
  const [mergeNotes, setMergeNotes] = useState<string[]>([]);
  const rebasing = useRef(false);
  useEffect(() => {
    const cur = local;
    if (!cur || !latest || !blockId || cur.blockId !== blockId || cur.baseVersion === latest.version || rebasing.current || pending.current > 0) return;
    rebasing.current = true;
    (async () => {
      try {
        const base = cur.baseVersion === null ? null : await store.getVersion(blockId, cur.baseVersion);
        const r = rebaseDraft(cur, base, latest);
        if (r.rebased && localRef.current === cur) {
          localRef.current = r.draft;
          setLocal(r.draft);
          setMergeNotes(r.conflicts);
          await persist(r.draft);
        }
      } finally {
        rebasing.current = false;
      }
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, latest, blockId]);

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
            `The plan changed to v${cur?.version} while this draft was open. Your draft has been moved onto v${cur?.version}; check the changes and publish again.`,
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

  /** Package the draft as a suggestion for whoever publishes this block's plan. Does not change anything here. */
  const makeDraftSuggestion = useCallback(
    async (message?: string): Promise<PlanSuggestion> => {
      if (!blockId) throw new Error('No block selected.');
      await saving.current;
      const draft = await store.getDraft(blockId);
      const block = await store.getBlock(blockId);
      if (!draft || !block) throw new Error('There is no draft to send.');
      return makeSuggestion(block, draft, settings?.userName ?? 'Crew', message);
    },
    [blockId, store, settings],
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
    makeDraftSuggestion,
    /** Notes from the last automatic merge onto a newer plan (things changed on both sides). */
    mergeNotes,
  };
}
