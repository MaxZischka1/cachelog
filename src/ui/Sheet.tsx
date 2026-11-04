import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './Button';
import { TextField } from './NumberField';
import { colors, font, spacing } from './theme';

/** Page-sheet modal with a title bar, scrollable body and pinned action buttons. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  actions,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.flex} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Button title="Close" variant="ghost" size="small" onPress={onClose} />
          </View>
          <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/** Cross-platform text prompt (Alert.prompt is iOS-only). Used for void reasons etc. */
export function TextPromptSheet({
  visible,
  title,
  message,
  placeholder,
  confirmLabel = 'OK',
  destructive,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);
  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={onCancel}
      actions={
        <Button
          title={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          disabled={text.trim().length === 0}
          onPress={() => onSubmit(text.trim())}
        />
      }
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <TextField value={text} onChangeText={setText} placeholder={placeholder} autoFocus />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  title: { fontSize: font.title - 4, fontWeight: '800', color: colors.text, flexShrink: 1 },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  actions: { padding: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  message: { fontSize: font.body, color: colors.text },
});
