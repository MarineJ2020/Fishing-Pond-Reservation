import type { Booking, Competition } from '../types';
import { cancelledKeptAmount, isRefundPending } from './cancellation';

export type DashboardRange = 'all' | 'today' | '7d' | '30d' | '90d' | 'custom';

export interface DashboardFilter {
  /** '' = every competition. */
  competitionId: string;
  range: DashboardRange;
  /** YYYY-MM-DD (local), used when range === 'custom'. */
  from?: string;
  to?: string;
}

export interface CompetitionSummary {
  competitionId: string;
  name: string;
  startDate?: string;
  total: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  /** Pegs held by confirmed bookings. */
  pegs: number;
  revenue: number;
}

export interface DashboardStats {
  total: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  /** Money collected on confirmed bookings, plus money kept from cancellations (no-show forfeits, partial refunds). */
  revenue: number;
  /** Part of `revenue` kept from cancelled bookings. */
  keptFromCancelled: number;
  /** Refund cancellations still waiting for staff to pay back. */
  refundPending: number;
  refundPendingValue: number;
  /** Value of bookings still awaiting approval. */
  pendingValue: number;
  recent: Booking[];
  byCompetition: CompetitionSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** [start, end) in epoch ms for the selected range; null bounds are open. */
export const dashboardRangeBounds = (filter: DashboardFilter, now = new Date()): [number | null, number | null] => {
  const today = startOfLocalDay(now);
  switch (filter.range) {
    case 'today': return [today, today + DAY_MS];
    case '7d': return [today - 6 * DAY_MS, today + DAY_MS];
    case '30d': return [today - 29 * DAY_MS, today + DAY_MS];
    case '90d': return [today - 89 * DAY_MS, today + DAY_MS];
    case 'custom': {
      const parse = (value?: string) => {
        if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const [y, m, d] = value.split('-').map(Number);
        return new Date(y, m - 1, d).getTime();
      };
      const from = parse(filter.from);
      const to = parse(filter.to);
      return [from, to === null ? null : to + DAY_MS];
    }
    default: return [null, null];
  }
};

export const bookingPegCount = (booking: Booking) => (booking.pondSelections?.length
  ? booking.pondSelections.reduce((sum, selection) => sum + (selection.seats?.length || 0), 0)
  : (booking.seats?.length || 0));

/** Collected amount: accepted payments when recorded, else the booking amount (legacy). */
export const bookingCollected = (booking: Booking) => {
  if (booking.status !== 'confirmed') return 0;
  const paid = Number(booking.paidAmount);
  return Number.isFinite(paid) && paid > 0 ? paid : (Number(booking.amount) || 0);
};

const createdMs = (booking: Booking) => {
  const ms = Date.parse(booking.createdAt || '');
  return Number.isFinite(ms) ? ms : null;
};

export function buildDashboardStats(
  bookings: Booking[],
  competitions: Competition[],
  filter: DashboardFilter,
  now = new Date(),
): DashboardStats {
  const [start, end] = dashboardRangeBounds(filter, now);
  const filtered = bookings.filter((booking) => {
    if (filter.competitionId && (booking.competitionId || '') !== filter.competitionId) return false;
    if (start === null && end === null) return true;
    const ms = createdMs(booking);
    if (ms === null) return false;
    return (start === null || ms >= start) && (end === null || ms < end);
  });

  const competitionById = new Map(competitions.filter((c) => c.id).map((c) => [c.id as string, c]));
  const summaries = new Map<string, CompetitionSummary>();
  const stats: DashboardStats = { total: 0, confirmed: 0, pending: 0, cancelled: 0, revenue: 0, keptFromCancelled: 0, refundPending: 0, refundPendingValue: 0, pendingValue: 0, recent: [], byCompetition: [] };

  filtered.forEach((booking) => {
    const key = booking.competitionId || '';
    const competition = competitionById.get(key);
    const summary = summaries.get(key) || {
      competitionId: key,
      name: competition?.name || booking.competitionName || 'Tanpa pertandingan',
      startDate: competition?.startDate,
      total: 0, confirmed: 0, pending: 0, cancelled: 0, pegs: 0, revenue: 0,
    };
    summary.total += 1;
    stats.total += 1;
    if (booking.status === 'confirmed') {
      const collected = bookingCollected(booking);
      summary.confirmed += 1;
      summary.pegs += bookingPegCount(booking);
      summary.revenue += collected;
      stats.confirmed += 1;
      stats.revenue += collected;
    } else if (booking.status === 'pending') {
      summary.pending += 1;
      stats.pending += 1;
      stats.pendingValue += Number(booking.totalAmount ?? booking.amount) || 0;
    } else {
      const kept = cancelledKeptAmount(booking);
      summary.cancelled += 1;
      summary.revenue += kept;
      stats.cancelled += 1;
      stats.revenue += kept;
      stats.keptFromCancelled += kept;
      if (isRefundPending(booking)) {
        stats.refundPending += 1;
        stats.refundPendingValue += Number(booking.refundAmount) || 0;
      }
    }
    summaries.set(key, summary);
  });

  stats.recent = [...filtered]
    .sort((a, b) => (createdMs(b) ?? 0) - (createdMs(a) ?? 0))
    .slice(0, 8);
  stats.byCompetition = [...summaries.values()].sort((a, b) =>
    (Date.parse(b.startDate || '') || 0) - (Date.parse(a.startDate || '') || 0) || b.total - a.total);
  return stats;
}
