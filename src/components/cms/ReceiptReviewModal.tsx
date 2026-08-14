import React, { useRef, useState } from 'react';
import { Booking } from '../../types';
import { formatDate } from '../../utils';
import { receiptBankReference } from '../../utils/booking';

interface ReceiptReviewModalProps {
  /** null closes the modal. */
  booking: Booking | null;
  saving: boolean;
  /** True if one of this booking's seats is also claimed by another booking. */
  hasConflict: boolean;
  onViewReceipt: (url: string) => void;
  onApprove: (bookingId: string, receiptIndex: number) => void;
  onReject: (bookingId: string, receiptIndex: number) => void;
  onApproveManual: (booking: Booking, file: File, amount: number) => void;
  onAddRemark: (bookingId: string, text: string) => void;
  onClose: () => void;
}

/**
 * Single review popup reused by both Kelulusan (first receipt) and Semua
 * Tempahan (balance receipt) — finds the booking's pending receipt (if any)
 * and offers Approve/Reject, plus a manual fallback for payments received
 * outside the system (folds the old "Sahkan Deposit + Bukti" shortcut in
 * here instead of a separate button).
 */
const ReceiptReviewModal: React.FC<ReceiptReviewModalProps> = ({ booking, saving, hasConflict, onViewReceipt, onApprove, onReject, onApproveManual, onAddRemark, onClose }) => {
  const [manualMode, setManualMode] = useState(false);
  const [remarkText, setRemarkText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!booking) return null;

  const receipts = booking.receipts && booking.receipts.length
    ? booking.receipts
    : (booking.receiptData ? [{ url: booking.receiptData, amount: booking.amount, status: 'pending' as const, submittedAt: booking.createdAt || '' }] : []);
  const pendingIndex = receipts.findIndex((r) => r.status === 'pending');
  const pendingReceipt = pendingIndex >= 0 ? receipts[pendingIndex] : null;
  // A later accepted manual proof supersedes an earlier wrong/pending receipt.
  // Keep that older proof in history, but do not offer Sahkan/Tolak for it.
  const pendingWasSuperseded = pendingIndex >= 0
    && receipts.slice(pendingIndex + 1).some((receipt) => receipt.status === 'accepted');
  const reviewableReceipt = pendingWasSuperseded ? null : pendingReceipt;
  const manualAmount = reviewableReceipt?.amount ?? (booking.balanceDue || booking.amount);
  const remarks = booking.staffRemarks || [];
  const canRecordManualPayment = booking.status === 'pending' || (booking.balanceDue ?? 0) > 0;

  const handleClose = () => { setManualMode(false); setRemarkText(''); onClose(); };
  const handleAddRemark = () => {
    if (!remarkText.trim()) return;
    onAddRemark(booking.id, remarkText);
    setRemarkText('');
  };

  return (
    <div className="modal-overlay open" onClick={handleClose}>
      <div className="modal" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Semak Tempahan</div>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontWeight: 700 }}>{booking.userName}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{booking.pondName} · {booking.competitionName || '-'}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Ref: {booking.bookingRef || booking.id}</div>
            {/* Booking-level reference = the reference keyed in with the first
                (deposit) receipt. Each later receipt carries its own, shown below. */}
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No. Rujukan Bank (resit pertama): {booking.bankReference || '-'}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              📱 Profil: {booking.userPhone || '—'}
              {' · '}
              Tempahan: {booking.bookingPhone || '—'}
              {booking.bookingPhone && booking.userPhone && booking.bookingPhone !== booking.userPhone && (
                <span style={{ color: '#b45309', fontWeight: 700 }}> ⚠ berbeza</span>
              )}
            </div>
          </div>

          {hasConflict && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '10px 12px', marginBottom: '14px', fontSize: '0.82rem', color: '#92400e' }}>
              ⚠ Amaran: salah satu peg tempahan ini juga dituntut oleh tempahan lain.
            </div>
          )}

          {reviewableReceipt ? (
            <div style={{ background: 'var(--cream, #f7f7f5)', borderRadius: 10, padding: '14px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 700 }}>Resit #{pendingIndex + 1} · RM {reviewableReceipt.amount}</span>
                {reviewableReceipt.url && <button className="btn btn-sm btn-ghost" onClick={() => onViewReceipt(reviewableReceipt.url)}>Lihat Resit</button>}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Dihantar: {reviewableReceipt.submittedAt ? formatDate(reviewableReceipt.submittedAt, { time: true }) : '-'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                No. Rujukan Bank: <strong style={{ fontFamily: 'monospace' }}>{receiptBankReference(booking, reviewableReceipt, pendingIndex) || '-'}</strong>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-green" disabled={saving} onClick={() => onApprove(booking.id, pendingIndex)}>✓ Sahkan</button>
                <button className="btn btn-red" disabled={saving} onClick={() => onReject(booking.id, pendingIndex)}>✕ Tolak</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '14px' }}>Tiada resit menunggu semakan untuk tempahan ini.</div>
          )}

          {canRecordManualPayment && (!manualMode ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setManualMode(true)}>
              Bayaran diterima di luar sistem? Rekod secara manual
            </button>
          ) : (
            <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '14px' }}>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Muat naik bukti bayaran (cth. resit bank/tunai) untuk sahkan RM {manualAmount} secara manual.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onApproveManual(booking, file, manualAmount);
                  e.target.value = '';
                }}
              />
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => fileInputRef.current?.click()}>
                {saving ? 'Memuat naik...' : '📷 Muat Naik Bukti & Sahkan'}
              </button>
            </div>
          ))}

          <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
              Catatan Staf {remarks.length > 0 && `(${remarks.length})`}
            </div>
            {remarks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px', maxHeight: '160px', overflowY: 'auto' }}>
                {remarks.map((r, i) => (
                  <div key={i} style={{ fontSize: '0.8rem', background: 'var(--cream, #f7f7f5)', borderRadius: 8, padding: '8px 10px' }}>
                    <div>{r.text}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                      {r.byName || 'Staf'} · {formatDate(r.at, { time: true })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="form-input"
                style={{ flex: 1 }}
                placeholder="Tambah catatan..."
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRemark()}
              />
              <button className="btn btn-sm" disabled={!remarkText.trim()} onClick={handleAddRemark}>+ Catatan</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptReviewModal;
