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
