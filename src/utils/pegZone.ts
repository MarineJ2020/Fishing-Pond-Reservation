import { Pond } from '../types';
import { pondRange } from './seatLabel';

/**
 * Peg numbers are globally unique and every pond owns one range (start..end), the left
 * side numbered first (leftCount pegs) then the right side. Each side is a zone, so a
 * peg's zone is derived from its number — bookings never store it. The ranges are
 * registered from the loaded ponds (BookingContext) so every booking view can label
 * "123 (Zon A)" without threading ponds through each component.
 */
type ZoneRange = { start: number; end: number; left: number; leftZone: 'A' | 'B' };
let ranges: ZoneRange[] = [];

export function setPegZones(ponds: Pond[]): void {
  ranges = (ponds || []).map((pond) => {
    const r = pondRange(pond);
    return { start: r.start, end: r.end, left: r.left, leftZone: (pond.leftZone === 'B' ? 'B' : 'A') as 'A' | 'B' };
  });
}

export function pegZone(num: number): 'A' | 'B' | null {
  const range = ranges.find((r) => num >= r.start && num <= r.end);
  if (!range) return null;
  const onLeft = num - range.start < range.left;
  return onLeft ? range.leftZone : (range.leftZone === 'A' ? 'B' : 'A');
}

/** "123 (Zon A)", or just "123" when the peg isn't inside any known pond range. */
export function formatPeg(num: number): string {
  const zone = pegZone(num);
  return zone ? `${num} (Zon ${zone})` : `${num}`;
}

export function formatPegList(nums: number[]): string {
  return nums.map(formatPeg).join(', ');
}
