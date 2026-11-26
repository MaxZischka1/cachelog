import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { decideImport, diffPlans, mergePlans, parsePlanFile, parseSuggestion, rebaseDraft, sniffFile, startDraft } from '../../core/plan';
import { parseLogFile } from '../../core/tally';
import type { Draft } from '../../core/types';
import { choose, confirm, showError } from '../alerts';
import { pickFile, readTextFile } from '../files';
import { fmtDateTime } from '../format';
import { extractImages } from '../planFileImages';
import { importMapIntoBlock, isMapFileName } from '../mapImport';
import { useBump, useStore } from '../store';

/**
 * One way in for every Cachelog file, whether picked in the app or opened from AirDrop / Files:
 *  - a plan (from the crew boss): saves the block, the new version and the crew's pins
 *  - crew updates (from a planter): adds their bag-ups, pins and piece statuses
 *  - a suggestion (from another boss or foreman): merges it into the draft for review
 * Shows the result and moves to the right screen.
 */
export function useImportFlow() {
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

      Alert.alert('Not a Cachelog file', 'Pick a plan, crew update or suggestion file sent from Cachelog, or a block map (PDF, GeoTIFF, KML).');
    },
    [store, bump],
  );

  const run = useCallback(
    async (getText: () => Promise<string | null>) => {
      setBusy(true);
      try {
        const text = await getText();
        if (text !== null) await handleText(text);
      } catch (e) {
        showError('Could not open the file', e);
      } finally {
        setBusy(false);
      }
    },
    [handleText],
  );

  /**
   * A map (GeoPDF, GeoTIFF, KML...) rather than a Cachelog file. Crew boss: start a new block from
   * it or add it to one. Planters get block maps inside the boss's plan file.
   */
  const handleMap = useCallback(
    async (uri: string, name: string) => {
      const settings = await store.getSettings();
      if (settings?.role !== 'crew-boss') {
        Alert.alert(
          'Block maps come from the crew boss',
          "The crew boss imports the block's PDF map and shares the plan; the map comes with it. Ask them to share today's plan file.",
        );
        return;
      }
      const blocks = await store.listBlocks();
      const active = blocks.find((b) => b.id === settings.activeBlockId);
      const others = blocks.filter((b) => b.id !== active?.id).slice(-3).reverse();
      const options = [
        { label: 'New block from this map', value: '__new__' },
        ...(active ? [{ label: `Add to ${active.name}`, value: active.id }] : []),
        ...others.map((b) => ({ label: `Add to ${b.name}`, value: b.id })),
      ];
      const choice = blocks.length ? await choose('Add this map', name, options) : '__new__';
      if (!choice) return;
      const target = choice === '__new__' ? null : (blocks.find((b) => b.id === choice) ?? null);
      const out = await importMapIntoBlock(store, target, uri, name);
      await store.saveSettings({ ...settings, activeBlockId: out.block.id });
      bump();
      const warn = out.result.warnings.length ? `\n\n${out.result.warnings.join('\n')}` : '';
      const pieces = out.piecesAdded ? ` ${out.piecesAdded} piece${out.piecesAdded === 1 ? '' : 's'} added to the draft.` : '';
      Alert.alert(target ? 'Map added' : `${out.block.name} created`, `The map is on the block.${pieces} Open Plan to drop caches.${warn}`);
      router.dismissTo('/boss');
      router.push(`/boss/${out.block.id}`);
    },
    [store, bump],
  );

  /** Choose a file with the document picker. */
  const pick = useCallback(async () => {
    const picked = await pickFile().catch((e) => {
      showError('Could not open the file picker', e);
      return null;
    });
    if (!picked) return;
    if (isMapFileName(picked.name) || isMapFileName(picked.uri)) {
      setBusy(true);
      try {
        await handleMap(picked.uri, picked.name);
      } catch (e) {
        showError(`Could not import ${picked.name}`, e);
      } finally {
        setBusy(false);
      }
      return;
    }
    await run(() => readTextFile(picked.uri));
  }, [run, handleMap]);

  /** Open a file the system handed to the app (AirDrop, Files, Mail). */
  const open = useCallback(
    async (uri: string) => {
      if (isMapFileName(uri)) {
        setBusy(true);
        try {
          await handleMap(uri, decodeURIComponent(uri.split('/').pop() ?? 'map'));
        } catch (e) {
          showError('Could not import the map', e);
        } finally {
          setBusy(false);
        }
        return;
      }
      await run(() => readTextFile(uri));
    },
    [run, handleMap],
  );

  return { busy, pick, open };
}
