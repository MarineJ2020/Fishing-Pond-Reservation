import { DB, Score, Prize } from './types';

export const fmt = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) +
         ' ' + d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
};

export const p2 = (n: number): string => String(n).padStart(2, '0');

export const getPrize = (rank: number, prizes: Prize[]): string => {
  let m = '';
  for (const p of prizes) {
    if (rank >= p.rank) m = p.prize;
  }
  return m;
};

export const getPrizeLabel = (rank: number, prizes: Prize[]): string => {
  let m = '';
  for (const p of prizes) {
    if (rank >= p.rank) m = p.label || p.prize;
  }
  return m;
};

export const rbc = (r: number): string => r === 1 ? 'r1' : r === 2 ? 'r2' : r === 3 ? 'r3' : 'rn';

export const rbg = (r: number): string => r === 1 ? 'rgba(255,215,0,.15)' : r === 2 ? 'rgba(192,192,192,.15)' : r === 3 ? 'rgba(205,127,50,.15)' : 'var(--surface2)';

export const rbc2 = (r: number): string => r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? '#cd7f32' : 'var(--muted)';

export const getLB = (scores: Record<number, Score>, pondFilter?: number | null): { peg: number; name: string; weight: number; pondId: number }[] => {
  const e: { peg: number; name: string; weight: number; pondId: number }[] = [];
  for (const [peg, d] of Object.entries(scores)) {
    if (pondFilter && pondFilter !== null && d.pondId !== pondFilter) continue;
    if (d.weight == null || d.weight === '' || isNaN(parseFloat(d.weight.toString()))) continue;
    e.push({ peg: parseInt(peg), name: d.anglerName || 'Angler #' + peg, weight: parseFloat(d.weight.toString()), pondId: d.pondId });
  }
  return e.sort((a, b) => b.weight - a.weight);
};