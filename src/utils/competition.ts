import { Competition } from '../types';
import { formatDate } from '../utils';

export type CompetitionPhase = 'upcoming' | 'live' | 'ended';

/**
 * Date-derived lifecycle phase of a competition. A competition is "ended"
 * ("tamat") once its end date (or start date, when no end date is set) has
 * passed. Shared by the CMS status badges and the public booking flow so both
 * agree on when bookings should be closed.
 */
export function getCompetitionPhase(competition: Partial<Competition> | null | undefined, now: number = Date.now()): CompetitionPhase {
  if (!competition) return 'upcoming';
  const start = competition.startDate ? new Date(competition.startDate).getTime() : NaN;
  const end = competition.endDate
    ? new Date(competition.endDate).getTime()
    : (competition.startDate ? new Date(competition.startDate).getTime() : NaN);

  if (!Number.isNaN(end) && now >= end) return 'ended';
  if (Number.isNaN(start)) return 'upcoming';
  if (now < start) return 'upcoming';
  return 'live';
}

/** True when the competition has ended ("tamat") and should accept no new bookings. */
export function isCompetitionEnded(competition: Partial<Competition> | null | undefined, now: number = Date.now()): boolean {
  return getCompetitionPhase(competition, now) === 'ended';
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

export type CompetitionCmsStatus = 'tamat' | 'active' | 'coming-soon';

/**
 * CMS "Pertandingan" table status — fully date-derived, no manual toggle.
 * - `tamat`       — competition has ended.
 * - `active`      — booking has opened and the competition has not ended.
 * - `coming-soon` — created, but the booking-open date hasn't arrived yet.
 */
export function getCompetitionCmsStatus(
  competition: Partial<Competition> | null | undefined,
  now: number = Date.now(),
): CompetitionCmsStatus {
  const phase = getCompetitionPhase(competition, now);
  if (phase === 'ended') return 'tamat';
  const windowState = getBookingWindowState(competition, now);
  if (windowState === 'before') return 'coming-soon';
  return 'active';
}

const CMS_STATUS_META: Record<CompetitionCmsStatus, { label: string; badgeClass: string }> = {
  tamat: { label: 'Tamat', badgeClass: 'badge-completed' },
  active: { label: 'Aktif', badgeClass: 'badge-open' },
  'coming-soon': { label: 'Coming soon', badgeClass: 'badge-draft' },
};

export function getCompetitionCmsStatusMeta(
  competition: Partial<Competition> | null | undefined,
  now: number = Date.now(),
): { label: string; badgeClass: string } {
  return CMS_STATUS_META[getCompetitionCmsStatus(competition, now)];
}

/** Malay message describing why booking is unavailable, or '' when it is open. */
export function bookingWindowLabel(
  competition: Partial<Competition> | null | undefined,
  now: number = Date.now(),
): string {
  const state = getBookingWindowState(competition, now);
  if (state === 'before') return `Tempahan dibuka pada ${formatDate(competition?.bookingOpenAt, { time: true })}`;
  if (state === 'after') return 'Tempahan telah ditutup';
  return '';
}

/** Newest scheduled start first; preserve input order for ties and invalid dates. */
export function sortCompetitionsLatestFirst(competitions: Competition[]): Competition[] {
  const startTime = (competition: Competition) => {
    const time = new Date(competition.startDate).getTime();
    return Number.isFinite(time) ? time : -Infinity;
  };
  return [...competitions].sort((a, b) => {
    const left = startTime(a);
    const right = startTime(b);
    return left === right ? 0 : left > right ? -1 : 1;
  });
}
