/**
 * Outdoor theme: high contrast, large type, big touch targets (gloves, cold, sun glare).
 */
export const colors = {
  bg: '#FFFFFF',
  surface: '#F2F2F0',
  text: '#000000',
  textMuted: '#3A3A3A',
  border: '#1A1A1A',
  borderLight: '#9E9E9E',
  primary: '#1B5E20', // dark forest green
  primaryText: '#FFFFFF',
  secondary: '#E8E8E4',
  secondaryText: '#000000',
  danger: '#B71C1C',
  dangerText: '#FFFFFF',
  warning: '#8A4B00',
  warningBg: '#FFF3CD',
  ok: '#1B5E20',
  okBg: '#DFF0D8',
  highlight: '#FFD600',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const font = {
  small: 15,
  body: 18,
  large: 22,
  title: 28,
  huge: 44,
} as const;

/** Minimum touch target height (points). Spec says 48; we go a bit bigger for gloves. */
export const touch = {
  min: 56,
  big: 72,
} as const;

export const radius = 10;
