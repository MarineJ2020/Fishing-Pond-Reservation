import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Booking } from '../types';
import { outstandingBalance } from '../utils/booking';
import BalanceReceiptUpload from './BalanceReceiptUpload';
import ReceiptReupload from './ReceiptReupload';

interface Props {
  booking: Booking;
  /** When true, hides the close button (rendered as a page, not a modal). */
  inPage?: boolean;
  onClose?: () => void;
  /**
   * When provided, the booking owner can upload a balance receipt (deposit
   * bookings with an outstanding balance). Called after a successful submit so
   * the parent can refresh the booking from Firestore.
   */
  onReceiptSubmitted?: () => void | Promise<void>;
}

const RECEIPT_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: 'Menunggu Pengesahan', color: 'var(--gold)' },
  accepted: { label: 'Disahkan', color: 'var(--green-bright, #16a34a)' },
  rejected: { label: 'Ditolak', color: 'var(--red)' },
};

/**
 * Build the QR payload for a booking. The QR encodes the booking-detail URL
 * (origin + /bookings/:id) so:
 *   - Any QR reader (including a phone camera) opens the booking page directly.
 *   - The CMS Imbas-Timbangan scanner parses the URL to identify the booking,
 *     then prompts staff to pick which seat is being weighed if the booking
 *     has more than one peg.
 */
