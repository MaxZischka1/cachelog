/**
 * Map styling constants and status -> colour mapping. Pure (no RN imports).
 */
import type { PieceStatus } from '../core/types';

/**
 * Basemap style. OpenFreeMap needs no API key. Change here to switch basemap;
 * offline packs are downloaded for this same URL.
 * Alternative: 'https://demotiles.maplibre.org/style.json' (very coarse, world only).
 */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Satellite imagery basemap. Every decent imagery provider needs a key
 * (e.g. MapTiler 'https://api.maptiler.com/maps/satellite/style.json?key=YOUR_KEY').
 * Not used until a key is configured; also check the provider's terms allow offline packs.
 */
export const SATELLITE_STYLE_URL: string | null = null;

/** Font used for labels. Must exist in the basemap style's glyph server (OpenFreeMap serves Noto Sans). */
export const LABEL_FONT = ['Noto Sans Bold'];

/**
 * Minimal style used if the basemap style cannot be loaded (no signal and no offline pack).
 * Plan overlays still render on a plain background. Glyphs point at the same server so labels
 * work if those glyphs are cached.
 */
export const FALLBACK_STYLE = {
  version: 8 as const,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'cl-bg', type: 'background' as const, paint: { 'background-color': '#E9E6DA' } }],
};

export const OFFLINE_PAD_M = 1000;
export const OFFLINE_MIN_ZOOM = 10;
export const OFFLINE_MAX_ZOOM = 16;

export const COLORS = {
  notStartedLine: '#FFC400',
  inProgressFill: '#7BD88F',
  inProgressLine: '#2E9E4F',
  completeFill: '#1E8E3E',
  completeLine: '#0B5D24',
  highlightHalo: '#FFFFFF',
  cache: '#1565C0',
  cacheStroke: '#FFFFFF',
  hazardPoint: '#D32F2F',
  hazardAreaFill: '#FF8F00',
  hazardAreaLine: '#D32F2F',
  vector: '#00B8D4',
  ghost: '#6B6B6B',
  draft: '#E040FB',
  labelText: '#111111',
  labelHalo: '#FFFFFF',
} as const;

export interface PieceStyle {
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
  lineWidth: number;
}

/**
 * not-started: outline only; in-progress: light fill; complete: solid green.
 * Not-started keeps a near-invisible fill so taps inside the piece still hit it.
 */
export function pieceStyle(status: PieceStatus | undefined, highlighted: boolean): PieceStyle {
  const lineWidth = highlighted ? 6 : 3;
  switch (status) {
    case 'complete':
      return { fillColor: COLORS.completeFill, fillOpacity: 0.6, lineColor: COLORS.completeLine, lineWidth };
    case 'in-progress':
      return { fillColor: COLORS.inProgressFill, fillOpacity: 0.3, lineColor: COLORS.inProgressLine, lineWidth };
    default:
      return { fillColor: COLORS.notStartedLine, fillOpacity: 0.01, lineColor: COLORS.notStartedLine, lineWidth };
  }
}

export const CACHE_RADIUS = 11;
export const CACHE_RADIUS_HIGHLIGHT = 16;
export const HAZARD_RADIUS = 9;
export const HAZARD_RADIUS_HIGHLIGHT = 14;
