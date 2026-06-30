import { Competition } from '../types';

export type CompetitionPhase = 'upcoming' | 'live' | 'ended';

/**
 * Date-derived lifecycle phase of a competition. A competition is "ended"
 * ("tamat") once its end date (or start date, when no end date is set) has
 * passed. Shared by the CMS status badges and the public booking flow so both
 * agree on when bookings should be closed.
 */
export function getCompetitionPhase(competition: Partial<Competition> | null | undefined): CompetitionPhase {
  if (!competition) return 'upcoming';
  const now = Date.now();
  const start = competition.startDate ? new Date(competition.startDate).getTime() : NaN;
  const end = competition.endDate
    ? new Date(competition.endDate).getTime()
    : (competition.startDate ? new Date(competition.startDate).getTime() : NaN);

  if (Number.isNaN(start)) return 'upcoming';
  if (!Number.isNaN(end) && now >= end) return 'ended';
  if (now < start) return 'upcoming';
  return 'live';
}

/** True when the competition has ended ("tamat") and should accept no new bookings. */
export function isCompetitionEnded(competition: Partial<Competition> | null | undefined): boolean {
  return getCompetitionPhase(competition) === 'ended';
}

export type BookingWindowState = 'none' | 'before' | 'open' | 'after';

/**
 * State of a competition's booking ("tempahan") window relative to `now`.
 * - `none`  — no window configured → treat booking as open (until the event ends).
 * - `before`— the booking-open date is still in the future (sale not started).
 * - `open`  — within the window.
 * - `after` — past the booking-close date (close date is inclusive — end of day).
 * Date-only inputs are stored at start/end of day by the CMS, so comparisons are inclusive.
 */
export function getBookingWindowState(
  competition: Partial<Competition> | null | undefined,
  now: number = Date.now(),
): BookingWindowState {
  if (!competition) return 'none';
  const open = competition.bookingOpenAt ? new Date(competition.bookingOpenAt).getTime() : NaN;
  const close = competition.bookingCloseAt ? new Date(competition.bookingCloseAt).getTime() : NaN;
  if (Number.isNaN(open) && Number.isNaN(close)) return 'none';
  if (!Number.isNaN(open) && now < open) return 'before';
  if (!Number.isNaN(close) && now > close) return 'after';
  return 'open';
}

/** True when the booking window currently accepts bookings (or no window is set). */
export function isBookingOpen(
  competition: Partial<Competition> | null | undefined,
  now: number = Date.now(),
): boolean {
  const state = getBookingWindowState(competition, now);
  return state === 'open' || state === 'none';
}

/** Malay message describing why booking is unavailable, or '' when it is open. */
export function bookingWindowLabel(
  competition: Partial<Competition> | null | undefined,
  now: number = Date.now(),
): string {
  const state = getBookingWindowState(competition, now);
  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  if (state === 'before') return `Tempahan dibuka pada ${fmt(competition?.bookingOpenAt)}`;
  if (state === 'after') return 'Tempahan telah ditutup';
  return '';
}
