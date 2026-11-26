import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { errorMessage } from './store';

export function showError(title: string, e: unknown) {
  Alert.alert(title, errorMessage(e));
}

export function confirm(title: string, message: string, confirmLabel = 'OK', destructive = false): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** Ask the user to pick one option; resolves undefined on cancel. */
export function choose<T extends string>(title: string, message: string | undefined, options: { label: string; value: T; destructive?: boolean }[]): Promise<T | undefined> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        ...options.map((o) => ({ text: o.label, style: o.destructive ? ('destructive' as const) : ('default' as const), onPress: () => resolve(o.value) })),
        { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve(undefined) },
      ],
      { cancelable: true, onDismiss: () => resolve(undefined) },
    );
  });
}

/** Run an async action and show a readable alert if it throws. Returns the result or undefined on error. */
export async function attempt<T>(title: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    showError(title, e);
    return undefined;
  }
}

/**
 * A native menu that slides up from the bottom (iOS action sheet); an alert list elsewhere.
 * Resolves undefined on cancel.
 */
export function chooseSheet<T extends string>(title: string, message: string | undefined, options: { label: string; value: T; destructive?: boolean }[]): Promise<T | undefined> {
  if (Platform.OS !== 'ios') return choose(title, message, options);
  return new Promise((resolve) => {
    const labels = [...options.map((o) => o.label), 'Cancel'];
    const destructive = options.map((o, i) => (o.destructive ? i : -1)).filter((i) => i >= 0);
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message, options: labels, cancelButtonIndex: labels.length - 1, destructiveButtonIndex: destructive.length ? destructive : undefined, userInterfaceStyle: 'dark' },
      (i) => resolve(i < options.length ? options[i].value : undefined),
    );
  });
}
