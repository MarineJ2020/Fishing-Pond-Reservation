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
 * Format a single seat as "<code>-<num>" with no zero padding, e.g. "A-23".
 * Falls back to the plain number when the pond has no alphabet code yet
 * (e.g. legacy ponds before a code is assigned in the CMS).
 */
export function formatSeat(code: string | undefined | null, num: number): string {
  const c = (code || '').trim().toUpperCase();
  return c ? `${c}-${num}` : `${num}`;
}

/** Format a list of seat numbers for a pond, e.g. "A-1, A-23, A-125". */
export function formatSeatList(code: string | undefined | null, nums: number[]): string {
  return nums.map((n) => formatSeat(code, n)).join(', ');
}
