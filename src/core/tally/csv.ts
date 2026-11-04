import type { ID, LogEntry, PlanContent, TallyEntry } from '../types';
import { centsPlain } from './format';
import { activeEntries } from './log';
import type { DaySummary } from './reconcile';

/** RFC 4180 field: quoted when it contains a comma, double quote, CR or LF; quotes doubled. */
export function csvField(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 document: header + rows, CRLF line breaks, trailing CRLF. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function cmp(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/**
 * day,planter,piece,species,count — one row per (day, planter, piece, species), summed over the
 * active tally entries in `log` for plan.blockId. Does NOT filter by plan.day: pass one day's log
 * for a daily sheet or the whole block log for a season sheet. Names come from `plan`; ids not
 * found there are written as "Unknown (<id>)" so the row is still traceable.
 */
export function talliesCsv(plan: PlanContent, log: LogEntry[]): string {
  const planterName = (id: ID) => plan.planters.find((p) => p.id === id)?.name ?? `Unknown (${id})`;
  const pieceName = (id: ID) => plan.pieces.find((p) => p.id === id)?.name ?? `Unknown (${id})`;

  const totals = new Map<string, { day: string; planter: string; piece: string; species: string; count: number }>();
  for (const e of activeEntries(log)) {
    if (e.type !== 'tally' || e.blockId !== plan.blockId) continue;
    const t = e as TallyEntry;
    for (const sc of t.trees) {
      const key = JSON.stringify([t.day, t.planterId, t.pieceId, sc.species]);
      const row = totals.get(key);
      if (row) row.count += sc.count;
      else
        totals.set(key, {
          day: t.day,
          planter: planterName(t.planterId),
          piece: pieceName(t.pieceId),
          species: sc.species,
          count: sc.count,
        });
    }
  }
  const rows = [...totals.values()]
    .filter((r) => r.count !== 0)
    .sort((a, b) => cmp(a.day, b.day) || cmp(a.planter, b.planter) || cmp(a.piece, b.piece) || cmp(a.species, b.species))
    .map((r) => [r.day, r.planter, r.piece, r.species, r.count]);
  return toCsv(['day', 'planter', 'piece', 'species', 'count'], rows);
}

/** day,planter,trees,earnings — earnings as a plain decimal in dollars ("1234.56"). */
export function payrollCsv(summary: DaySummary): string {
  const rows = summary.planters.map((p) => [summary.day, p.name, p.totalTallied, centsPlain(p.earningsCents)]);
  return toCsv(['day', 'planter', 'trees', 'earnings'], rows);
}

/** day,piece,status,trees,area_ha (area to 2 decimals). */
export function piecesCsv(summary: DaySummary): string {
  const rows = summary.pieces.map((p) => [summary.day, p.name, p.status, p.tallied, p.areaHa.toFixed(2)]);
  return toCsv(['day', 'piece', 'status', 'trees', 'area_ha'], rows);
}
