import { Booking } from '../types';

/**
 * Outstanding (unpaid) balance for a booking. Only deposit bookings can carry a
 * balance; full-payment and rejected bookings always return 0. `baki` is the
 * staff-assisted continuation of a deposit booking. Derived from the accepted
 * receipt total vs. the full price.
 */
export function outstandingBalance(b: Booking): number {
  if (!['deposit', 'baki'].includes(b.paymentType) || b.status === 'rejected') return 0;
  const total = b.totalAmount ?? b.amount ?? 0;
  const paid = typeof b.paidAmount === 'number'
    ? b.paidAmount
    : (b.receipts?.length
        ? b.receipts.filter((r) => r.status === 'accepted').reduce((s, r) => s + r.amount, 0)
        : (b.status === 'confirmed' && b.receiptData ? b.amount : 0));
  return Math.max(0, total - paid);
}

export interface BookingSeatEntry {
  key: string;
  pondId: number;
  pondName: string;
  pondCode?: string;
  pondDate?: string;
  seatNum: number;
  seatId?: string;
}

/** Stable identity for one peg inside a potentially multi-pond booking. */
export function bookingSeatKey(pondId: number, seatNum: number): string {
  return `${pondId}:${seatNum}`;
}

/**
 * Flatten every pond selection into display/check-in rows. Legacy bookings
 * without `pondSelections` fall back to their original primary pond fields.
 */
export function bookingSeatEntries(b: Booking): BookingSeatEntry[] {
  const selections = b.pondSelections?.length
    ? b.pondSelections
    : [{
        pondId: b.pondId,
        pondName: b.pondName,
        pondCode: b.pondCode,
        pondDate: b.pondDate,
        seats: b.seats || [],
        seatIds: b.seatIds,
      }];

  const seen = new Set<string>();
  const entries: BookingSeatEntry[] = [];
  selections.forEach((selection) => {
    selection.seats.forEach((seatNum, index) => {
      const key = bookingSeatKey(selection.pondId, seatNum);
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        key,
        pondId: selection.pondId,
        pondName: selection.pondName,
        pondCode: selection.pondCode,
        pondDate: selection.pondDate,
        seatNum,
        seatId: selection.seatIds?.[index],
      });
    });
  });
  return entries;
}

/** New bookings use seat keys; numeric seats remain a legacy fallback. */
export function isBookingSeatCheckedIn(b: Booking, entry: BookingSeatEntry): boolean {
  if (b.checkedInSeatKeys?.length) return b.checkedInSeatKeys.includes(entry.key);
  return !!b.checkedInSeats?.includes(entry.seatNum);
}

/** Resolve the per-seat time while supporting legacy numeric time keys. */
export function bookingSeatCheckInTime(b: Booking, entry: BookingSeatEntry): string {
  return b.checkedInSeatTimes?.[entry.key]
    || b.checkedInSeatTimes?.[String(entry.seatNum)]
    || (isBookingSeatCheckedIn(b, entry) ? b.checkedInAt || '' : '');
}

/** True when a booking still has money owing. */
export function hasOutstandingBalance(b: Booking): boolean {
  return outstandingBalance(b) > 0;
}

/** Count of the user's bookings that still owe a balance — drives the red dot. */
export function countOutstanding(bookings: Booking[]): number {
  return bookings.filter(hasOutstandingBalance).length;
}

/** Days after a deposit receipt before the user is auto-reminded about the balance. */
export const BALANCE_REMINDER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the deposit (first) receipt was submitted — the anchor for "how long has
 * this booking been waiting for the balance". Falls back to the booking creation
 * time for legacy single-receipt bookings that have no receipts array.
 */
function depositSubmittedAt(b: Booking): string {
  return b.receipts?.[0]?.submittedAt || b.createdAt;
}

export interface BalanceReminderInfo {
  /** True when this booking is a deposit still owing money with nothing pending review. */
  awaitingBalance: boolean;
  depositSubmittedAt: string;
  daysSinceDeposit: number;
  /** When the next automatic reminder is due. */
  nextRemindAt: Date;
  /** Milliseconds until the next auto-reminder (negative = overdue). */
  msUntilRemind: number;
}

/**
 * Reminder/aging info for a deposit booking awaiting its balance receipt. Shared
 * by the CMS counters and the "send reminder now" action so they agree on timing.
 * The auto-remind clock is anchored on the later of the deposit submission and the
 * last reminder sent, so "send now" pushes the next auto-reminder another 7 days out.
 */
export function balanceReminderInfo(b: Booking, now: number = Date.now()): BalanceReminderInfo {
  const submitted = depositSubmittedAt(b);
  const submittedMs = new Date(submitted).getTime();
  const lastReminderMs = b.balanceReminderSentAt ? new Date(b.balanceReminderSentAt).getTime() : 0;
  const anchorMs = Math.max(submittedMs || 0, lastReminderMs);
  const nextRemindMs = anchorMs + BALANCE_REMINDER_DAYS * DAY_MS;

  // "Awaiting balance" = still owes money and the ball is in the user's court
  // (no receipt currently pending staff review).
  const hasPendingReceipt = (b.receipts || []).some((r) => r.status === 'pending');
  const awaitingBalance = hasOutstandingBalance(b) && !hasPendingReceipt;

  return {
    awaitingBalance,
    depositSubmittedAt: submitted,
    daysSinceDeposit: Math.max(0, Math.floor((now - (submittedMs || now)) / DAY_MS)),
    nextRemindAt: new Date(nextRemindMs),
    msUntilRemind: nextRemindMs - now,
  };
}
