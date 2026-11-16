import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  ImageSource,
  Layer,
  Map,
  NativeUserLocation,
  type CameraRef,
  type MapRef,
  type StyleSpecification,
  type SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';
import type { Block, ID, LngLat, PieceStatus, PlanContent } from '../core/types';
import { buildDraftFeatures, buildGhostFeatures, buildPinFeatures, buildPlanFeatures, selectionFromFeatures, type MapPin } from './features';
import { blockBounds, ensureMinSize, padBounds, toLngLatBounds } from './geo';
import { BASEMAP_STYLE_URL, COLORS, FALLBACK_STYLE, LABEL_FONT } from './style';
import { useUserLocationInternal } from './useUserLocation';

export type MapMode =
  | { kind: 'view' }
  | { kind: 'place-point'; onPlace: (p: LngLat) => void }
  | { kind: 'draw-polygon'; onDone: (ring: LngLat[]) => void; onCancel: () => void }
  | { kind: 'move-point'; id: ID; onMove: (p: LngLat) => void };

export interface BlockMapProps {
  block: Block;
  plan: PlanContent | null;
  pieceStatuses?: Record<ID, PieceStatus>;
  highlightIds?: ID[];
  ghostPlan?: PlanContent | null;
  cacheLabels?: Record<ID, string>;
  mode?: MapMode;
  showUserLocation?: boolean;
  onSelect?: (sel: { type: 'cache' | 'piece' | 'hazard' | 'pin'; id: ID } | null) => void;
  /** Crew pins drawn above everything in the plan. */
  pins?: MapPin[];
  style?: StyleProp<ViewStyle>;
}

/** Layers queried for taps in view mode. */
const SELECTABLE_LAYERS = ['cl-pin-circle', 'cl-cache-circle', 'cl-hazard-point', 'cl-hazard-area-fill', 'cl-piece-fill'];
/** Half-size of the tap box in px: 44 px square, generous for gloves. */
const TAP_RADIUS = 22;
const CAMERA_PADDING = { top: 60, right: 40, bottom: 140, left: 40 };
const RECENTER_ZOOM = 16;

const pointGeom = ['==', ['geometry-type'], 'Point'] as any;
const polygonGeom = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]] as any;
const highlighted = ['==', ['get', 'highlight'], true] as any;

const labelLayout = (size: number): NonNullable<SymbolLayerSpecification['layout']> => ({
  'text-field': ['get', 'label'],
  'text-font': LABEL_FONT,
  'text-size': size,
  'text-allow-overlap': false,
  'text-optional': true,
});
const labelPaint = { 'text-color': COLORS.labelText, 'text-halo-color': COLORS.labelHalo, 'text-halo-width': 2 } as const;

