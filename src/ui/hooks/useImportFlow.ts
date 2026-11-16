import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { decideImport, diffPlans, mergePlans, parsePlanFile, parseSuggestion, rebaseDraft, sniffFile, startDraft } from '../../core/plan';
import { parseLogFile } from '../../core/tally';
import type { Draft, ID } from '../../core/types';
import { isMapFileName } from '../../import';
import { confirm, showError } from '../alerts';
import { pickFiles, readTextFile, type PickedFile } from '../files';
import { fmtDateTime } from '../format';
import { describeMapBatch, describeMapImport, importMapAnywhere, type MapImportOutcome } from '../mapImport';
import { extractImages } from '../planFileImages';
import { errorMessage, useBump, useStore } from '../store';

const NOT_CACHELOG = 'Pick a plan, crew update or suggestion sent from Cachelog, or a block map (GeoPDF, GeoTIFF, KML, GeoJSON).';

/** Read a file as Cachelog text, with a plain message instead of the system's "text encoding" error. */
async function readCachelogText(uri: string): Promise<string> {
  try {
    return await readTextFile(uri);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (/encoding/i.test(detail)) throw new Error(`This isn't a Cachelog file. ${NOT_CACHELOG}`);
    throw e;
  }
}

/** File name from a picked name or a file URL. */
function fileNameOf(nameOrUri: string): string {
  const base = nameOrUri.split(/[?#]/)[0];
  const last = base.slice(base.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * One way in for every Cachelog file, whether picked in the app or opened from AirDrop / Files:
 *  - a plan (from the crew boss): saves the block, the new version and the crew's pins
 *  - crew updates (from a planter): adds their bag-ups, pins and piece statuses
 *  - a suggestion (from another boss or foreman): merges it into the draft for review
 *  - a block map (GeoPDF, GeoTIFF, KML, GeoJSON, crew boss only): added to the block it lies on,
 *    or the block the import started from (`blockId`) if that one is empty, or a new block
 * Shows the result and moves to the right screen.
 */
export function useImportFlow(opts: { blockId?: ID } = {}) {
  const currentBlockId = opts.blockId;
  const store = useStore();
  const bump = useBump();
  const [busy, setBusy] = useState(false);

  const handleText = useCallback(
    async (text: string) => {
      const settings = await store.getSettings();
      const isBoss = settings?.role === 'crew-boss';
      const kind = sniffFile(text);

      if (kind === 'plan') {
        const file = parsePlanFile(text);
        const local = await store.getLatestVersion(file.block.id);
        const decision = decideImport(file, local);
        // Pins ride along with every plan file; take them even when the plan itself is not newer.
        if (file.pins?.length && (decision.action === 'import' || local)) await store.appendLog(file.pins);
        const home = isBoss ? `/boss/${file.block.id}` : '/planter';
        if (decision.action === 'skip') {
          if (settings) await store.saveSettings({ ...settings, activeBlockId: file.block.id });
          bump();
          Alert.alert(
            'Plan not imported',
            decision.reason === 'same'
              ? `This phone already has v${file.version.version} of ${file.block.name}.`
              : `This phone already has a newer plan for ${file.block.name} (v${local?.version}, ${local ? fmtDateTime(local.publishedAt) : ''}). The file is v${file.version.version}.`,
          );
          return;
        }
        const { block, dropped } = await extractImages(file);
        await store.saveBlock(block);
        await store.addVersion(file.version);
        if (settings) {
          const stillListed = !!settings.planterId && file.version.content.planters.some((p) => p.id === settings.planterId);
          await store.saveSettings({ ...settings, activeBlockId: file.block.id, planterId: isBoss || stillListed ? settings.planterId : undefined });
        }
        bump();
        const what = local ? `Updated ${file.block.name} from v${local.version} to v${file.version.version}.` : `Imported ${file.block.name} v${file.version.version}.`;
        const msg = file.version.message ? `\n\n“${file.version.message}” — ${file.version.author}` : '';
        const maps = dropped.length ? `\n\nMissing map images: ${dropped.join(', ')}. Ask for the plan to be shared again.` : '';
        Alert.alert('Plan imported', what + msg + maps);
        router.dismissTo(home);
        return;
      }

      if (kind === 'updates') {
        const file = parseLogFile(text);
        const block = await store.getBlock(file.blockId);
        if (!block) {
          Alert.alert('Block not on this phone', `These updates from ${file.author} are for a block this phone doesn't have.`);
          return;
        }
        const before = (await store.listLog(file.blockId)).length;
        await store.appendLog(file.entries);
        const added = (await store.listLog(file.blockId)).length - before;
        bump();
        const pins = file.entries.filter((e) => e.type === 'pin').length;
        Alert.alert(
          `Updates from ${file.author}`,
          added > 0 ? `Added ${added} new entr${added === 1 ? 'y' : 'ies'} for ${block.name}${pins ? ` (includes ${pins} pin${pins === 1 ? '' : 's'})` : ''}.` : 'Nothing new; these were already imported.',
        );
        return;
      }

      if (kind === 'suggestion') {
        const s = parseSuggestion(text);
        const block = await store.getBlock(s.blockId);
        if (!block) {
          Alert.alert('Block not on this phone', `${s.author}'s suggestion is for ${s.blockName}, which this phone doesn't have. Import that block's plan first.`);
          return;
        }
        if (!isBoss) {
          Alert.alert('For the crew boss', 'Plan suggestions can only be reviewed on a crew boss phone.');
          return;
        }
        const latest = await store.getLatestVersion(s.blockId);
        let working: Draft = (await store.getDraft(s.blockId)) ?? startDraft(s.blockId, latest);
        if (latest && working.baseVersion !== latest.version) {
          const wBase = working.baseVersion === null ? null : await store.getVersion(s.blockId, working.baseVersion);
          working = rebaseDraft(working, wBase, latest).draft;
        }
        const base = s.baseVersion === null ? null : await store.getVersion(s.blockId, s.baseVersion);
        const merged = mergePlans(base?.content ?? null, s.content, working.content);
        const changes = diffPlans(latest?.content ?? null, merged.content);
        if (changes.length === 0) {
          Alert.alert(`Suggestion from ${s.author}`, 'Nothing in it differs from the current plan.');
          return;
        }
        const lines = changes.slice(0, 8).map((c) => `• ${c.text}`);
        if (changes.length > 8) lines.push(`…and ${changes.length - 8} more`);
        const notes = merged.conflicts.length ? `\n\nCheck:\n${merged.conflicts.map((c) => `• ${c}`).join('\n')}` : '';
        const ok = await confirm(
          `Suggestion from ${s.author}`,
          `${s.message ? `“${s.message}”\n\n` : ''}${lines.join('\n')}${notes}\n\nLoad this into your draft? Nothing is published until you review it.`,
          'Load into draft',
        );
        if (!ok) return;
        await store.saveDraft({ ...working, content: merged.content, updatedAt: new Date().toISOString() });
        bump();
        router.dismissTo(`/boss/${s.blockId}`);
        router.push(`/boss/${s.blockId}/review`);
        return;
      }

      Alert.alert('Not a Cachelog file', NOT_CACHELOG);
    },
    [store, bump],
  );

  /** Import one or more map files, each onto its own block (see importMapAnywhere). */
  const importMaps = useCallback(
    async (files: PickedFile[]) => {
      const settings = await store.getSettings();
      if (settings?.role !== 'crew-boss') {
        Alert.alert('Maps come from your crew boss', 'Block maps arrive with the plan file. Ask your crew boss to share the plan again.');
        return;
      }
      const outcomes: MapImportOutcome[] = [];
      const failed: { name: string; reason: string }[] = [];
      for (const f of files) {
        try {
          const o = await importMapAnywhere(store, f, currentBlockId);
          if (o) outcomes.push(o);
        } catch (e) {
          if (files.length === 1) throw e;
          failed.push({ name: f.name, reason: errorMessage(e) });
        }
      }
      const last = outcomes[outcomes.length - 1];
      if (last) await store.saveSettings({ ...settings, activeBlockId: last.block.id });
      bump();
      if (files.length === 1) {
        if (last) Alert.alert(last.created ? 'New block' : 'Map added', describeMapImport(last));
      } else if (outcomes.length || failed.length) {
        Alert.alert(`${outcomes.length} of ${files.length} maps imported`, describeMapBatch(outcomes, failed));
      }
      const blockIds = [...new Set(outcomes.map((o) => o.block.id))];
      if (blockIds.length === 1 && blockIds[0] !== currentBlockId) {
        router.dismissTo('/boss');
        router.push(`/boss/${blockIds[0]}`);
      } else if (blockIds.length > 1) {
        router.dismissTo('/boss');
      }
    },
    [store, bump, currentBlockId],
  );

  /** Map files go to the map import (together); everything else is read as a Cachelog file. */
  const handleFiles = useCallback(
    async (files: PickedFile[]) => {
      const maps = files.filter((f) => isMapFileName(f.name));
      if (maps.length) await importMaps(maps);
      for (const f of files) if (!isMapFileName(f.name)) await handleText(await readCachelogText(f.uri));
    },
    [importMaps, handleText],
  );

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      showError('Could not open the file', e);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Choose one or more files with the document picker (several maps can be imported at once). */
  const pick = useCallback(
    () =>
      run(async () => {
        const picked = await pickFiles();
        await handleFiles(picked.map((p) => ({ uri: p.uri, name: p.name || fileNameOf(p.uri) })));
      }),
    [run, handleFiles],
  );

  /** Open a file the system handed to the app (AirDrop, Files, Mail). */
  const open = useCallback((uri: string) => run(() => handleFiles([{ uri, name: fileNameOf(uri) }])), [run, handleFiles]);

  return { busy, pick, open };
}
