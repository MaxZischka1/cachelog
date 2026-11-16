import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { today } from '../../core/plan';
import { crewStats, lastDays, planterStats, type PlanterStats } from '../../core/stats';
import { cleanTrack, coverage, trackDistanceM, trackLines } from '../../core/track';
import type { Block, ID, LogEntry, PlanVersion } from '../../core/types';
import { allShifts, deleteShift } from '../../tracking';
import { confirm, showError } from '../alerts';
import { fmtDay, fmtDistance, fmtDollars, fmtDuration, fmtHa, fmtInt } from '../format';
import { useLogWriter } from '../hooks/useLogWriter';
import { usePlanterData } from '../hooks/usePlanter';
import { trackEntryFields, useShift } from '../hooks/useShift';
import { useSendUpdates } from '../hooks/useSendUpdates';
import { ColumnChart, ListGroup, ListRow, Stat, StatRow, type Column } from '../kit';
import { Screen } from '../Screen';
import { EmptyState, Muted, Section } from '../Section';
import { useSettings, useStoreQuery } from '../store';
import { colors, font, spacing } from '../theme';

type Row = { block: Block; latest: PlanVersion | null; log: LogEntry[] };

/** How the planting has been going: the planter's season, or the crew's for a crew boss. */
export function ProfileScreen() {
  const { settings } = useSettings();
  const { data } = useStoreQuery(async (s) => {
    const blocks = await s.listBlocks();
    return Promise.all(blocks.map(async (b) => ({ block: b, latest: await s.getLatestVersion(b.id), log: await s.listLog(b.id) }))) as Promise<Row[]>;
  }, []);
  if (!settings) return <Screen tab>{null}</Screen>;
  return settings.role === 'crew-boss' ? <BossProfile rows={data ?? []} name={settings.userName} /> : <PlanterProfile rows={data ?? []} name={settings.userName} />;
}

