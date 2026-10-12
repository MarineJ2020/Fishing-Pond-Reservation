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

/** Pond peg-range helpers. Defaults match ponds created before ranges existed (1..N, half/half). */
export function pondRange(pond: Pick<Pond, 'startNumber' | 'maxSeats' | 'seats' | 'zoneACount'>) {
  const start = Number.isInteger(pond.startNumber) && (pond.startNumber as number) >= 1 ? (pond.startNumber as number) : 1;
  const total = pond.maxSeats ?? pond.seats?.length ?? 0;
  const zoneA = Number.isInteger(pond.zoneACount) ? Math.max(0, Math.min(total, pond.zoneACount as number)) : Math.ceil(total / 2);
  return { start, total, end: start + total - 1, zoneA, zoneB: total - zoneA };
}

/** Returns an error message when `candidate`'s peg range overlaps another pond's range. */
export function pegRangeOverlapError(
  candidate: { start: number; total: number },
  others: Array<Pick<Pond, 'name' | 'startNumber' | 'maxSeats' | 'seats' | 'zoneACount'>>,
): string | null {
  const end = candidate.start + candidate.total - 1;
  for (const other of others) {
    const r = pondRange(other);
    if (candidate.start <= r.end && r.start <= end) {
      return `Nombor pancang ${candidate.start}–${end} bertindih dengan ${other.name || 'kolam lain'} (${r.start}–${r.end}). Nombor tidak boleh berulang.`;
    }
  }
  return null;
}
