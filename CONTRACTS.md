# Module contracts

Shared types: `src/core/types.ts`. Persistence: `src/core/store.ts`. Do not edit those two files; if you need a change, note it in your final report.
Each module owns its folder only. Pure logic must not import React Native or Expo, so it runs under Jest in Node.

Import paths below are relative to `src/`. Every module exposes the listed names from its `index.ts`.

---

## core/plan — plan versioning, diff, plan files, geo (Agent A)

```ts
// ids & time
export function newId(): string;                 // random, URL-safe, ~16 chars
export function nowIso(): string;
export function today(): DayString;              // local date

// geo
export function distanceM(a: LngLat, b: LngLat): number;
export function bearingDeg(a: LngLat, b: LngLat): number;           // 0 = N, clockwise
export function compass(bearing: number): 'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW';
export function polygonAreaHa(ring: LngLat[]): number;
export function centroid(ring: LngLat[]): LngLat;
export function pointInPolygon(p: LngLat, ring: LngLat[]): boolean;

// plan content
export function emptyPlan(blockId: ID, day: DayString): PlanContent;
export function loadList(plan: PlanContent): SpeciesCount[];        // totals across caches, sorted by species
export function assignmentFor(plan: PlanContent, planterId: ID): Assignment | undefined;

// versioning
export function startDraft(blockId: ID, latest: PlanVersion | null, day?: DayString): Draft;
   // copies latest.content (with day set to `day` if given), or emptyPlan when latest is null
export function updateDraft(draft: Draft, edit: (c: PlanContent) => PlanContent): Draft; // immutable; bumps updatedAt
export function hasChanges(draft: Draft, latest: PlanVersion | null): boolean;
export function diffPlans(before: PlanContent | null, after: PlanContent): PlanChange[];
export function publish(draft: Draft, latest: PlanVersion | null, author: string, message?: string): PlanVersion;
   // throws PublishConflictError if draft.baseVersion !== (latest?.version ?? null)
export function quickPublish(latest: PlanVersion, edit: (c: PlanContent) => PlanContent, author: string, message?: string): PlanVersion; // quick: true
export function revertTo(target: PlanVersion, latest: PlanVersion, author: string): PlanVersion;     // new version with target's content
export class PublishConflictError extends Error {}

// plan files
export function makePlanFile(block: Block, version: PlanVersion): PlanFile;
export function serializePlanFile(f: PlanFile): string;              // JSON
export function parsePlanFile(text: string): PlanFile;               // validates; throws PlanFileError with a readable message
export type ImportDecision = { action: 'import' } | { action: 'skip'; reason: 'older' | 'same' } ;
export function decideImport(incoming: PlanFile, latestLocal: PlanVersion | null): ImportDecision;
export class PlanFileError extends Error {}
export const PLAN_FILE_EXTENSION = '.cachelog';
```

Diff text style (examples): `Added Cache 4 (1,200 Sx, 600 Pl)`, `Cache 3 moved 210 m E`, `Cache 3: Sx 1,200 → 900`, `Jess: Piece 4 → Piece 6`, `Added Piece 7 (3.2 ha)`, `Piece 2 reshaped (2.1 → 2.6 ha)`, `New hazard: wasp nest`. Moves under 5 m are ignored.

## core/tally — log maths, reconciliation, summaries, CSV (Agent B)

