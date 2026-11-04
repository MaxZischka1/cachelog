import type { DayString, Draft, ID, PlanContent, PlanVersion } from '../types';
import { deepCopy, deepEqual, emptyPlan } from './content';
import { nowIso, today } from './ids';

export class PublishConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishConflictError';
    Object.setPrototypeOf(this, PublishConflictError.prototype);
  }
}

/** Start a local draft from the latest published version (or an empty plan). */
export function startDraft(blockId: ID, latest: PlanVersion | null, day?: DayString): Draft {
  let content: PlanContent;
  if (latest) {
    if (latest.blockId !== blockId) {
      throw new Error(`Cannot start a draft for block ${blockId} from a version of block ${latest.blockId}`);
    }
    content = deepCopy(latest.content);
    content.blockId = blockId;
    if (day !== undefined) content.day = day;
  } else {
    content = emptyPlan(blockId, day ?? today());
  }
  return { blockId, baseVersion: latest ? latest.version : null, content, updatedAt: nowIso() };
}

/**
 * Apply an edit to a draft and return a new draft. The edit receives a deep copy,
 * so it may either return a new object or mutate its argument; the input draft is never changed.
 */
export function updateDraft(draft: Draft, edit: (c: PlanContent) => PlanContent): Draft {
  const next = edit(deepCopy(draft.content));
  return { ...draft, content: deepCopy(next), updatedAt: nowIso() };
}

/**
 * True when the draft differs from what is published.
 * With nothing published, true once the draft has any content (the day alone does not count).
 * Otherwise a deep comparison (a changed day counts, since publishing it tells planters the plan is for today).
 */
export function hasChanges(draft: Draft, latest: PlanVersion | null): boolean {
  if (!latest) return !deepEqual(draft.content, emptyPlan(draft.content.blockId, draft.content.day));
  return !deepEqual(draft.content, latest.content);
}

function checkSameBlock(a: ID, b: ID): void {
  if (a !== b) throw new Error(`Block mismatch: ${a} vs ${b}`);
}

function makeVersion(
  blockId: ID,
  latest: PlanVersion | null,
  content: PlanContent,
  author: string,
  message: string | undefined,
  quick: boolean,
): PlanVersion {
  const v: PlanVersion = {
    blockId,
    version: (latest?.version ?? 0) + 1,
    parentVersion: latest ? latest.version : null,
    publishedAt: nowIso(),
    author,
    content: { ...deepCopy(content), blockId },
  };
  if (message !== undefined && message !== '') v.message = message;
  if (quick) v.quick = true;
  return v;
}

/**
 * Publish a draft as version latest+1.
 * Throws PublishConflictError when the draft was not based on the current latest version
 * (someone else published in between, or a newer plan file was imported).
 */
export function publish(draft: Draft, latest: PlanVersion | null, author: string, message?: string): PlanVersion {
  const latestVersion = latest?.version ?? null;
  if (draft.baseVersion !== latestVersion) {
    throw new PublishConflictError(
      latestVersion === null
        ? `This draft was based on version ${draft.baseVersion}, but no published version was found.`
        : `This draft was started from version ${draft.baseVersion ?? 'none'}, but version ${latestVersion} has been published since. Review the latest version before publishing.`,
    );
  }
  if (latest) checkSameBlock(draft.blockId, latest.blockId);
  return makeVersion(draft.blockId, latest, draft.content, author, message, false);
}

/** Publish a single change directly on top of the latest version (no draft). */
export function quickPublish(
  latest: PlanVersion,
  edit: (c: PlanContent) => PlanContent,
  author: string,
  message?: string,
): PlanVersion {
  const content = edit(deepCopy(latest.content));
  return makeVersion(latest.blockId, latest, content, author, message, true);
}

/** Create a NEW version (latest+1) whose content is the target's. History is never rewritten. */
export function revertTo(target: PlanVersion, latest: PlanVersion, author: string): PlanVersion {
  checkSameBlock(target.blockId, latest.blockId);
  if (target.version > latest.version) {
    throw new Error(`Cannot revert to version ${target.version}: latest is ${latest.version}`);
  }
  return makeVersion(latest.blockId, latest, target.content, author, `Reverted to version ${target.version}`, false);
}
