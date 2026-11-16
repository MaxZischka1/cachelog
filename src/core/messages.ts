/** Crew messages: short texts kept in the block's log. Pure. */
import { activeEntries } from './tally';
import type { LogEntry, MessageEntry, Timestamp } from './types';

/**
 * Longest message. A LoRa (Meshtastic) text packet carries about 200 bytes, so messages written
 * now will also fit the radios later.
 */
export const MESSAGE_MAX = 200;

/** One-tap messages for gloved hands. */
export const QUICK_MESSAGES = ['Need trees', 'Cache is low', 'Piece done', 'On my way', 'Need a hand', 'Taking a break'] as const;

/** Trim, collapse whitespace and cap at MESSAGE_MAX characters. Empty string when nothing is left. */
export function cleanMessage(text: string): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, MESSAGE_MAX).join('');
}

/** The block's messages that have not been withdrawn, oldest first. */
export function crewMessages(log: LogEntry[]): MessageEntry[] {
  return activeEntries(log)
    .filter((e): e is MessageEntry => e.type === 'message')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/** Messages from other phones since `readAt`. */
export function unreadCount(messages: MessageEntry[], readAt: Timestamp | undefined, deviceId: string): number {
  return messages.filter((m) => m.deviceId !== deviceId && (!readAt || m.createdAt > readAt)).length;
}
