import { cleanMessage, crewMessages, MESSAGE_MAX, unreadCount } from './messages';
import type { LogEntry } from './types';

const msg = (id: string, createdAt: string, deviceId: string, text = 'hi'): LogEntry => ({ id, blockId: 'b', day: createdAt.slice(0, 10), createdAt, deviceId, author: deviceId, type: 'message', text });

test('cleanMessage trims, collapses and caps', () => {
  expect(cleanMessage('  Need   trees\n at cache 2 ')).toBe('Need trees at cache 2');
  expect(Array.from(cleanMessage('🌲'.repeat(300)))).toHaveLength(MESSAGE_MAX);
  expect(cleanMessage('   ')).toBe('');
});

test('crewMessages: oldest first, withdrawn ones left out; unread from others', () => {
  const log: LogEntry[] = [
    msg('2', '2026-05-10T12:00:00Z', 'boss'),
    msg('1', '2026-05-10T09:00:00Z', 'me'),
    msg('3', '2026-05-10T13:00:00Z', 'ben'),
    { id: 'v', blockId: 'b', day: '2026-05-10', createdAt: '2026-05-10T13:05:00Z', deviceId: 'ben', author: 'ben', type: 'void', targetId: '3', reason: 'oops' },
  ];
  const m = crewMessages(log);
  expect(m.map((x) => x.id)).toEqual(['1', '2']);
  expect(unreadCount(m, undefined, 'me')).toBe(1);
  expect(unreadCount(m, '2026-05-10T12:30:00Z', 'me')).toBe(0);
});
