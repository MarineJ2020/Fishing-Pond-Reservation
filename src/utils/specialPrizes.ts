import type { ScoreEntry } from '../types';

// Winner rules for the optional Hadiah Terpantas / Hadiah Terbanyak, shared by
// CMS > Keputusan and the public past-results card so both always agree.
// Times are compared to the minute — the precision staff and players see — so
// anything recorded in the same minute counts as a tie and the prize is shared.

/** Capture time in ms; records without a usable time sort last. */
export const recordTime = (entry: ScoreEntry): number => {
  const raw: any = entry.capturedAt;
  const ms = raw && typeof raw.toDate === 'function' ? raw.toDate().getTime() : new Date(raw || '').getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : Number.MAX_SAFE_INTEGER;
};

const UNKNOWN = Number.MAX_SAFE_INTEGER;
/** Minute bucket used for tie decisions. */
const recordMinute = (ms: number): number => (ms === UNKNOWN ? UNKNOWN : Math.floor(ms / 60000));

const anglerKey = (entry: ScoreEntry): string =>
  `${entry.bookingId || (entry.anglerName || '').trim().toLowerCase()}:${entry.pondId}:${entry.seatNum}`;

/**
 * Terpantas: the earliest weigh-in. Every angler whose first fish was recorded
 * in that same minute shares the prize (one entry per angler, oldest first).
 */
export const fastestRecords = (entries: ScoreEntry[]): ScoreEntry[] => {
  const sorted = [...entries].sort((a, b) => recordTime(a) - recordTime(b));
  if (!sorted.length) return [];
  const minute = recordMinute(recordTime(sorted[0]));
  if (minute === UNKNOWN) return [sorted[0]];
  const seen = new Set<string>();
  return sorted.filter((entry) => {
    if (recordMinute(recordTime(entry)) !== minute) return false;
    const key = anglerKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export interface RecordCountRow {
  key: string;
  anglerName: string;
  pondId: number;
  pondName: string;
  seatNum: number;
  /** Oldest first. */
  records: ScoreEntry[];
  /** When this angler reached their final count. */
  reachedAt: number;
  firstAt: number;
}

/**
 * Terbanyak: most weigh-ins per angler/peg. On equal counts, whoever reached
 * that count first wins; anglers who reached it in the same minute share.
 */
export const mostRecordRanking = (entries: ScoreEntry[]): { rows: RecordCountRow[]; winners: RecordCountRow[] } => {
  const byAngler = new Map<string, ScoreEntry[]>();
  entries.forEach((entry) => {
    const key = anglerKey(entry);
    byAngler.set(key, [...(byAngler.get(key) || []), entry]);
  });
  const rows: RecordCountRow[] = Array.from(byAngler.entries(), ([key, list]) => {
    const records = [...list].sort((a, b) => recordTime(a) - recordTime(b));
    const last = records[records.length - 1];
    return {
      key,
      anglerName: last.anglerName || 'Tanpa nama',
      pondId: last.pondId,
      pondName: last.pondName,
      seatNum: last.seatNum,
      records,
      reachedAt: recordTime(last),
      firstAt: recordTime(records[0]),
    };
  }).sort((a, b) => (b.records.length - a.records.length)
    || (recordMinute(a.reachedAt) - recordMinute(b.reachedAt))
    || (a.reachedAt - b.reachedAt) || (a.firstAt - b.firstAt) || a.seatNum - b.seatNum);
  const leader = rows[0];
  const winners = leader
    ? rows.filter((row) => row.records.length === leader.records.length && recordMinute(row.reachedAt) === recordMinute(leader.reachedAt))
    : [];
  return { rows, winners };
};
