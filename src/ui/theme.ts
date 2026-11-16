/**
 * Outdoor theme: high contrast, large type, big touch targets (gloves, cold, sun glare).
 * Quiet surfaces (white cards on a warm off-white page, hairline borders) so the numbers and the
 * one main action on each screen carry the weight. Text stays near-black for sun glare.
 */
export const colors = {
  bg: '#F5F5F0',
  surface: '#FFFFFF',
  text: '#111111',
  textMuted: '#4A4A45',
  border: '#1A1A1A',
  borderLight: '#DAD9D2',
  hairline: '#E7E6E0',
  placeholder: '#8C8B84',
  primary: '#1B5E20', // dark forest green
  primarySoft: '#E5EFE3',
  primaryText: '#FFFFFF',
  chart: '#2E7D32',
  secondary: '#FFFFFF',
  secondaryText: '#111111',
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

export const radius = 14;
