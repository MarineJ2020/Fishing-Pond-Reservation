import { Pond } from '../types';

/**
 * Display name for a pond, falling back to "Kolam <code>" when the name is blank.
 * Keeps the UI sensible for ponds created without an explicit name.
 */
export function pondDisplayName(pond?: Pick<Pond, 'name' | 'code'> | null): string {
  if (!pond) return '';
  const name = pond.name?.trim();
  if (name) return name;
  return pond.code ? `Kolam ${pond.code}` : 'Kolam';
}

/**
 * Peg numbers are plain, globally unique numbers (a pond owns a range such as
 * 501–1000). The first argument is the legacy pond letter and is ignored; it is
 * kept so existing call sites keep working.
 */
export function formatSeat(_code: string | undefined | null, num: number): string {
  return `${num}`;
}

/** Format a list of seat numbers for a pond, e.g. "1, 23, 125". */
export function formatSeatList(code: string | undefined | null, nums: number[]): string {
  return nums.map((n) => formatSeat(code, n)).join(', ');
}

/**
 * Pond peg-range helpers. Pegs are numbered left side top to bottom first, then the
 * right side top to bottom. Defaults match ponds created before ranges existed (1..N, half/half).
 */
export function pondRange(pond: Pick<Pond, 'startNumber' | 'maxSeats' | 'seats' | 'leftCount'>) {
  const start = Number.isInteger(pond.startNumber) && (pond.startNumber as number) >= 1 ? (pond.startNumber as number) : 1;
  const total = pond.maxSeats ?? pond.seats?.length ?? 0;
  const left = Number.isInteger(pond.leftCount) ? Math.max(0, Math.min(total, pond.leftCount as number)) : Math.ceil(total / 2);
  return { start, total, end: start + total - 1, left, right: total - left };
}

/**
 * Consecutive numbering: the first pond (in display order) sets the base number and every
 * following pond starts right after the previous one, so ranges can never overlap and
 * changing one pond's count shifts the ponds after it automatically.
 */
export function chainStarts(ponds: Array<Pick<Pond, 'startNumber' | 'maxSeats' | 'seats' | 'leftCount'>>): number[] {
  let next = 1;
  return ponds.map((p, i) => {
    const r = pondRange(p);
    const start = i === 0 ? r.start : next;
    next = start + r.total;
    return start;
  });
}
