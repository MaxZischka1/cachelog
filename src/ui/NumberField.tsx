import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing, touch } from './theme';

export interface NumberFieldProps {
  label?: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  /** Allow decimals (prices, spacing). Default: integers only (counts). */
  decimal?: boolean;
  placeholder?: string;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
  autoFocus?: boolean;
}

function parse(text: string, decimal: boolean): number | undefined {
  const cleaned = text.replace(/,/g, decimal ? '.' : '').replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return undefined;
  const n = decimal ? parseFloat(cleaned) : parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Large numeric field with the numeric keypad. Keeps its own text so "0." or "" can be typed. */
export function NumberField({ label, value, onChange, decimal = false, placeholder, suffix, style, big, autoFocus }: NumberFieldProps) {
  const [text, setText] = useState(value === undefined ? '' : String(value));

  // Follow external changes (e.g. a +20 button) without fighting the user's typing.
  useEffect(() => {
    const current = parse(text, decimal);
    if (current !== value) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, big && styles.inputBig]}
          value={text}
          onChangeText={(t) => {
            setText(t);
            onChange(parse(t, decimal));
          }}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          selectTextOnFocus
          autoFocus={autoFocus}
          accessibilityLabel={label}
          returnKeyType="done"
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function TextField({ label, style, multiline, ...rest }: TextFieldProps) {
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, styles.text, multiline && styles.multiline]}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={label}
        multiline={multiline}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: font.body, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: touch.min,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    fontSize: font.large,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputBig: { fontSize: font.title, minHeight: touch.big },
  text: { fontWeight: '400', fontSize: font.body },
  multiline: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
  suffix: { fontSize: font.body, color: colors.textMuted },
});
