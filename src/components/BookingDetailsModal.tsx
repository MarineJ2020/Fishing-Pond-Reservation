import React from 'react';
import { Booking } from '../types';

interface BookingDetailsModalProps {
  isOpen: boolean;
  booking: Booking | null;
  onClose: () => void;
}

const BookingDetailsModal: React.FC<BookingDetailsModalProps> = ({ isOpen, booking, onClose }) => {
  if (!isOpen || !booking) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ display: 'flex' }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '620px' }}>
        <div className="modal-header">
          <div className="modal-title">Butiran Tempahan</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div
          style={{
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            maxHeight: 'calc(92vh - 96px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain'
          }}
        >
          {/* Booking ID & Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '.68rem', color: 'var(--gold)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Booking ID</div>
              <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--gold)' }}>{booking.id}</div>
            </div>
            <div>
              <div style={{ fontSize: '.68rem', color: 'var(--gold)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Status</div>
              <span className={`status-badge st-${booking.status}`}>
                {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
              </span>
            </div>
          </div>

          {/* Angler Info */}
          <div style={{ background: 'var(--gold-pale)', padding: '18px', borderRadius: '14px', border: '1px solid rgba(200,146,42,.2)' }}>
            <div style={{ fontSize: '.68rem', color: 'var(--gold)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 700 }}>Pemancing</div>
            <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '6px', fontFamily: 'var(--font-heading)' }}>{booking.userName}</div>
            <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span>📧 {booking.userId}</span>
              <span>📱 {booking.userPhone || 'Tidak disediakan'}</span>
            </div>
          </div>

          {/* Pond & Seats */}
          <div style={{ background: 'var(--gold-pale)', padding: '18px', borderRadius: '14px', border: '1px solid rgba(200,146,42,.2)' }}>
            <div style={{ fontSize: '.68rem', color: 'var(--gold)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 700 }}>Butiran Kolam</div>
            <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginBottom: '6px' }}>🏆 {booking.competitionName || 'Pertandingan'}</div>
            <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '6px', fontFamily: 'var(--font-heading)' }}>{booking.pondName}</div>
            <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '10px' }}>📅 {booking.pondDate}</div>
            <div className="selected-pills">
              {booking.seats.map(s => (
                <span key={s} className="seat-pill">#{s}</span>
              ))}
            </div>
          </div>

          {/* Pricing */}
          <div style={{ background: 'var(--gold-pale)', padding: '18px', borderRadius: '14px', border: '1px solid rgba(200,146,42,.2)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '.68rem', color: 'var(--gold)', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '1px' }}>Jenis Bayaran</div>
                <div style={{ fontSize: '14px', fontWeight: 700 }}>{booking.paymentType === 'deposit' ? '50% Deposit' : 'Bayaran Penuh'}</div>
              </div>
              <div>
                <div style={{ fontSize: '.68rem', color: 'var(--gold)', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '1px' }}>Jumlah Dibayar</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-heading)' }}>RM {booking.amount}</div>
              </div>
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>Jumlah Keseluruhan: RM {booking.totalAmount}</div>
          </div>

          {/* Receipt */}
          {booking.receiptData && (
            <div style={{ background: 'var(--gold-pale)', padding: '18px', borderRadius: '14px', border: '1px solid rgba(200,146,42,.2)' }}>
              <div style={{ fontSize: '.68rem', color: 'var(--gold)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '14px', fontWeight: 700 }}>Resit Bayaran</div>
              <img src={booking.receiptData} alt="Receipt" style={{ width: '100%', maxHeight: '300px', borderRadius: '12px', objectFit: 'cover', border: '1px solid rgba(200,146,42,.15)' }} />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => window.open(booking.receiptData, '_blank')}
                style={{ marginTop: '10px', width: '100%', justifyContent: 'center' }}
              >
                Lihat Resit Penuh
              </button>
            </div>
          )}

          {/* Booking Date */}
          <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Dihantar: {new Date(booking.createdAt).toLocaleString('en-MY')}
          </div>

          {/* Close Button */}
          <button className="btn btn-primary" onClick={onClose} style={{ width: '100%', justifyContent: 'center' }}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookingDetailsModal;
