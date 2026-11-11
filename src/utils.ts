import { DB, Score, Prize } from './types';

/**
 * Site-wide date formatting. All displayed dates use numeric dd/mm/yyyy so the
 * day/month order is never ambiguous. `weekday` keeps the spelled-out day name
 * as a prefix (e.g. "Rabu, 08/07/2026"); `time` appends 24h HH:mm.
 *
 * Malay (`ms-MY`) locale is used for the weekday name to match the rest of the
 * UI; the numeric date is built by hand from the parts so it is always
 * dd/mm/yyyy regardless of what a given browser's locale default would produce.
 */
export const formatDate = (
  iso: string | number | Date | null | undefined,
  // `seconds` (CMS only) switches the time to 12-hour h:mm:ss AM/PM; `timeOnly` drops the date.
  opts: { weekday?: boolean; time?: boolean; seconds?: boolean; timeOnly?: boolean } = {},
): string => {
  if (iso == null || iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  let out = date;
  if (opts.weekday) {
    const wd = d.toLocaleDateString('ms-MY', { weekday: 'long' });
    out = `${wd}, ${date}`;
  }
  if (opts.seconds || opts.timeOnly) {
    const h = d.getHours();
    const clock = `${((h + 11) % 12) + 1}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${h < 12 ? 'AM' : 'PM'}`;
    return opts.timeOnly ? clock : `${out} ${clock}`;
  }
  if (opts.time) {
    out += ` ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  return out;
};

export const fmt = (iso: string): string => formatDate(iso, { time: true });

export const p2 = (n: number): string => String(n).padStart(2, '0');

/** Inclusive [from, to] rank range for a prize, falling back to its single rank. */
export const prizeRange = (p: Prize): [number, number] => {
  const from = p.rankFrom ?? p.rank;
  const to = p.rankTo ?? p.rank;
  return from <= to ? [from, to] : [to, from];
};

export const getPrize = (rank: number, prizes: Prize[]): string => {
  for (const p of prizes) {
    const [from, to] = prizeRange(p);
    if (rank >= from && rank <= to) return p.prize;
  }
  return '';
};

export const getPrizeLabel = (rank: number, prizes: Prize[]): string => {
  for (const p of prizes) {
    const [from, to] = prizeRange(p);
    if (rank >= from && rank <= to) return p.label || p.prize;
  }
  return '';
};

/**
 * Competition ranking over entries already sorted best-first. Every record is its
 * own entry (a peg may appear many times). Records with the same ranked weight AND
 * the same capture minute tie: they share a rank, the next rank skips ahead
 * (1, 2, 2, 4), and `tieCount` says how many share it so the prize can be split.
 */
export const assignTieRanks = <T extends { rankWeight: number; capturedAt?: unknown }>(sorted: T[]): (T & { rank: number; tieCount: number })[] => {
  const minuteOf = (e: T) => Math.floor(scoreTime(e.capturedAt) / 60000);
  const out: (T & { rank: number; tieCount: number })[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].rankWeight === sorted[i].rankWeight && minuteOf(sorted[j]) === minuteOf(sorted[i])) j++;
    for (let k = i; k < j; k++) out.push({ ...sorted[k], rank: i + 1, tieCount: j - i });
    i = j;
  }
  return out;
};

/** True when a weigh-in is inside the competition's leaderboard weight limits (records outside stay saved, just unranked). */
export const isWeightRankable = (weight: unknown, comp?: { minWeightKg?: number | null; maxWeightKg?: number | null } | null): boolean => {
  const w = Number(weight);
  if (!Number.isFinite(w)) return false;
  const { minWeightKg: min, maxWeightKg: max } = comp || {};
  if (typeof min === 'number' && min > 0 && w < min) return false;
  if (typeof max === 'number' && max > 0 && w > max) return false;
  return true;
};

const parseRM =(s: string): number | null => {
  const m = s.match(/^\s*RM\s*([\d,]+(?:\.\d+)?)\s*$/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

/** Prize for a (possibly tied) rank. Tied entries split the combined prizes of the places they occupy. */
export const getSharedPrize = (rank: number, tieCount: number, prizes: Prize[]): string => {
  if (tieCount <= 1) return getPrize(rank, prizes);
  let total = 0;
  let any = false;
  for (let pos = rank; pos < rank + tieCount; pos++) {
    const p = getPrize(pos, prizes);
    if (!p) continue;
    const amount = parseRM(p);
    if (amount == null) return getPrize(rank, prizes) ? `${getPrize(rank, prizes)} (dikongsi)` : '';
    total += amount;
    any = true;
  }
  if (!any) return '';
  const share = total / tieCount;
  return `RM ${share.toLocaleString('en-MY', { maximumFractionDigits: 2 })} (dikongsi ${tieCount})`;
};

export const rbc = (r: number): string => r === 1 ? 'r1' : r === 2 ? 'r2' : r === 3 ? 'r3' : 'rn';

export const rbg = (r: number): string => r === 1 ? 'rgba(255,215,0,.15)' : r === 2 ? 'rgba(192,192,192,.15)' : r === 3 ? 'rgba(205,127,50,.15)' : 'var(--surface2)';

export const rbc2 = (r: number): string => r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? '#cd7f32' : 'var(--muted)';

export const scoreTime = (value?: unknown): number => {
  if (!value) return 0;
  if (typeof (value as any)?.toMillis === 'function') {
    const ms = (value as any).toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof (value as any)?.toDate === 'function') {
    const ms = (value as any).toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof (value as any)?.seconds === 'number') {
    return (value as any).seconds * 1000 + Math.floor(((value as any).nanoseconds || 0) / 1000000);
  }
  const ms = new Date(value as string | number | Date).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

export const getLB = (scores: Record<number, Score>, pondFilter?: number | null): { peg: number; name: string; weight: number; rankWeight: number; pondId: number; pondName: string; capturedAt?: unknown }[] => {
  const e: { peg: number; name: string; weight: number; rankWeight: number; pondId: number; pondName: string; capturedAt?: unknown }[] = [];
  for (const [peg, d] of Object.entries(scores)) {
    if (d.weight == null || isNaN(parseFloat(d.weight.toString()))) continue;
    const weight = parseFloat(d.weight.toString());
    const rankWeight = Number.isFinite(d.rankWeight) ? Number(d.rankWeight) : weight;
    e.push({ peg: parseInt(peg), name: d.anglerName || 'Angler #' + peg, weight, rankWeight, pondId: d.pondId, pondName: d.pondName, capturedAt: d.capturedAt });
  }
  return e.sort((a, b) => (b.rankWeight - a.rankWeight) || (scoreTime(b.capturedAt) - scoreTime(a.capturedAt)));
};
