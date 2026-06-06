import { Booking } from '../types';

/**
 * Outstanding (unpaid) balance for a booking. Only deposit bookings can carry a
 * balance; full-payment and rejected bookings always return 0. Derived from the
 * accepted-receipt total vs. the full price.
 */
export function outstandingBalance(b: Booking): number {
  if (b.paymentType !== 'deposit' || b.status === 'rejected') return 0;
  const total = b.totalAmount || 0;
  const paid = typeof b.paidAmount === 'number'
    ? b.paidAmount
    : (b.receipts || []).filter((r) => r.status === 'accepted').reduce((s, r) => s + r.amount, 0);
  return Math.max(0, total - paid);
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
