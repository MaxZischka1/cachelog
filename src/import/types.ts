import type { Piece, RasterLayer, VectorLayer } from '../core/types';

export type ImportResult =
  | { kind: 'raster'; layer: RasterLayer; warnings: string[] }
  | { kind: 'vector'; layer: VectorLayer; pieces: Piece[]; warnings: string[] }
  | {
      kind: 'geopdf';
      /** The map page drawn as an image, placed by its georeferencing. */
      layer: RasterLayer;
      /** Shapes from the layer that most looks like the area to plant, if any. */
      outline: VectorLayer | null;
      /** Those shapes as pieces, ready to add to the plan. */
      pieces: Piece[];
      /** Every PDF layer with closed shapes inside the map frame, best guess first. */
      candidates: { name: string; polygons: number; areaHa: number }[];
      /** Text printed on the page (prescription table, block number...). */
      text: string[];
      warnings: string[];
    };
