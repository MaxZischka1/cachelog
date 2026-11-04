/**
 * Shared domain types. Every module builds on these; change them only in integration.
 *
 * Two data flows:
 *  - The PLAN flows down (crew boss -> planters) as numbered, immutable PlanVersions.
 *  - The LOG flows up (planters/crew boss -> crew boss/office) as add-only LogEntries.
 */

export type ID = string;
/** [longitude, latitude] in WGS84 degrees (GeoJSON order). */
export type LngLat = [number, number];
/** Species code as used on contract, e.g. "Sx", "Pl", "Fd". */
export type Species = string;
/** ISO date YYYY-MM-DD (local planting day). */
export type DayString = string;
/** ISO timestamp. */
export type Timestamp = string;

export interface SpeciesCount {
  species: Species;
  count: number;
}

// ---------- Block (stable for a contract) ----------

export interface EmergencyInfo {
  musterPoint?: LngLat;
  helipad?: LngLat;
  evacRoute?: string;
  nearestHospital?: string;
  radioChannel?: string;
  notes?: string;
}

/** A georeferenced raster shown under the plan (imported GeoTIFF / GeoPDF render). */
export interface RasterLayer {
  id: ID;
  kind: 'raster';
  name: string;
  /** Local file URI of a PNG/JPEG the map can draw. */
  imageUri: string;
  /** Corners: top-left, top-right, bottom-right, bottom-left. */
  corners: [LngLat, LngLat, LngLat, LngLat];
  opacity?: number;
}

/** Imported vector reference data (block boundary, roads, streams). Not part of the plan. */
export interface VectorLayer {
  id: ID;
  kind: 'vector';
  name: string;
  /** GeoJSON FeatureCollection, stored as-is. */
  geojson: GeoJSONFeatureCollection;
}

export type MapLayer = RasterLayer | VectorLayer;

export interface Block {
  id: ID;
  name: string;
  contract?: string;
  licensee?: string;
  /** Price per tree in cents, by species. */
  pricesCents: Record<Species, number>;
  emergency: EmergencyInfo;
  layers: MapLayer[];
  createdAt: Timestamp;
}

// ---------- Plan content ----------

export interface Planter {
  id: ID;
  name: string;
}

export interface Cache {
  id: ID;
  name: string;
  position: LngLat;
  /** Planned trees at this cache. */
  trees: SpeciesCount[];
  notes?: string;
}

export interface Prescription {
  densityPerHa?: number;
  spacingM?: number;
  species?: Species[];
}

export interface Piece {
  id: ID;
  name: string;
  /** Closed ring not required; first point is not repeated. */
  polygon: LngLat[];
  prescription?: Prescription;
  notes?: string;
}

export interface Assignment {
  planterId: ID;
  pieceId: ID;
  cacheId?: ID;
}

export interface Hazard {
  id: ID;
  kind: 'point' | 'area';
  /** One point for 'point', a ring for 'area'. */
  geometry: LngLat[];
  note: string;
}

export interface PlanContent {
  blockId: ID;
  /** The planting day this plan is for. */
  day: DayString;
  planters: Planter[];
  caches: Cache[];
  pieces: Piece[];
  assignments: Assignment[];
  hazards: Hazard[];
  notes?: string;
}

/** Immutable once published. */
export interface PlanVersion {
  blockId: ID;
  version: number; // 1, 2, 3 ... per block
  parentVersion: number | null;
  publishedAt: Timestamp;
  author: string;
  message?: string;
  /** true when published via quick publish (single mid-day change). */
  quick?: boolean;
  content: PlanContent;
}

/** Local, editable. At most one per block. */
export interface Draft {
  blockId: ID;
  baseVersion: number | null;
  content: PlanContent;
  updatedAt: Timestamp;
}

export type PlanChangeKind =
  | 'cache-added' | 'cache-removed' | 'cache-moved' | 'cache-trees' | 'cache-renamed' | 'cache-notes'
  | 'piece-added' | 'piece-removed' | 'piece-reshaped' | 'piece-renamed' | 'piece-prescription' | 'piece-notes'
  | 'planter-added' | 'planter-removed' | 'planter-renamed'
  | 'assignment-changed' | 'assignment-added' | 'assignment-removed'
  | 'hazard-added' | 'hazard-removed' | 'hazard-changed'
  | 'day-changed' | 'notes-changed';

export interface PlanChange {
  kind: PlanChangeKind;
  /** Plain-language sentence for the Review screen, e.g. "Cache 3 moved 200 m E". */
  text: string;
  /** IDs of the entities involved, for highlighting on the map. */
  ids: ID[];
}

/** The file shared by AirDrop / share sheet. */
export interface PlanFile {
  format: 'cachelog-plan';
  formatVersion: 1;
  block: Block;
  version: PlanVersion;
  exportedAt: Timestamp;
  /**
   * Raster map images, base64 PNG keyed by RasterLayer id. imageUri in the block is a path on the
   * sender's phone, so the receiver writes these out and rewrites imageUri. Optional: older files and
   * plans without raster layers omit it.
   */
  images?: Record<ID, string>;
}

// ---------- Log (add-only) ----------

interface LogBase {
  id: ID;
  blockId: ID;
  day: DayString;
  createdAt: Timestamp;
  deviceId: string;
  author: string;
}

/** Trees actually dropped at a cache (truck/heli delivery). */
export interface CacheDropEntry extends LogBase {
  type: 'cache-drop';
  cacheId: ID;
  trees: SpeciesCount[];
}

/** A planter bags up trees from a cache. */
export interface BagUpEntry extends LogBase {
  type: 'bagup';
  planterId: ID;
  cacheId: ID;
  trees: SpeciesCount[];
}

/** Trees planted (end-of-day tally), the number that gets paid. */
export interface TallyEntry extends LogBase {
  type: 'tally';
  planterId: ID;
  pieceId: ID;
  trees: SpeciesCount[];
}

export type PieceStatus = 'not-started' | 'in-progress' | 'complete';

export interface PieceStatusEntry extends LogBase {
  type: 'piece-status';
  pieceId: ID;
  status: PieceStatus;
}

/** Cancels an earlier entry. Entries are never edited or deleted. */
export interface VoidEntry extends LogBase {
  type: 'void';
  targetId: ID;
  reason: string;
}

export type LogEntry = CacheDropEntry | BagUpEntry | TallyEntry | PieceStatusEntry | VoidEntry;

// ---------- Minimal GeoJSON ----------

export interface GeoJSONGeometry {
  type: 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon';
  coordinates: any;
}
export interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry | null;
  properties: Record<string, any> | null;
  id?: string | number;
}
export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// ---------- Device settings ----------

export type Role = 'crew-boss' | 'planter';

export interface DeviceSettings {
  deviceId: string;
  userName: string;
  role: Role;
  /** When role is planter: which planter in the plan this phone belongs to. */
  planterId?: ID;
  activeBlockId?: ID;
}
