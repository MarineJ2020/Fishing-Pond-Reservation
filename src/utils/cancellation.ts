import type { Booking } from '../types';

// How a confirmed booking was force-cancelled and what happened to the money.
// Written by CMS > Batal Paksa; read by the dashboard, CMS lists and the
// customer's booking page so all three tell the same story.
export type CancelType = 'no_show_forfeit' | 'refund' | 'no_payment';

export const CANCEL_TYPE_OPTIONS: { value: CancelType; label: string; hint: string }[] = [
  { value: 'no_show_forfeit', label: 'Tidak hadir – bayaran hangus', hint: 'Peserta tidak hadir pada hari pertandingan. Bayaran disimpan dan dikira sebagai hasil.' },
  { value: 'refund', label: 'Batal – bayaran dikembalikan', hint: 'Bayaran akan dipulangkan. Ditanda "bayaran balik tertunggak" sehingga petugas rekod bayaran balik.' },
  { value: 'no_payment', label: 'Batal – tiada bayaran', hint: 'Tiada bayaran sebenar diterima (silap / tempahan berganda). Tiada hasil dikira.' },
];

/** Amount the customer actually paid on this booking (any status). */
export const bookingPaidAmount = (booking: Booking): number => {
  const paid = Number(booking.paidAmount);
  return Number.isFinite(paid) && paid > 0 ? paid : (Number(booking.amount) || 0);
};

/** Money kept from a cancelled booking: forfeits in full, refunds only the unrefunded part once refunded. */
export const cancelledKeptAmount = (booking: Booking): number => {
  if (booking.status !== 'rejected') return 0;
  if (booking.cancelType === 'no_show_forfeit') return Math.max(0, Number(booking.forfeitedAmount ?? bookingPaidAmount(booking)) || 0);
  if (booking.cancelType === 'refund' && booking.refundStatus === 'refunded') {
    return Math.max(0, bookingPaidAmount(booking) - (Number(booking.refundAmount) || 0));
  }
  return 0;
};

export const isRefundPending = (booking: Booking): boolean =>
  booking.status === 'rejected' && booking.cancelType === 'refund' && booking.refundStatus !== 'refunded';

const rm = (value: number | undefined) => `RM ${(Number(value) || 0).toFixed(2)}`;

/** Short CMS label under the "Dibatalkan" badge; '' for plain cancellations. */
export const cancelMoneyLabel = (booking: Booking): string => {
  if (booking.status !== 'rejected') return '';
  if (booking.cancelType === 'no_show_forfeit') return `Tidak hadir · hangus ${rm(booking.forfeitedAmount ?? bookingPaidAmount(booking))}`;
  if (booking.cancelType === 'refund') {
    return booking.refundStatus === 'refunded'
      ? `Dikembalikan ${rm(booking.refundAmount)}`
      : `Bayaran balik tertunggak ${rm(booking.refundAmount)}`;
  }
  if (booking.cancelType === 'no_payment') return 'Tiada bayaran';
  return '';
};