export function buildBookingUrl(bookingId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/bookings/${encodeURIComponent(bookingId)}`;
}

/** @deprecated Kept for any external callers; new code should use buildBookingUrl. */
export function buildBookingSeatUrl(bookingId: string, _seatNum: number): string {
  return buildBookingUrl(bookingId);
}

const BookingDetailContent: React.FC<Props> = ({ booking, inPage, onClose, onReceiptSubmitted }) => {
  const receipts = booking.receipts && booking.receipts.length
    ? booking.receipts
    : (booking.receiptData ? [{ url: booking.receiptData, amount: booking.amount, status: 'pending' as const, submittedAt: booking.createdAt }] : []);
  const balanceDue = outstandingBalance(booking);
  const canSubmitBalance = !!onReceiptSubmitted
    && booking.paymentType === 'deposit'
    && balanceDue > 0
    && booking.status !== 'rejected'
    && receipts.length < 3;

  // One-time receipt correction: allowed on a still-pending receipt that hasn't
  // been re-uploaded yet, while the booking is still under review.
  const firstPendingReceiptIdx = receipts.findIndex((r) => r.status === 'pending');
  const canReuploadReceipt = !!onReceiptSubmitted
    && booking.status !== 'rejected'
    && !booking.receiptReuploadUsed
    && firstPendingReceiptIdx >= 0;
  return (
    <div
      style={{
        padding: inPage ? '32px 24px' : '28px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxHeight: inPage ? undefined : 'calc(92vh - 96px)',
        overflowY: inPage ? undefined : 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      {/* Booking ID & Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Booking ID</div>
          <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--red)' }}>{booking.id}</div>
        </div>
        <div>
          <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Status</div>
          <span className={`status-badge st-${booking.status}`}>
            {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
          </span>
        </div>
      </div>

      {/* One QR per booking — staff scans, then picks which peg is being weighed */}
      <div style={{ background: '#fff', border: '2px solid var(--red)', padding: '18px', borderRadius: '14px' }}>
        <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 700 }}>
          QR Tempahan
        </div>
        <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
          Tunjukkan QR ini kepada petugas semasa proses timbang ikan. Petugas akan pilih nombor peg
          yang sedang ditimbang selepas mengimbas.
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: '14px',
              borderRadius: '10px',
              border: '1px solid var(--line)',
            }}
          >
            <QRCodeSVG
              value={buildBookingUrl(booking.id)}
              size={220}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#112a41"
            />
          </div>
          <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--navy)' }}>
            {booking.pondName}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>Sah untuk peg:</span>
            {booking.seats.map((s) => (
              <span key={s} className="seat-pill">#{s}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Angler Info */}
      <div style={{ background: 'var(--cream)', padding: '18px', borderRadius: '14px', border: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>Pemancing</div>
          {booking.createdByStaff && (
            <span style={{ fontSize: '.68rem', background: 'rgba(250,204,21,0.18)', color: 'var(--red)', border: '1px solid rgba(250,204,21,0.35)', borderRadius: '5px', padding: '2px 7px', fontWeight: 700, letterSpacing: '0.5px' }}>
              🛠 Dibuat oleh Admin
            </span>
          )}
        </div>
        <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '6px', fontFamily: 'var(--font-heading)' }}>{booking.userName}</div>
        <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <span>📧 {booking.userId}</span>
          <span>📱 {booking.userPhone || 'Tidak disediakan'}</span>
        </div>
      </div>

      {/* Pond & Seats */}
      <div style={{ background: 'var(--cream)', padding: '18px', borderRadius: '14px', border: '1px solid var(--line)' }}>
        <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 700 }}>Butiran Kolam</div>
        <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginBottom: '6px' }}>🏆 {booking.competitionName || 'Pertandingan'}</div>
        <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '6px', fontFamily: 'var(--font-heading)' }}>{booking.pondName}</div>
        <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '10px' }}>📅 {booking.pondDate}</div>
        <div className="selected-pills">
          {booking.seats.map((s) => (
            <span key={s} className="seat-pill">#{s}</span>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div style={{ background: 'var(--cream)', padding: '18px', borderRadius: '14px', border: '1px solid var(--line)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '10px' }}>
          <div>
            <div style={{ fontSize: '.68rem', color: 'var(--red)', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '1px' }}>Jenis Bayaran</div>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>{booking.paymentType === 'deposit' ? '50% Deposit' : 'Bayaran Penuh'}</div>
          </div>
          <div>
            <div style={{ fontSize: '.68rem', color: 'var(--red)', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '1px' }}>Jumlah Dibayar</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--red)', fontFamily: 'var(--font-heading)' }}>RM {booking.paidAmount ?? booking.amount}</div>
          </div>
        </div>
        <div style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>Jumlah Keseluruhan: RM {booking.totalAmount}</div>
        {balanceDue > 0 && (
          <div style={{ marginTop: '8px', fontSize: '.85rem', fontWeight: 700, color: 'var(--red)' }}>
            Baki Tertunggak: RM {balanceDue}
          </div>
        )}
      </div>

      {/* Receipts */}
      {receipts.length > 0 && (
        <div style={{ background: 'var(--cream)', padding: '18px', borderRadius: '14px', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '14px', fontWeight: 700 }}>
            Resit Bayaran ({receipts.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {receipts.map((r, i) => {
              const meta = RECEIPT_STATUS_LABEL[r.status] || RECEIPT_STATUS_LABEL.pending;
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '.82rem', fontWeight: 700 }}>
                      Resit #{i + 1} · RM {r.amount}
                    </span>
                    <span style={{ fontSize: '.72rem', fontWeight: 700, color: meta.color }}>{meta.label}</span>
                  </div>
                  {r.url && (
                    <>
                      <img src={r.url} alt={`Receipt ${i + 1}`} style={{ width: '100%', maxHeight: '300px', borderRadius: '12px', objectFit: 'cover', border: '1px solid var(--line)' }} />
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => window.open(r.url, '_blank')}
                        style={{ marginTop: '10px', width: '100%', justifyContent: 'center' }}
                      >
                        Lihat Resit Penuh
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* One-time receipt correction (replace a wrongly-uploaded pending receipt) */}
      {canReuploadReceipt && (
        <ReceiptReupload
          bookingId={booking.id}
          receiptIndex={firstPendingReceiptIdx}
          onSubmitted={onReceiptSubmitted!}
        />
      )}
      {!!onReceiptSubmitted && booking.receiptReuploadUsed && booking.status !== 'rejected' && (
        <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Muat naik semula sekali sahaja telah digunakan. / Your one-time receipt re-upload has been used.
        </div>
      )}

      {/* Balance receipt upload (deposit bookings with outstanding balance) */}
      {canSubmitBalance && (
        <BalanceReceiptUpload
          bookingId={booking.id}
          balanceDue={balanceDue}
          receiptCount={receipts.length}
          onSubmitted={onReceiptSubmitted!}
        />
      )}

      {/* Booking Date */}
      <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        Dihantar: {new Date(booking.createdAt).toLocaleString('en-MY')}
      </div>

      {/* Close button (modal mode only) */}
      {!inPage && onClose && (
        <button className="btn btn-primary" onClick={onClose} style={{ width: '100%', justifyContent: 'center' }}>
          Tutup
        </button>
      )}
    </div>
  );
};

export default BookingDetailContent;
