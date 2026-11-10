import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { today } from '../../core/plan';
import { LOG_FILE_EXTENSION, makeLogFile, serializeLogFile } from '../../core/tally';
import type { ID } from '../../core/types';
import { showError } from '../alerts';
import { shareTextFile } from '../files';
import { safeFileName } from '../format';
import { useStore } from '../store';

/**
 * Everything this phone has logged for the block (bag-ups, pins, piece statuses), as one file for
 * the crew boss. Sending it more than once is harmless: entries are matched by id.
 */
export function useSendUpdates(blockId: ID | undefined) {
  const store = useStore();
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    if (!blockId) return;
    setSending(true);
    try {
      const [settings, block, log] = await Promise.all([store.getSettings(), store.getBlock(blockId), store.listLog(blockId)]);
      if (!settings || !block) throw new Error('Import a plan first.');
      const mine = log.filter((e) => e.deviceId === settings.deviceId);
      if (mine.length === 0) {
        Alert.alert('Nothing to send yet', 'Log a bag-up or drop a pin first.');
        return;
      }
      const file = makeLogFile(blockId, settings.deviceId, settings.userName, mine);
      await shareTextFile(`${safeFileName(settings.userName)}-${safeFileName(block.name)}-${today()}${LOG_FILE_EXTENSION}`, serializeLogFile(file), {
        mimeType: 'application/json',
        UTI: 'com.cachelog.file',
        dialogTitle: 'Send my updates to the crew boss',
      });
    } catch (e) {
      showError('Could not send updates', e);
    } finally {
      setSending(false);
    }
  }, [blockId, store]);

  return { send, sending };
}
