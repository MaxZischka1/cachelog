/**
 * Avenza-style block map: the imported map picture (GeoPDF/GeoTIFF) is the map. Pan and pinch it,
 * see yourself on it, and the plan (pieces, caches, hazards, crew pins) drawn on top. Same props as
 * BlockMap, so every screen works with either. Needs no native map library, so it runs in Expo Go.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { bearingDeg, compass, distanceM, pointInPolygon } from '../core/plan';
import type { LngLat, RasterLayer } from '../core/types';
import { colors, font, radii, spacing } from '../ui/theme';
import type { BlockMapProps } from './BlockMap';
import { buildGhostFeatures, buildPinFeatures, buildPlanFeatures, type FC } from './features';
import { projectionAround, projectionFromCorners, type ImageProjection, type Norm } from './imageProjection';
import { COLORS } from './style';
import { lassoToRing } from './simplify';
import { useUserLocationInternal } from './useUserLocation';

const MIN_SCALE = 0.6;
const MAX_SCALE = 14;
/** Screen-space tap radius for markers: 52 px square, generous for gloves. */
const HIT_PX = 26;

type Pt = [number, number];

/** Latest raster layer on the block: the map picture. */
function basePicture(layers: BlockMapProps['block']['layers']): RasterLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.kind === 'raster') return l;
  }
  return null;
}

