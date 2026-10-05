import type { ScoreEntry } from '../types';

// Winner rules for the optional Hadiah Terpantas / Hadiah Terbanyak, shared by
// CMS > Keputusan and the public past-results card so both always agree.

/** Capture time in ms; records without a usable time sort last. */
export const recordTime = (entry: ScoreEntry): number => {
  const raw: any = entry.capturedAt;
  const ms = raw && typeof raw.toDate === 'function' ? raw.toDate().getTime() : new Date(raw || '').getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : Number.MAX_SAFE_INTEGER;
};

/** Terpantas: the first weigh-in recorded in the competition. */
export const fastestRecord = (entries: ScoreEntry[]): ScoreEntry | null =>
  [...entries].sort((a, b) => recordTime(a) - recordTime(b))[0] || null;

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
 * Terbanyak: most weigh-ins per angler/peg; ties go to whoever reached that
 * count first. `winners` holds more than one row only on an exact tie, in which
 * case the prize is shared.
 */
export const mostRecordRanking = (entries: ScoreEntry[]): { rows: RecordCountRow[]; winners: RecordCountRow[] } => {
  const byAngler = new Map<string, ScoreEntry[]>();
  entries.forEach((entry) => {
    const key = `${entry.bookingId || (entry.anglerName || '').trim().toLowerCase()}:${entry.pondId}:${entry.seatNum}`;
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
  }).sort((a, b) => (b.records.length - a.records.length) || (a.reachedAt - b.reachedAt) || (a.firstAt - b.firstAt) || a.seatNum - b.seatNum);
  const leader = rows[0];
  const winners = leader ? rows.filter((row) => row.records.length === leader.records.length && row.reachedAt === leader.reachedAt) : [];
  return { rows, winners };
};