```ts
export function activeEntries(log: LogEntry[]): LogEntry[];          // drops voided entries and the voids themselves
export function makeEntry<T extends LogEntry['type']>(type: T, fields: Omit<Extract<LogEntry,{type:T}>, keyof LogBaseFields|'type'>, ctx: { blockId: ID; day: DayString; deviceId: string; author: string }): Extract<LogEntry,{type:T}>;
   // LogBaseFields = id, blockId, day, createdAt, deviceId, author
export function voidEntry(target: LogEntry, reason: string, ctx: {deviceId: string; author: string}): VoidEntry;

export interface CacheBalance { cacheId: ID; name: string; planned: SpeciesCount[]; dropped: SpeciesCount[]; bagged: SpeciesCount[]; remaining: SpeciesCount[]; flags: string[] }
export function cacheBalances(plan: PlanContent, log: LogEntry[]): CacheBalance[];
   // flags e.g. "Bagged more Sx than dropped (+150)", "Nothing dropped yet"

export interface PlanterDay { planterId: ID; name: string; bagged: SpeciesCount[]; tallied: SpeciesCount[]; totalTallied: number; earningsCents: number; flags: string[] }
export function planterDays(plan: PlanContent, block: Block, log: LogEntry[]): PlanterDay[];
   // flags e.g. "Tallied 200 more than bagged"

export function pieceStatuses(plan: PlanContent, log: LogEntry[]): Record<ID, PieceStatus>;   // latest status entry wins; default not-started
export interface DaySummary { day: DayString; bySpecies: SpeciesCount[]; total: number; planters: PlanterDay[]; caches: CacheBalance[]; pieces: { pieceId: ID; name: string; status: PieceStatus; tallied: number; areaHa: number }[]; earningsCents: number }
export function daySummary(plan: PlanContent, block: Block, log: LogEntry[]): DaySummary;
export function seasonTotal(log: LogEntry[], planterId: ID): number;

export function talliesCsv(plan: PlanContent, log: LogEntry[]): string;     // day,planter,piece,species,count
export function payrollCsv(summary: DaySummary): string;                    // day,planter,trees,earnings
export function piecesCsv(summary: DaySummary): string;
export function formatCents(c: number): string;                              // "$1,234.56"
export function formatCount(n: number): string;                              // "1,200"
```

## db — storage (Agent B)

```ts
export class MemoryStore implements Store {}
export function openSqliteStore(dbName?: string): Promise<Store>;   // expo-sqlite (async API), migrations included
```

## map — MapLibre components (Agent C)

```ts
export type MapMode =
  | { kind: 'view' }
  | { kind: 'place-point'; onPlace: (p: LngLat) => void }                 // tap to place (cache, hazard)
  | { kind: 'draw-polygon'; onDone: (ring: LngLat[]) => void; onCancel: () => void }
  | { kind: 'move-point'; id: ID; onMove: (p: LngLat) => void };

export interface BlockMapProps {
  block: Block;
  plan: PlanContent | null;
  pieceStatuses?: Record<ID, PieceStatus>;
  highlightIds?: ID[];             // pieces/caches to emphasise (my piece; changed items in review)
  ghostPlan?: PlanContent | null;  // previous version drawn faded (review)
  cacheLabels?: Record<ID, string>; // e.g. remaining counts
  mode?: MapMode;
  showUserLocation?: boolean;
  onSelect?: (sel: { type: 'cache' | 'piece' | 'hazard'; id: ID } | null) => void;
  style?: StyleProp<ViewStyle>;
}
export function BlockMap(props: BlockMapProps): JSX.Element;
export function useUserLocation(): { position: LngLat | null; accuracyM: number | null; heading: number | null; permission: 'granted'|'denied'|'undetermined' };
export function downloadOfflineRegion(block: Block, plan: PlanContent | null, onProgress?: (pct: number) => void): Promise<void>;
export function blockBounds(block: Block, plan: PlanContent | null): [LngLat, LngLat] | null;   // pure, testable
```

## import — map file import (Agent D)

```ts
export type ImportResult =
  | { kind: 'raster'; layer: RasterLayer; warnings: string[] }
  | { kind: 'vector'; layer: VectorLayer; pieces: Piece[]; warnings: string[] };
export function importMapFile(uri: string, name: string): Promise<ImportResult>;   // dispatch by extension: .tif/.tiff, .kml, .geojson/.json, .pdf
// pure building blocks (tested in Node):
export function geotiffToRaster(buf: ArrayBuffer): Promise<{ png: Uint8Array; corners: [LngLat,LngLat,LngLat,LngLat]; warnings: string[] }>;
export function kmlToGeoJSON(text: string): GeoJSONFeatureCollection;
export function featuresToPieces(fc: GeoJSONFeatureCollection): Piece[];             // polygons -> pieces, name from properties.name
export function readGeoPdfGeoreference(buf: ArrayBuffer): Promise<GeoPdfInfo | null>;
export interface GeoPdfInfo { pages: { pageIndex: number; corners: [LngLat,LngLat,LngLat,LngLat]; crs?: string }[] }
```

## app + ui — screens (Agent E)

Expo Router in `src/app`. Shared components in `src/ui`. A `StoreProvider`/`useStore()` context in `src/ui/store.tsx` wraps `openSqliteStore()`.
