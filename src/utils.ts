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
  opts: { weekday?: boolean; time?: boolean } = {},
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

export const rbc = (r: number): string => r === 1 ? 'r1' : r === 2 ? 'r2' : r === 3 ? 'r3' : 'rn';

export const rbg = (r: number): string => r === 1 ? 'rgba(255,215,0,.15)' : r === 2 ? 'rgba(192,192,192,.15)' : r === 3 ? 'rgba(205,127,50,.15)' : 'var(--surface2)';

export const rbc2 = (r: number): string => r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? '#cd7f32' : 'var(--muted)';

export const getLB = (scores: Record<number, Score>, pondFilter?: number | null): { peg: number; name: string; weight: number; pondId: number }[] => {
  const e: { peg: number; name: string; weight: number; pondId: number }[] = [];
  for (const [peg, d] of Object.entries(scores)) {
    if (d.weight == null || d.weight === '' || isNaN(parseFloat(d.weight.toString()))) continue;
    e.push({ peg: parseInt(peg), name: d.anglerName || 'Angler #' + peg, weight: parseFloat(d.weight.toString()), pondId: d.pondId });
  }
  return e.sort((a, b) => b.weight - a.weight);
};