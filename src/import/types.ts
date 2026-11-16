import type { BlockSheet, Piece, RasterLayer, VectorLayer } from '../core/types';

export type ImportResult =
  /**
   * `sheet`: opening number and prescription read from a GeoPDF's form, when it has one.
   * `cutblock`: the block boundary drawn on the GeoPDF, when it has a cutblock layer.
   */
  | { kind: 'raster'; layer: RasterLayer; warnings: string[]; sheet?: BlockSheet; cutblock?: VectorLayer }
  | { kind: 'vector'; layer: VectorLayer; pieces: Piece[]; warnings: string[] };