function Identity({ name, role }: { name: string; role: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return (
    <View style={styles.identity}>
      <View style={styles.avatar}>
        <Text style={styles.initials}>{initials}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.name}>{name}</Text>
        <Muted>{role}</Muted>
      </View>
    </View>
  );
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function chartOf(stats: PlanterStats, day: string): { data: Column[]; highlight: string[] } {
  const days = lastDays(stats, day, 14);
  const data = days.map((d) => ({
    key: d.day,
    label: WEEKDAY[new Date(`${d.day}T12:00:00`).getDay()],
    value: d.trees,
    detail: `${fmtDay(d.day)}: ${d.trees ? `${fmtInt(d.trees)} trees${d.cents ? `, ${fmtDollars(d.cents)}` : ''}` : 'no trees'}`,
  }));
  const best = days.reduce((m, d) => (d.trees > m.trees ? d : m), days[0]);
  return { data, highlight: [best?.day, day].filter((x): x is string => !!x) };
}

function SeasonStats({ stats }: { stats: PlanterStats }) {
  return (
    <>
      <StatRow>
        <Stat label="trees this season" value={fmtInt(stats.totalTrees)} />
        <Stat label="a day on average" value={fmtInt(stats.averagePerDay)} />
        <Stat label="best day" value={stats.best ? fmtInt(stats.best.trees) : '–'} sub={stats.best ? fmtDay(stats.best.day) : undefined} />
      </StatRow>
      <StatRow>
        <Stat label="earned (est.)" value={fmtDollars(stats.totalCents)} />
        <Stat label="days planted" value={String(stats.days.length)} />
        <Stat label={stats.blocks === 1 ? 'block' : 'blocks'} value={String(stats.blocks)} />
      </StatRow>
    </>
  );
}

function PlanterProfile({ rows, name }: { rows: Row[]; name: string }) {
  const d = usePlanterData();
  const day = today();
  const planterId = d.planter?.id;
  const blocks = useMemo(() => new Map(rows.map((r) => [r.block.id, r.block])), [rows]);
  const stats = useMemo(() => (planterId ? planterStats(rows.flatMap((r) => r.log), planterId, blocks, day) : null), [rows, planterId, blocks, day]);
  const chart = useMemo(() => (stats ? chartOf(stats, day) : null), [stats, day]);
  const [tracks, reloadTracks] = useSeasonTracks();
  const shift = useShift({ blockId: d.blockId, planterId, piece: d.piece });
  const { add } = useLogWriter(d.blockId, day);
  const updates = useSendUpdates(d.blockId);

  const sendTrack = async () => {
    if (!shift.summary.lines.length) return;
    const ok = await confirm(
      'Send today’s track?',
      `Your path today (${fmtDistance(shift.summary.distanceM)}, ${fmtHa(shift.summary.coveredHa)} covered) goes to the crew boss with your updates. It stays on this phone too.`,
      'Send',
    );
    if (!ok) return;
    try {
      await add('track', trackEntryFields(shift.summary, planterId));
      await updates.send();
    } catch (e) {
      showError('Could not send the track', e);
    }
  };

  return (
    <Screen tab>
      <Identity name={d.planter?.name ?? name} role={`Planter${d.block ? ` · ${d.block.name}` : ''}`} />

      {!stats || stats.totalTrees === 0 ? (
        <EmptyState title="No trees logged yet" message="Your season fills in here as you log bag-ups: trees a day, best day, earnings." />
      ) : (
        <>
          <SeasonStats stats={stats} />
          <Section title="Last 14 days">
            <View style={styles.card}>{chart ? <ColumnChart data={chart.data} highlight={chart.highlight} /> : null}</View>
            <Muted>From your bag-ups; days your crew boss tallied use the tally.</Muted>
          </Section>
          {stats.species.length > 1 ? (
            <Section title="Species">
              <ListGroup icons={false}>
                {stats.species.map((s) => (
                  <ListRow key={s.species} title={s.species} value={`${fmtInt(s.count)}  ·  ${Math.round((s.count / stats.totalTrees) * 100)}%`} />
                ))}
              </ListGroup>
            </Section>
          ) : null}
        </>
      )}

      <Section title="Shift tracking">
        <StatRow>
          <Stat label="hours tracked" value={tracks ? fmtHours(tracks.ms) : '–'} />
          <Stat label="walked" value={tracks ? fmtDistance(tracks.distanceM) : '–'} />
          <Stat label="covered" value={tracks ? fmtHa(tracks.ha) : '–'} />
        </StatRow>
        {stats?.today && shift.summary.durationMs > 15 * 60_000 ? (
          <Muted>{`Today: about ${fmtInt(Math.round(stats.today.trees / (shift.summary.durationMs / 3_600_000)))} trees an hour on shift.`}</Muted>
        ) : null}
        <ListGroup>
          <ListRow
            icon="share-outline"
            title="Send today’s track"
            subtitle={shift.summary.lines.length ? 'To your crew boss, with your updates' : 'Nothing tracked today'}
            onPress={sendTrack}
            disabled={!shift.summary.lines.length || updates.sending}
          />
          <ListRow icon="trash-outline" title="Delete my tracks" tone="danger" onPress={tracks?.count ? () => deleteTracks(tracks.ids, reloadTracks) : undefined} disabled={!tracks?.count} value={tracks ? String(tracks.count) : undefined} />
        </ListGroup>
        <Muted>Tracks are saved on this phone first. Nobody else sees them unless you send one.</Muted>
      </Section>

      {stats && stats.days.length ? (
        <Section title="Recent days">
          <ListGroup icons={false}>
            {[...stats.days].reverse().slice(0, 10).map((x) => (
              <ListRow key={x.day} title={fmtDay(x.day)} subtitle={x.source === 'tally' ? 'Tallied' : 'Bagged'} value={`${fmtInt(x.trees)}${x.cents ? `  ·  ${fmtDollars(x.cents)}` : ''}`} />
            ))}
          </ListGroup>
        </Section>
      ) : null}

      <ListGroup>
        <ListRow icon="person-circle-outline" title={d.planter ? `Not ${d.planter.name}?` : 'Which planter am I?'} onPress={() => router.push('/planter/who')} />
        <ListRow icon="settings-outline" title="Settings" subtitle="Name and role" onPress={() => router.push('/settings')} />
      </ListGroup>
    </Screen>
  );
}

async function deleteTracks(ids: string[], done: () => void) {
  if (!(await confirm('Delete your tracks?', `All ${ids.length} recorded shift${ids.length === 1 ? '' : 's'} are removed from this phone. Tracks you already sent stay with the crew boss.`, 'Delete', true))) return;
  try {
    for (const id of ids) await deleteShift(id);
  } catch (e) {
    showError('Could not delete the tracks', e);
  }
  done();
}

function fmtHours(ms: number): string {
  return ms < 3_600_000 ? fmtDuration(ms) : `${(ms / 3_600_000).toFixed(1)} h`;
}

/** Season totals over every shift recorded on this phone. */
function useSeasonTracks() {
  const [v, setV] = useState<{ ms: number; distanceM: number; ha: number; count: number; ids: string[] } | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    allShifts()
      .then((all) => {
        let ms = 0, distanceM = 0, ha = 0;
        for (const { shift, points } of all) {
          ms += (shift.endedAt ? Date.parse(shift.endedAt) : Date.now()) - Date.parse(shift.startedAt);
          const clean = cleanTrack(points);
          distanceM += trackDistanceM(clean);
          ha += coverage(trackLines(clean), 3).ha;
        }
        if (!cancelled) setV({ ms, distanceM, ha, count: all.length, ids: all.map((a) => a.shift.id) });
      })
      .catch(() => !cancelled && setV({ ms: 0, distanceM: 0, ha: 0, count: 0, ids: [] }));
    return () => {
      cancelled = true;
    };
  }, [nonce]);
  return [v, () => setNonce((n) => n + 1)] as const;
}

