import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { cleanMessage, crewMessages, MESSAGE_MAX, QUICK_MESSAGES } from '../../core/messages';
import { nowIso, today } from '../../core/plan';
import type { MessageEntry } from '../../core/types';
import { confirm, showError } from '../alerts';
import { Button } from '../Button';
import { fmtDay, fmtTime } from '../format';
import { useLogWriter } from '../hooks/useLogWriter';
import { useSendUpdates } from '../hooks/useSendUpdates';
import { Icon } from '../kit';
import { Screen } from '../Screen';
import { EmptyState, Muted } from '../Section';
import { useBlock, useLog, useSettings } from '../store';
import { colors, font, radius, spacing } from '../theme';

/**
 * The block's crew channel. Messages are saved on this phone and reach the crew with the next
 * update (planter) or plan share (crew boss). When the LoRa radios come, the same messages go
 * over the air; this screen stays the same.
 */
export function MessagesScreen() {
  const { settings, update } = useSettings();
  const blockId = settings?.activeBlockId;
  const { data: block } = useBlock(blockId);
  const { data: log } = useLog(blockId);
  const { add, voidIt } = useLogWriter(blockId, today());
  const updates = useSendUpdates(blockId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const isBoss = settings?.role === 'crew-boss';

  const messages = useMemo(() => crewMessages(log ?? []), [log]);
  // Mark read whenever the tab is looked at.
  useFocusEffect(
    useCallback(() => {
      if (settings) update({ messagesReadAt: nowIso() }).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length]),
  );

  if (!blockId || !block) {
    return (
      <Screen tab>
        <EmptyState
          title="No block yet"
          message={isBoss ? 'Open a block first. Messages go to the crew on that block.' : 'Import a plan from your crew boss. Messages go to the crew on that block.'}
        />
      </Screen>
    );
  }

  const send = async (raw: string) => {
    const msg = cleanMessage(raw);
    if (!msg) return;
    // A double tap on a quick message sends it once.
    const last = messages[messages.length - 1];
    if (last && last.deviceId === settings?.deviceId && last.text === msg && Date.now() - Date.parse(last.createdAt) < 5000) return;
    setSending(true);
    try {
      await add('message', { text: msg });
      setText('');
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      showError('Could not save the message', e);
    } finally {
      setSending(false);
    }
  };

  const withdraw = async (m: MessageEntry) => {
    if (!(await confirm('Take back this message?', `“${m.text}” is removed for the crew too, once they get your next update.`, 'Take back', true))) return;
    try {
      await voidIt(m, 'Taken back');
    } catch (e) {
      showError('Could not take it back', e);
    }
  };

  const mineUnsent = messages.some((m) => m.deviceId === settings?.deviceId);
  const groups = groupByDay(messages);

  return (
    <Screen
      tab
      scroll={false}
      footer={
        <View style={styles.composer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {QUICK_MESSAGES.map((q) => (
              <Pressable key={q} accessibilityRole="button" accessibilityLabel={`Send: ${q}`} onPress={() => send(q)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                <Text style={styles.chipText}>{q}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={(t) => setText(t.slice(0, MESSAGE_MAX + 20))}
              placeholder={`Message ${block.name}`}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={MESSAGE_MAX}
              accessibilityLabel="Message"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!cleanMessage(text) || sending}
              onPress={() => send(text)}
              style={({ pressed }) => [styles.send, (!cleanMessage(text) || sending) && styles.sendOff, pressed && styles.pressed]}
            >
              <Icon name="arrow-up" size={24} color={colors.primaryText} />
            </Pressable>
          </View>
          <View style={styles.footRow}>
            <View style={styles.flex}>
              <Muted>{text.length ? `${text.length}/${MESSAGE_MAX}` : isBoss ? 'Reaches the crew when you share the plan' : 'Reaches the crew with your next update'}</Muted>
            </View>
            {mineUnsent ? (
              <Button
                title={isBoss ? 'Share plan' : 'Send now'}
                size="small"
                variant="secondary"
                busy={updates.sending}
                onPress={() => (isBoss ? router.push(`/boss/${blockId}/share`) : updates.send())}
              />
            ) : null}
          </View>
        </View>
      }
    >
      <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.list} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {messages.length === 0 ? (
          <EmptyState title="No messages yet" message="Short notes to the crew on this block: “Need trees at cache 2”, “Piece done”. Tap one below to send it." />
        ) : null}
        {groups.map(([day, list]) => (
          <View key={day} style={styles.day}>
            <Text style={styles.dayLabel}>{day === today() ? 'Today' : fmtDay(day)}</Text>
            {list.map((m) => {
              const mine = m.deviceId === settings?.deviceId;
              return (
                <View key={m.id} style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.theirsWrap]}>
                  {!mine ? <Text style={styles.author}>{m.author}</Text> : null}
                  <Pressable
                    onLongPress={mine ? () => withdraw(m) : undefined}
                    accessibilityLabel={`${mine ? 'You' : m.author}: ${m.text}`}
                    accessibilityHint={mine ? 'Long press to take it back' : undefined}
                    style={[styles.bubble, mine ? styles.mine : styles.theirs]}
                  >
                    <Text style={[styles.msg, mine && styles.msgMine]}>{m.text}</Text>
                  </Pressable>
                  <Text style={styles.time}>{fmtTime(m.createdAt)}</Text>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function groupByDay(messages: MessageEntry[]): [string, MessageEntry[]][] {
  const out: [string, MessageEntry[]][] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last[0] === m.day) last[1].push(m);
    else out.push([m.day, [m]]);
  }
  return out;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1 },
  day: { gap: spacing.sm },
  dayLabel: { alignSelf: 'center', fontSize: font.small, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  bubbleWrap: { maxWidth: '85%', gap: 2 },
  mineWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirsWrap: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  author: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, marginLeft: spacing.sm },
  bubble: { borderRadius: radius + 4, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  mine: { backgroundColor: colors.primary },
  theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  msg: { fontSize: font.body, color: colors.text },
  msgMine: { color: colors.primaryText },
  time: { fontSize: 12, color: colors.textMuted, marginHorizontal: spacing.sm },
  composer: { gap: spacing.sm },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: { borderRadius: 20, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
  chipText: { fontSize: font.body, fontWeight: '600', color: colors.text },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: { flex: 1, minHeight: 52, maxHeight: 120, borderRadius: radius, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: font.body, color: colors.text },
  send: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.35 },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 32 },
  pressed: { opacity: 0.7 },
});