export function BlockMap(props: BlockMapProps): JSX.Element {
  const {
    block,
    plan,
    pieceStatuses,
    highlightIds,
    ghostPlan,
    cacheLabels,
    mode = { kind: 'view' },
    showUserLocation = true,
    onSelect,
    pins,
    style,
  } = props;

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [mapStyle, setMapStyle] = useState<string | StyleSpecification>(BASEMAP_STYLE_URL);
  const [draft, setDraft] = useState<LngLat[]>([]);
  const loc = useUserLocationInternal(showUserLocation);

  // ---- data ----
  const effectiveHighlights = useMemo(() => {
    const ids = [...(highlightIds ?? [])];
    if (mode.kind === 'move-point') ids.push(mode.id);
    return ids;
  }, [highlightIds, mode]);

  const planFc = useMemo(
    () => buildPlanFeatures(plan, { statuses: pieceStatuses, highlightIds: effectiveHighlights, cacheLabels }),
    [plan, pieceStatuses, effectiveHighlights, cacheLabels],
  );
  const pinFc = useMemo(() => buildPinFeatures(pins, effectiveHighlights), [pins, effectiveHighlights]);
  const ghostFc = useMemo(() => buildGhostFeatures(ghostPlan), [ghostPlan]);
  const draftFc = useMemo(() => buildDraftFeatures(draft), [draft]);

  const bounds = useMemo(() => {
    const b = blockBounds(block, plan);
    return b ? toLngLatBounds(ensureMinSize(padBounds(b, 30), 300)) : null;
  }, [block, plan]);

  // Initial view: fit the block once. Later plan edits must not yank the camera around.
  const initialViewState = useMemo(
    () =>
      bounds
        ? { bounds, padding: CAMERA_PADDING }
        : { center: [-122.5, 54] as LngLat, zoom: 4 }, // BC interior, until there is data
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const fittedBlockId = useRef<ID | null>(bounds ? block.id : null);
  useEffect(() => {
    // Fit when the block changes, or when the first data appears for a block that started empty.
    if (bounds && fittedBlockId.current !== block.id) {
      fittedBlockId.current = block.id;
      cameraRef.current?.fitBounds(bounds, { padding: CAMERA_PADDING, duration: 600 });
    }
  }, [block.id, bounds]);

  // Reset the in-progress polygon whenever we leave/enter draw mode.
  useEffect(() => {
    setDraft([]);
  }, [mode.kind]);

  // ---- interaction ----
  const handlePress = useCallback(
    async (e: { nativeEvent: { lngLat: LngLat; point: [number, number] } }) => {
      const { lngLat, point } = e.nativeEvent;
      switch (mode.kind) {
        case 'place-point':
          mode.onPlace(lngLat);
          return;
        case 'move-point':
          mode.onMove(lngLat);
          return;
        case 'draw-polygon':
          setDraft((d) => [...d, lngLat]);
          return;
        case 'view': {
          if (!onSelect) return;
          try {
            const [x, y] = point;
            const features =
              (await mapRef.current?.queryRenderedFeatures(
                [
                  [x - TAP_RADIUS, y - TAP_RADIUS],
                  [x + TAP_RADIUS, y + TAP_RADIUS],
                ],
                { layers: SELECTABLE_LAYERS },
              )) ?? [];
            onSelect(selectionFromFeatures(features));
          } catch {
            onSelect(null);
          }
        }
      }
    },
    [mode, onSelect],
  );

  const recenter = useCallback(() => {
    if (loc.position) cameraRef.current?.easeTo({ center: loc.position, zoom: RECENTER_ZOOM, duration: 600 });
  }, [loc.position]);
  const fitBlock = useCallback(() => {
    if (bounds) cameraRef.current?.fitBounds(bounds, { padding: CAMERA_PADDING, duration: 600 });
  }, [bounds]);

  // Remount overlays (in the right z-order) when the set of imported layers changes,
  // because MapLibre appends newly mounted layers on top.
  const overlaysKey = block.layers.map((l) => l.id).join('|');
  const drawing = mode.kind === 'draw-polygon';

  return (
    <View style={[styles.container, style]}>
      <Map
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyle}
        onPress={handlePress}
        onDidFailLoadingMap={() => {
          // No signal and no offline pack: keep plan overlays usable on a plain background.
          if (mapStyle === BASEMAP_STYLE_URL) setMapStyle(FALLBACK_STYLE as StyleSpecification);
        }}
        doubleTapZoom={mode.kind === 'view'}
        touchPitch={false}
        compass
        compassPosition={{ top: 12, right: 12 }}
        scaleBar
        scaleBarPosition={{ top: 12, left: 12 }}
        attributionPosition={{ bottom: 8, left: 8 }}
        logo={false}
      >
        <Camera ref={cameraRef} initialViewState={initialViewState} maxZoom={20} />

        <Overlays key={overlaysKey}>
          {/* Imported rasters (GeoTIFF / GeoPDF renders), bottom-most */}
          {block.layers.map((l) =>
            l.kind === 'raster' ? (
              <ImageSource key={l.id} id={`cl-raster-src-${l.id}`} url={l.imageUri} coordinates={l.corners}>
                <Layer
                  id={`cl-raster-${l.id}`}
                  type="raster"
                  paint={{ 'raster-opacity': l.opacity ?? 1, 'raster-fade-duration': 0 }}
                />
              </ImageSource>
            ) : null,
          )}

          {/* Imported vector reference data (boundary, roads, streams) */}
          {block.layers.map((l) =>
            l.kind === 'vector' && l.role === 'cutblock' ? (
              // The block outline: a bold line with a dark casing so it reads on imagery; islands too.
              <GeoJSONSource key={l.id} id={`cl-vector-src-${l.id}`} data={l.geojson as any}>
                <Layer
                  id={`cl-cutblock-casing-${l.id}`}
                  type="line"
                  paint={{ 'line-color': COLORS.cutblockCasing, 'line-width': 5, 'line-opacity': 0.6 }}
                  layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                />
                <Layer
                  id={`cl-cutblock-line-${l.id}`}
                  type="line"
                  paint={{ 'line-color': COLORS.cutblock, 'line-width': 2.5 }}
                  layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                />
              </GeoJSONSource>
            ) : l.kind === 'vector' ? (
              <GeoJSONSource key={l.id} id={`cl-vector-src-${l.id}`} data={l.geojson as any}>
                <Layer
                  id={`cl-vector-fill-${l.id}`}
                  type="fill"
                  filter={polygonGeom}
                  paint={{ 'fill-color': COLORS.vector, 'fill-opacity': 0.08 }}
                />
                <Layer
                  id={`cl-vector-line-${l.id}`}
                  type="line"
                  paint={{ 'line-color': COLORS.vector, 'line-width': 2 }}
                  layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                />
                <Layer
                  id={`cl-vector-point-${l.id}`}
                  type="circle"
                  filter={pointGeom}
                  paint={{ 'circle-color': COLORS.vector, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 }}
                />
              </GeoJSONSource>
            ) : null,
          )}

          {/* Previous version (review screen): faded + dashed, underneath */}
          <GeoJSONSource id="cl-ghost-poly-src" data={ghostFc.polygons}>
            <Layer id="cl-ghost-fill" type="fill" paint={{ 'fill-color': COLORS.ghost, 'fill-opacity': 0.08 }} />
            <Layer
              id="cl-ghost-line"
              type="line"
              paint={{ 'line-color': COLORS.ghost, 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="cl-ghost-point-src" data={ghostFc.points}>
            <Layer
              id="cl-ghost-point"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': 'rgba(0,0,0,0)',
                'circle-stroke-color': COLORS.ghost,
                'circle-stroke-width': 2,
                'circle-stroke-opacity': 0.7,
              }}
            />
          </GeoJSONSource>

          {/* Hazard areas */}
          <GeoJSONSource id="cl-hazard-area-src" data={planFc.hazardAreas}>
            <Layer id="cl-hazard-area-fill" type="fill" paint={{ 'fill-color': COLORS.hazardAreaFill, 'fill-opacity': 0.3 }} />
            <Layer
              id="cl-hazard-area-line"
              type="line"
              paint={{ 'line-color': COLORS.hazardAreaLine, 'line-width': ['get', 'lineWidth'], 'line-dasharray': [3, 1.5] }}
            />
          </GeoJSONSource>

          {/* Pieces, coloured by status */}
          <GeoJSONSource id="cl-piece-src" data={planFc.pieces}>
            <Layer
              id="cl-piece-fill"
              type="fill"
              paint={{ 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] }}
            />
            <Layer
              id="cl-piece-halo"
              type="line"
              filter={highlighted}
              paint={{ 'line-color': COLORS.highlightHalo, 'line-width': 11, 'line-opacity': 0.9 }}
              layout={{ 'line-join': 'round' }}
            />
            <Layer
              id="cl-piece-line"
              type="line"
              paint={{ 'line-color': ['get', 'lineColor'], 'line-width': ['get', 'lineWidth'] }}
              layout={{ 'line-join': 'round' }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="cl-piece-label-src" data={planFc.pieceLabels}>
            <Layer id="cl-piece-label" type="symbol" layout={labelLayout(15)} paint={labelPaint} />
          </GeoJSONSource>

          {/* Point hazards */}
          <GeoJSONSource id="cl-hazard-point-src" data={planFc.hazardPoints}>
            <Layer
              id="cl-hazard-point"
              type="circle"
              paint={{
                'circle-radius': ['get', 'radius'],
                'circle-color': COLORS.hazardPoint,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 2.5,
              }}
            />
            <Layer
              id="cl-hazard-label"
              type="symbol"
              layout={{ ...labelLayout(12), 'text-anchor': 'top', 'text-offset': [0, 1.2] }}
              paint={{ ...labelPaint, 'text-color': COLORS.hazardPoint }}
            />
          </GeoJSONSource>

          {/* Caches */}
          <GeoJSONSource id="cl-cache-src" data={planFc.caches}>
            <Layer
              id="cl-cache-halo"
              type="circle"
              filter={highlighted}
              paint={{ 'circle-radius': ['+', ['get', 'radius'], 7], 'circle-color': COLORS.highlightHalo, 'circle-opacity': 0.9 }}
            />
            <Layer
              id="cl-cache-circle"
              type="circle"
              paint={{
                'circle-radius': ['get', 'radius'],
                'circle-color': COLORS.cache,
                'circle-stroke-color': COLORS.cacheStroke,
                'circle-stroke-width': 3,
              }}
            />
            <Layer
              id="cl-cache-label"
              type="symbol"
              layout={{ ...labelLayout(14), 'text-anchor': 'top', 'text-offset': [0, 1.3], 'text-allow-overlap': true }}
              paint={labelPaint}
            />
          </GeoJSONSource>

          {/* Crew pins: a white diamond-ish ring so they never read as caches or plan hazards */}
          <GeoJSONSource id="cl-pin-src" data={pinFc}>
            <Layer
              id="cl-pin-circle"
              type="circle"
              paint={{
                'circle-radius': ['get', 'radius'],
                'circle-color': '#FFFFFF',
                'circle-opacity': ['case', ['==', ['get', 'resolved'], true], 0.5, 1],
                'circle-stroke-width': 5,
                'circle-stroke-opacity': ['case', ['==', ['get', 'resolved'], true], 0.4, 1],
                'circle-stroke-color': [
                  'match',
                  ['get', 'tone'],
                  'danger',
                  COLORS.pinDanger,
                  'request',
                  COLORS.pinRequest,
                  COLORS.pinInfo,
                ],
              }}
            />
            <Layer
              id="cl-pin-label"
              type="symbol"
              layout={{ ...labelLayout(13), 'text-anchor': 'bottom', 'text-offset': [0, -1.2] }}
              paint={labelPaint}
            />
          </GeoJSONSource>

          {/* In-progress polygon while drawing */}
          <GeoJSONSource id="cl-draft-shape-src" data={draftFc.shape}>
            <Layer id="cl-draft-fill" type="fill" filter={polygonGeom} paint={{ 'fill-color': COLORS.draft, 'fill-opacity': 0.2 }} />
            <Layer id="cl-draft-line" type="line" paint={{ 'line-color': COLORS.draft, 'line-width': 3 }} />
          </GeoJSONSource>
          <GeoJSONSource id="cl-draft-vertex-src" data={draftFc.vertices}>
            <Layer
              id="cl-draft-vertex"
              type="circle"
              paint={{
                'circle-radius': ['case', ['==', ['get', 'first'], true], 10, 8],
                'circle-color': '#fff',
                'circle-stroke-color': COLORS.draft,
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        </Overlays>

        {showUserLocation && loc.permission === 'granted' ? <NativeUserLocation mode="heading" /> : null}
      </Map>

      {/* Mode hint banner */}
      {mode.kind !== 'view' ? (
        <View style={styles.banner} pointerEvents="none">
          <Text style={styles.bannerText}>
            {mode.kind === 'place-point'
              ? 'Tap the map to place'
              : mode.kind === 'move-point'
                ? 'Tap the new location'
                : draft.length < 3
                  ? `Tap to add corners (${draft.length}/3 minimum)`
                  : `${draft.length} corners. Tap Done when finished`}
          </Text>
        </View>
      ) : null}

      {/* Floating map buttons (right side) */}
      <View style={styles.sideButtons} pointerEvents="box-none">
        {bounds ? <RoundButton label="Fit" onPress={fitBlock} accessibilityLabel="Show whole block" /> : null}
        {showUserLocation ? (
          <RoundButton
            label="Me"
            onPress={recenter}
            disabled={!loc.position}
            accessibilityLabel={loc.position ? 'Center on my location' : 'Waiting for GPS'}
          />
        ) : null}
      </View>

      {/* Drawing controls */}
      {drawing ? (
        <View style={styles.drawBar} pointerEvents="box-none">
          <BigButton
            label="Cancel"
            color="#555"
            onPress={() => {
              setDraft([]);
              mode.onCancel();
            }}
          />
          <BigButton label="Undo" color="#555" disabled={draft.length === 0} onPress={() => setDraft((d) => d.slice(0, -1))} />
          <BigButton
            label="Done"
            color="#1E8E3E"
            disabled={draft.length < 3}
            onPress={() => {
              const ring = draft;
              setDraft([]);
              mode.onDone(ring);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Fragment wrapper used only so a `key` can force a remount of all overlay layers. */
function Overlays({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function RoundButton(p: { label: string; onPress: () => void; disabled?: boolean; accessibilityLabel: string }) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      hitSlop={10}
      style={({ pressed }) => [styles.round, p.disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.roundText}>{p.label}</Text>
    </Pressable>
  );
}

function BigButton(p: { label: string; onPress: () => void; disabled?: boolean; color: string }) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      hitSlop={8}
      style={({ pressed }) => [styles.big, { backgroundColor: p.color }, p.disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.bigText}>{p.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  banner: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
  bannerText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sideButtons: { position: 'absolute', right: 14, bottom: 120, gap: 14 },
  round: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#222',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  roundText: { fontSize: 18, fontWeight: '800', color: '#111' },
  drawBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 28,
    flexDirection: 'row',
    gap: 12,
  },
  big: {
    flex: 1,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bigText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