function BossProfile({ rows, name }: { rows: Row[]; name: string }) {
  const day = today();
  const blocks = useMemo(() => new Map(rows.map((r) => [r.block.id, r.block])), [rows]);
  const crew = useMemo(() => crewStats(rows.flatMap((r) => r.log), blocks, day), [rows, blocks, day]);
  const names = useMemo(() => {
    const m = new Map<ID, string>();
    for (const r of rows) for (const p of r.latest?.content.planters ?? []) m.set(p.id, p.name);
    return m;
  }, [rows]);
  const chart = useMemo(() => chartOf(crew.crew, day), [crew, day]);

  return (
    <Screen tab>
      <Identity name={name} role="Crew boss" />
      {crew.crew.totalTrees === 0 ? (
        <EmptyState title="No trees in yet" message="Import your planters’ updates and enter tallies; the crew’s season shows here." />
      ) : (
        <>
          <SeasonStats stats={crew.crew} />
          <Section title="Crew · last 14 days">
            <View style={styles.card}>
              <ColumnChart data={chart.data} highlight={chart.highlight} />
            </View>
          </Section>
          <Section title="Planters">
            <ListGroup>
              {crew.planters.map(({ planterId, stats }) => (
                <ListRow
                  key={planterId}
                  icon="person-outline"
                  title={names.get(planterId) ?? 'Unknown planter'}
                  subtitle={`${fmtInt(stats.averagePerDay)} a day · best ${stats.best ? fmtInt(stats.best.trees) : '–'}${stats.today ? ` · today ${fmtInt(stats.today.trees)}` : ''}`}
                  value={fmtInt(stats.totalTrees)}
                />
              ))}
            </ListGroup>
          </Section>
        </>
      )}
      <ListGroup>
        <ListRow icon="settings-outline" title="Settings" subtitle="Name and role" onPress={() => router.push('/settings')} />
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.sm },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: font.large, fontWeight: '800', color: colors.primary },
  name: { fontSize: font.title, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.hairline, padding: spacing.lg },
});

