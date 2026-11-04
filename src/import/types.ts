import type { Piece, RasterLayer, VectorLayer } from '../core/types';

export type ImportResult =
  | { kind: 'raster'; layer: RasterLayer; warnings: string[] }
  | { kind: 'vector'; layer: VectorLayer; pieces: Piece[]; warnings: string[] };
