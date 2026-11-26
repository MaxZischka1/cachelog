/**
 * Cachelog theme: dark, clean tracker look (iOS first).
 * One warm accent for the main action, near-black grounds, high-contrast text for glare and gloves.
 * Keys are shared by every screen, so names stay stable while values carry the look.
 */
export const colors = {
  bg: '#0B0B0D',
  surface: '#17171A',
  surfaceRaised: '#222226',
  text: '#F5F5F4',
  textMuted: '#A3A3A8',
  textFaint: '#6E6E75',
  border: '#3A3A40',
  borderLight: '#2A2A2F',
  /** The accent: main actions, selected tab, today's numbers. Dark text sits on it (6.6:1). */
  primary: '#FF6A2B',
  primaryText: '#120A06',
  primaryMuted: '#3A1D10',
  secondary: '#222226',
  secondaryText: '#F5F5F4',
  danger: '#FF453A',
  dangerText: '#FFFFFF',
  dangerBg: '#3A1412',
  warning: '#FFB340',
  warningBg: '#2E2310',
  ok: '#32D74B',
  okBg: '#10291A',
  highlight: '#FFD60A',
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
  body: 17,
  large: 20,
  title: 28,
  huge: 44,
  /** The day's tree count. */
  hero: 76,
} as const;

/** Minimum touch target height (points). HIG says 44; gloves need more. */
export const touch = {
  min: 56,
  big: 68,
} as const;

/** Corner radii: cards, controls, and fully rounded pills. */
export const radius = 14;
export const radii = { card: 20, control: 14, pill: 999 } as const;

/** Tabular figures so counts don't jump around as digits change. */
export const tabular = { fontVariant: ['tabular-nums' as const] };
