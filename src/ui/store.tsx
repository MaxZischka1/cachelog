import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Store } from '../core/store';
import type { Block, DayString, DeviceSettings, Draft, ID, LogEntry, PlanVersion } from '../core/types';
import { openSqliteStore } from '../db';
import { colors, font, spacing } from './theme';

interface StoreContextValue {
  store: Store;
  /** Bumped after every write so query hooks reload. */
  revision: number;
  bump: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    openSqliteStore()
      .then((s) => {
        if (!cancelled) setStore(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bump = useCallback(() => setRevision((r) => r + 1), []);
  const value = useMemo(() => (store ? { store, revision, bump } : null), [store, revision, bump]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Could not open the database</Text>
        <Text style={styles.body}>{error}</Text>
      </View>
    );
  }
  if (!value) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.body}>Loading Cachelog…</Text>
      </View>
    );
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStoreContext(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/** The Store itself. Call `useBump()` after writes so screens refresh. */
export function useStore(): Store {
  return useStoreContext().store;
}

export function useBump(): () => void {
  return useStoreContext().bump;
}

export interface Query<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Runs `fn(store)` on mount, whenever `deps` change and after every store write (revision bump).
 * Keeps the previous data while reloading so screens don't flash.
 */
export function useStoreQuery<T>(fn: (store: Store) => Promise<T>, deps: React.DependencyList): Query<T> {
  const { store, revision, bump } = useStoreContext();
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn(store)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, revision, ...deps]);

  return { data, loading, error, reload: bump };
}

// ---------- small hooks ----------

export function useSettings() {
  const store = useStore();
  const bump = useBump();
  const q = useStoreQuery((s) => s.getSettings(), []);
  const save = useCallback(
    async (s: DeviceSettings) => {
      await store.saveSettings(s);
      bump();
    },
    [store, bump],
  );
  /** Merge a partial change into the current settings (no-op when settings don't exist yet). */
  const update = useCallback(
    async (patch: Partial<DeviceSettings>) => {
      const cur = await store.getSettings();
      if (!cur) return;
      await store.saveSettings({ ...cur, ...patch });
      bump();
    },
    [store, bump],
  );
  return { settings: q.data ?? null, loading: q.loading && q.data === undefined, error: q.error, save, update };
}

export function useBlocks() {
  return useStoreQuery((s) => s.listBlocks(), []);
}

export function useBlock(id: ID | undefined) {
  return useStoreQuery<Block | null>((s) => (id ? s.getBlock(id) : Promise.resolve(null)), [id]);
}

export function useLatestVersion(blockId: ID | undefined) {
  return useStoreQuery<PlanVersion | null>((s) => (blockId ? s.getLatestVersion(blockId) : Promise.resolve(null)), [blockId]);
}

export function useVersions(blockId: ID | undefined) {
  return useStoreQuery<PlanVersion[]>((s) => (blockId ? s.listVersions(blockId) : Promise.resolve([])), [blockId]);
}

export function useDraft(blockId: ID | undefined) {
  return useStoreQuery<Draft | null>((s) => (blockId ? s.getDraft(blockId) : Promise.resolve(null)), [blockId]);
}

/** Log entries for a block; `day` undefined = whole season. */
export function useLog(blockId: ID | undefined, day?: DayString) {
  return useStoreQuery<LogEntry[]>((s) => (blockId ? s.listLog(blockId, day) : Promise.resolve([])), [blockId, day]);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong.';
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg, gap: spacing.lg },
  title: { fontSize: font.large, fontWeight: '700', color: colors.text, textAlign: 'center' },
  body: { fontSize: font.body, color: colors.text, textAlign: 'center' },
});
