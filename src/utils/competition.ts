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
