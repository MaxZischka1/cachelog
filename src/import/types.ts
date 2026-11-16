import type { BlockSheet, Piece, RasterLayer, VectorLayer } from '../core/types';

export type ImportResult =
  /** `sheet`: opening number and prescription read from a GeoPDF's form, when it has one. */
  | { kind: 'raster'; layer: RasterLayer; warnings: string[]; sheet?: BlockSheet }
  | { kind: 'vector'; layer: VectorLayer; pieces: Piece[]; warnings: string[] };