function allPoints(fc: FC): LngLat[] {
  const out: LngLat[] = [];
  const walk = (c: any) => {
    if (Array.isArray(c) && typeof c[0] === 'number') out.push([c[0], c[1]]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  for (const f of fc.features) walk((f.geometry as any)?.coordinates);
  return out;
}

function rings(fc: FC): { ring: LngLat[]; props: Record<string, any> }[] {
  const out: { ring: LngLat[]; props: Record<string, any> }[] = [];
  for (const f of fc.features) {
    const g: any = f.geometry;
    if (g?.type === 'Polygon') out.push({ ring: g.coordinates[0], props: f.properties ?? {} });
    else if (g?.type === 'MultiPolygon') for (const p of g.coordinates) out.push({ ring: p[0], props: f.properties ?? {} });
  }
  return out;
}

export function ImageMap(props: BlockMapProps): JSX.Element {
  const { block, plan, pieceStatuses, highlightIds, ghostPlan, cacheLabels, mode = { kind: 'view' }, showUserLocation, onSelect, pins, style } = props;
  const picture = useMemo(() => basePicture(block.layers), [block.layers]);
  const loc = useUserLocationInternal(!!showUserLocation);
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<LngLat[]>([]);
  /** Lasso being dragged, in picture points. */
  const [lasso, setLasso] = useState<Pt[]>([]);
  const lassoRef = useRef<Pt[]>([]);
  const [lassoHint, setLassoHint] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const features = useMemo(
    () => buildPlanFeatures(plan, { statuses: pieceStatuses, highlightIds, cacheLabels }),
    [plan, pieceStatuses, highlightIds, cacheLabels],
  );
  const ghost = useMemo(() => buildGhostFeatures(ghostPlan), [ghostPlan]);
  const pinFC = useMemo(() => buildPinFeatures(pins, highlightIds), [pins, highlightIds]);
  const vectors = useMemo(() => block.layers.filter((l) => l.kind === 'vector'), [block.layers]);

  const proj: ImageProjection | null = useMemo(() => {
    if (picture && !imgFailed) return projectionFromCorners(picture.corners);
    const pts = [
      ...allPoints(features.pieces),
      ...allPoints(features.caches),
      ...allPoints(features.hazardAreas),
      ...allPoints(features.hazardPoints),
      ...vectors.flatMap((v) => allPoints(v.geojson as FC)),
    ];
    return projectionAround(pts);
  }, [picture, imgFailed, features, vectors]);

  // Content size in points: the picture fills the view's width at scale 1.
  const cw = view?.w ?? 1;
  const ch = proj ? cw * proj.aspect : cw;
  const toPx = useCallback((ll: LngLat): Pt => {
    const [x, y] = proj!.toNorm(ll);
    return [x * cw, y * ch];
  }, [proj, cw, ch]);

  // ---- camera ----
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useRef({ s: 1, x: 0, y: 0 });

  const fitTo = useCallback(
    (pts: Pt[], animate = true) => {
      if (!view || !pts.length) return;
      let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of pts) {
        x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
      }
      const pad = 48;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((view.w - pad * 2) / Math.max(x2 - x1, 1), (view.h - pad * 2 - 80) / Math.max(y2 - y1, 1))));
      const nx = view.w / 2 - ((x1 + x2) / 2) * s;
      const ny = view.h / 2 - ((y1 + y2) / 2) * s;
      const set = (sv: SharedValue<number>, v: number) => (sv.value = animate ? withTiming(v, { duration: 260 }) : v);
      set(scale, s);
      set(tx, nx);
      set(ty, ny);
    },
    [view, scale, tx, ty],
  );

  const fitAll = useCallback(
    (animate = true) => {
      if (!proj) return;
      const focus = rings(features.pieces).filter((r) => r.props.highlight).flatMap((r) => r.ring);
      const cacheHl = features.caches.features.filter((f) => f.properties?.highlight).map((f) => (f.geometry as any).coordinates as LngLat);
      const pts = [...focus, ...cacheHl];
      if (pts.length) fitTo(pts.map(toPx), animate);
      else fitTo([[0, 0], [cw, ch]], animate);
    },
    [proj, features, fitTo, toPx, cw, ch],
  );

  const fitted = useRef(false);
  useEffect(() => {
    if (view && proj && !fitted.current) {
      fitted.current = true;
      fitAll(false);
    }
  }, [view, proj, fitAll]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // ---- taps ----
  const screenToLngLat = (x: number, y: number): LngLat | null => {
    if (!proj) return null;
    const cx = (x - tx.value) / scale.value;
    const cy = (y - ty.value) / scale.value;
    const n: Norm = [cx / cw, cy / ch];
    return proj.toLngLat(n);
  };
  const toScreen = (ll: LngLat): Pt => {
    const [x, y] = toPx(ll);
    return [tx.value + x * scale.value, ty.value + y * scale.value];
  };

  const onTap = (x: number, y: number) => {
    const ll = screenToLngLat(x, y);
    if (!ll) return;
    switch (mode.kind) {
      case 'place-point':
        mode.onPlace(ll);
        return;
      case 'move-point':
        mode.onMove(ll);
        return;
      case 'draw-polygon':
        setDraft((d) => [...d, ll]);
        return;
      default:
        break;
    }
    if (!onSelect) return;
    // Points first (closest within reach), then areas.
    let best: { d: number; type: 'cache' | 'hazard' | 'pin'; id: string } | null = null;
    const consider = (fc: FC, type: 'cache' | 'hazard' | 'pin') => {
      for (const f of fc.features) {
        const [sx, sy] = toScreen((f.geometry as any).coordinates as LngLat);
        const d = Math.hypot(sx - x, sy - y);
        if (d <= HIT_PX && (!best || d < best.d)) best = { d, type, id: f.properties?.id };
      }
    };
    consider(pinFC, 'pin');
    consider(features.caches, 'cache');
    consider(features.hazardPoints, 'hazard');
    if (best) return onSelect({ type: (best as { type: 'cache' | 'hazard' | 'pin' }).type, id: (best as { id: string }).id });
    for (const { ring, props: p } of rings(features.hazardAreas)) if (pointInPolygon(ll, ring)) return onSelect({ type: 'hazard', id: p.id });
    for (const { ring, props: p } of rings(features.pieces)) if (pointInPolygon(ll, ring)) return onSelect({ type: 'piece', id: p.id });
    onSelect(null);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .averageTouches(true)
    .onStart(() => {
      start.current = { s: scale.value, x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      tx.value = start.current.x + e.translationX;
      ty.value = start.current.y + e.translationY;
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      start.current = { s: scale.value, x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.current.s * e.scale));
      const k = s / start.current.s;
      // keep the point under the fingers still
      tx.value = e.focalX - (e.focalX - start.current.x) * k;
      ty.value = e.focalY - (e.focalY - start.current.y) * k;
      scale.value = s;
    });
  const doubleTap = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .onEnd((e, ok) => {
      if (!ok || mode.kind !== 'view') return;
      const s = Math.min(MAX_SCALE, scale.value * 2);
      const k = s / scale.value;
      tx.value = withTiming(e.x - (e.x - tx.value) * k, { duration: 220 });
      ty.value = withTiming(e.y - (e.y - ty.value) * k, { duration: 220 });
      scale.value = withTiming(s, { duration: 220 });
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(400)
    .onEnd((e, ok) => {
      if (ok) onTap(e.x, e.y);
    });
  const freehand = mode.kind === 'draw-freehand';
  const lastScreen = useRef<Pt>([0, 0]);
  const toContent = (x: number, y: number): Pt => [(x - tx.value) / scale.value, (y - ty.value) / scale.value];
  const finishLasso = () => {
    const pts = lassoRef.current;
    lassoRef.current = [];
    const ring = lassoToRing(pts, 2.5 / scale.value, 24 / scale.value);
    if (!ring || !proj || mode.kind !== 'draw-freehand') {
      setLasso([]);
      if (pts.length) setLassoHint('Too small. Drag around the whole area.');
      return;
    }
    const lls = ring.map(([x, y]) => proj.toLngLat([x / cw, y / ch]));
    setLasso(ring);
    setLassoHint(null);
    mode.onDone(lls);
  };
  const lassoGesture = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .minDistance(4)
    .onStart((e) => {
      lastScreen.current = [e.x, e.y];
      lassoRef.current = [toContent(e.x, e.y)];
      setLasso(lassoRef.current);
      setLassoHint(null);
    })
    .onUpdate((e) => {
      const [lx, ly] = lastScreen.current;
      if (Math.hypot(e.x - lx, e.y - ly) < 3) return;
      lastScreen.current = [e.x, e.y];
      lassoRef.current = [...lassoRef.current, toContent(e.x, e.y)];
      setLasso(lassoRef.current);
    })
    .onEnd(() => finishLasso());
  const twoFingerPan = Gesture.Pan()
    .runOnJS(true)
    .minPointers(2)
    .averageTouches(true)
    .onStart(() => {
      start.current = { s: scale.value, x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      tx.value = start.current.x + e.translationX;
      ty.value = start.current.y + e.translationY;
    });
  useEffect(() => {
    if (!freehand) {
      setLasso([]);
      setLassoHint(null);
    }
  }, [freehand]);
  const gesture = freehand
    ? Gesture.Race(Gesture.Simultaneous(twoFingerPan, pinch), lassoGesture)
    : Gesture.Simultaneous(pan, pinch, Gesture.Exclusive(doubleTap, tap));

  // ---- GPS ----
  const me = showUserLocation ? loc.position : null;
  const meNorm = me && proj ? proj.toNorm(me) : null;
  const offMap = meNorm && (meNorm[0] < -0.02 || meNorm[0] > 1.02 || meNorm[1] < -0.02 || meNorm[1] > 1.02);
  const centerOnMe = () => {
    if (!me || !view) return;
    const [x, y] = toPx(me);
    const s = Math.max(scale.value, 3);
    scale.value = withTiming(s, { duration: 260 });
    tx.value = withTiming(view.w / 2 - x * s, { duration: 260 });
    ty.value = withTiming(view.h / 2 - y * s, { duration: 260 });
  };
  const mapCentre = proj ? proj.toLngLat([0.5, 0.5]) : null;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!view || Math.abs(view.w - width) > 1 || Math.abs(view.h - height) > 1) setView({ w: width, h: height });
  };

  const drawing = mode.kind === 'draw-polygon';

  if (!proj) {
    return (
      <View style={[styles.wrap, styles.empty, style]}>
        <Ionicons name="map-outline" size={48} color={colors.textFaint} />
        <Text style={styles.emptyTitle}>No map for this block yet</Text>
        <Text style={styles.emptyBody}>The crew boss imports the block's PDF map, then it shows here with your piece and caches.</Text>
      </View>
    );
  }

  const poly = (ring: LngLat[]) => ring.map((p) => toPx(p).map((v) => v.toFixed(1)).join(',')).join(' ');

  return (
    <View style={[styles.wrap, style]} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Animated.View style={[styles.content, { width: cw, height: ch }, contentStyle]}>
            {picture && !imgFailed ? (
              <Image source={{ uri: picture.imageUri }} style={{ width: cw, height: ch }} resizeMode="stretch" onError={() => setImgFailed(true)} />
            ) : (
              <View style={[styles.sheet, { width: cw, height: ch }]} />
            )}
            <Svg width={cw} height={ch} style={StyleSheet.absoluteFill}>
              {vectors.flatMap((v) =>
                rings(v.geojson as FC).map((r, i) => (
                  <Polygon key={`${v.id}-${i}`} points={poly(r.ring)} fill="none" stroke={COLORS.vector} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                )),
              )}
              {rings(ghost.polygons).map((r, i) => (
                <Polygon key={`g${i}`} points={poly(r.ring)} fill="none" stroke={COLORS.ghost} strokeWidth={2} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              ))}
              {rings(features.pieces).map(({ ring, props: p }) => (
                <Polygon
                  key={p.id}
                  points={poly(ring)}
                  fill={p.fillColor}
                  fillOpacity={Math.max(p.fillOpacity, p.highlight ? 0.18 : 0.06)}
                  stroke={p.highlight ? '#FFFFFF' : p.lineColor}
                  strokeWidth={p.highlight ? 4 : 2.5}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {rings(features.hazardAreas).map(({ ring, props: p }) => (
                <Polygon key={p.id} points={poly(ring)} fill={COLORS.hazardAreaFill} fillOpacity={0.25} stroke={COLORS.hazardAreaLine} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              ))}
              {lasso.length > 1 ? (
                <Polyline
                  points={lasso.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
                  fill={COLORS.draft}
                  fillOpacity={0.15}
                  stroke={COLORS.draft}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {draft.length > 1 ? (
                <Polyline points={poly(draft.length > 2 ? [...draft, draft[0]] : draft)} fill={draft.length > 2 ? COLORS.draft : 'none'} fillOpacity={0.15} stroke={COLORS.draft} strokeWidth={3} vectorEffect="non-scaling-stroke" />
              ) : null}
            </Svg>
          </Animated.View>

          {/* Markers keep their size while the map zooms. */}
          {rings(features.pieces).map(({ ring, props: p }) => {
            const c = ring.reduce<Pt>((s, q) => [s[0] + q[0] / ring.length, s[1] + q[1] / ring.length], [0, 0]) as LngLat;
            return (
              <Marker key={`l${p.id}`} at={toPx(c)} scale={scale} tx={tx} ty={ty} minScale={0.9}>
                <Text style={[styles.pieceLabel, p.highlight && styles.pieceLabelHl]} numberOfLines={1}>
                  {p.name}
                </Text>
              </Marker>
            );
          })}
          {features.hazardPoints.features.map((f) => (
            <Marker key={f.properties?.id} at={toPx((f.geometry as any).coordinates)} scale={scale} tx={tx} ty={ty}>
              <View style={[styles.dot, { backgroundColor: COLORS.hazardPoint }]}>
                <Ionicons name="warning" size={14} color="#fff" />
              </View>
            </Marker>
          ))}
          {features.caches.features.map((f) => (
            <Marker key={f.properties?.id} at={toPx((f.geometry as any).coordinates)} scale={scale} tx={tx} ty={ty}>
              <View style={[styles.cache, f.properties?.highlight && styles.cacheHl]}>
                <Ionicons name="cube" size={f.properties?.highlight ? 20 : 16} color="#fff" />
              </View>
              <Text style={styles.markerLabel} numberOfLines={2}>
                {f.properties?.label}
              </Text>
            </Marker>
          ))}
          {pinFC.features.map((f) => (
            <Marker key={f.properties?.id} at={toPx((f.geometry as any).coordinates)} scale={scale} tx={tx} ty={ty}>
              <View
                style={[
                  styles.pin,
                  { backgroundColor: f.properties?.tone === 'danger' ? COLORS.pinDanger : f.properties?.tone === 'request' ? COLORS.pinRequest : COLORS.pinInfo },
                  f.properties?.resolved && styles.resolved,
                ]}
              >
                <Ionicons name="flag" size={14} color="#fff" />
              </View>
            </Marker>
          ))}
          {draft.map((p, i) => (
            <Marker key={`d${i}`} at={toPx(p)} scale={scale} tx={tx} ty={ty}>
              <View style={[styles.vertex, i === 0 && styles.vertexFirst]} />
            </Marker>
          ))}
          {me && meNorm && !offMap ? (
            <Marker at={toPx(me)} scale={scale} tx={tx} ty={ty}>
              <View style={styles.meHalo}>
                <View style={styles.me} />
              </View>
            </Marker>
          ) : null}
        </View>
      </GestureDetector>

      {mode.kind !== 'view' ? (
        <View style={[styles.banner, (drawing || freehand) && styles.bannerAboveBar]} pointerEvents="none">
          <Text style={styles.bannerText}>
            {mode.kind === 'draw-freehand'
              ? lassoHint ?? 'Drag a finger around the area. Two fingers move the map.'
              : mode.kind === 'place-point'
              ? 'Tap the map to place'
              : mode.kind === 'move-point'
                ? 'Tap the new location'
                : draft.length < 3
                  ? `Tap to add corners (${draft.length}/3 minimum)`
                  : `${draft.length} corners. Tap Done when finished`}
          </Text>
        </View>
      ) : offMap && me && mapCentre ? (
        <View style={styles.banner} pointerEvents="none">
          <Text style={styles.bannerText}>
            You're off this map · {formatKm(distanceM(me, mapCentre))} {compass(bearingDeg(me, mapCentre))} to the block
          </Text>
        </View>
      ) : null}

      <View style={styles.side} pointerEvents="box-none">
        <RoundButton icon="scan-outline" label="Show whole map" onPress={() => fitAll(true)} />
        {showUserLocation ? <RoundButton icon="locate" label="Center on me" disabled={!me || !!offMap} onPress={centerOnMe} /> : null}
      </View>

      {mode.kind === 'draw-freehand' ? (
        <View style={styles.drawBar} pointerEvents="box-none">
          <BarButton label="Cancel" onPress={() => { lassoRef.current = []; setLasso([]); mode.onCancel(); }} />
        </View>
      ) : null}

      {drawing ? (
        <View style={styles.drawBar} pointerEvents="box-none">
          <BarButton label="Cancel" onPress={() => { setDraft([]); mode.onCancel(); }} />
          <BarButton label="Undo" disabled={draft.length === 0} onPress={() => setDraft((d) => d.slice(0, -1))} />
          <BarButton
            label="Done"
            primary
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

function formatKm(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** A view pinned to a map point that stays the same size on screen. */
function Marker({ at, scale, tx, ty, children, minScale }: { at: Pt; scale: SharedValue<number>; tx: SharedValue<number>; ty: SharedValue<number>; children: React.ReactNode; minScale?: number }) {
  const [x, y] = at;
  const st = useAnimatedStyle(() => ({
    opacity: minScale && scale.value < minScale ? 0 : 1,
    transform: [{ translateX: tx.value + x * scale.value }, { translateY: ty.value + y * scale.value }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.markerAnchor, st]}>
      <View style={styles.markerInner}>{children}</View>
    </Animated.View>
  );
}

function RoundButton({ icon, label, onPress, disabled }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => [styles.round, disabled && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name={icon} size={24} color={colors.text} />
    </Pressable>
  );
}

function BarButton({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.bar, primary && styles.barPrimary, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={[styles.barText, primary && styles.barTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: '#1d1f1c' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl, backgroundColor: colors.surface },
  emptyTitle: { fontSize: font.large, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
  content: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left' },
  sheet: { backgroundColor: '#2a2d28' },
  markerAnchor: { position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible' },
  markerInner: { position: 'absolute', width: 160, left: -80, top: -14, alignItems: 'center' },
  cache: { width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.cache, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cacheHl: { width: 40, height: 40, borderRadius: 20, marginTop: -5, backgroundColor: colors.primary, borderWidth: 3 },
  markerLabel: { marginTop: 2, fontSize: 13, fontWeight: '800', color: '#111', backgroundColor: 'rgba(255,255,255,0.88)', paddingHorizontal: 5, borderRadius: 5, overflow: 'hidden', textAlign: 'center' },
  pieceLabel: { fontSize: 13, fontWeight: '800', color: '#111', backgroundColor: 'rgba(255,214,10,0.9)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden', marginTop: 4 },
  pieceLabelHl: { backgroundColor: '#fff', fontSize: 15 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pin: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  resolved: { opacity: 0.45 },
  vertex: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', borderWidth: 3, borderColor: COLORS.draft, marginTop: 5 },
  vertexFirst: { width: 24, height: 24, borderRadius: 12, marginTop: 2 },
  meHalo: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(10,132,255,0.25)', alignItems: 'center', justifyContent: 'center', marginTop: -4 },
  me: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#0A84FF', borderWidth: 3, borderColor: '#fff' },
  banner: { position: 'absolute', bottom: spacing.xl, left: spacing.lg, right: 76, backgroundColor: 'rgba(23,23,26,0.94)', borderRadius: radii.control, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bannerAboveBar: { bottom: spacing.xl + 68 },
  bannerText: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  side: { position: 'absolute', right: spacing.md, bottom: spacing.xl, gap: spacing.sm },
  round: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(23,23,26,0.94)', alignItems: 'center', justifyContent: 'center' },
  drawBar: { position: 'absolute', left: spacing.lg, right: 76, bottom: spacing.xl, flexDirection: 'row', gap: spacing.sm },
  bar: { flex: 1, minHeight: 56, borderRadius: radii.pill, backgroundColor: 'rgba(23,23,26,0.94)', alignItems: 'center', justifyContent: 'center' },
  barPrimary: { backgroundColor: colors.primary },
  barText: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  barTextPrimary: { color: colors.primaryText },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
