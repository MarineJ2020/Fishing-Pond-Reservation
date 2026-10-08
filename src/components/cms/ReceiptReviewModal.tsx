import React, { useEffect, useRef, useState } from 'react';
import { Booking, BookingActivityEntry } from '../../types';
import { formatDate } from '../../utils';
import { receiptBankReference } from '../../utils/booking';
import { getBookingActivity } from '../../lib/api';

type TimelineRow = { key: string; at: string; label: string; actor?: string; details?: string; reason?: string };

// Server audit entries plus what the booking doc itself records (creation,
// receipt uploads, staff remarks), newest first.
const buildTimeline = (booking: Booking, entries: BookingActivityEntry[], createdByName: string): TimelineRow[] => {
  const rows: TimelineRow[] = entries.map((e) => ({
    key: e.id, at: e.at, label: e.actionLabel, actor: e.actorName, details: e.details, reason: e.reason,
  }));
  if (booking.createdAt) {
    rows.push({
      key: 'created', at: booking.createdAt,
      label: booking.createdByStaff ? 'Tempahan manual oleh staf' : 'Tempahan dihantar',
      actor: booking.createdByStaff
        ? `${createdByName || booking.createdByName || 'Staf'} (bagi pihak ${booking.userName})`
        : booking.userName,
    });
  }
  (booking.receipts || []).forEach((r, i) => {
    if (i > 0 && r.submittedAt) {
      rows.push({ key: `receipt-${i}`, at: r.submittedAt, label: `Slip Bayaran #${i + 1} dihantar`, actor: booking.userName, details: `RM ${r.amount}` });
    }
  });
  (booking.staffRemarks || []).forEach((r, i) => {
    rows.push({ key: `remark-${i}`, at: r.at, label: 'Catatan ditambah', actor: r.byName || 'Staf', details: r.text });
  });
  return rows.filter((row) => row.at).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
};

interface ReceiptReviewModalProps {
  /** null closes the modal. */
  booking: Booking | null;
  saving: boolean;
  /** True if one of this booking's seats is also claimed by another booking. */
  hasConflict: boolean;
  onViewReceipt: (url: string) => void;
  onApprove: (bookingId: string, receiptIndex: number) => void;
  onReject: (bookingId: string, receiptIndex: number, reason: string) => void;
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
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [activity, setActivity] = useState<BookingActivityEntry[]>([]);
  const [createdByName, setCreatedByName] = useState('');
  const [activityState, setActivityState] = useState<'idle' | 'loading' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refetch whenever the booking object changes (after approve/reject/remark).
  useEffect(() => {
    if (!booking) return;
    let active = true;
    setActivityState('loading');
    getBookingActivity(booking.id)
      .then((result) => {
        if (!active) return;
        setActivity(result.entries);
        setCreatedByName(result.createdByName);
        setActivityState('idle');
      })
      .catch(() => { if (active) setActivityState('error'); });
    return () => { active = false; };
  }, [booking]);

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

  const timeline = buildTimeline(booking, activity, createdByName);

  const handleClose = () => { setManualMode(false); setRemarkText(''); setRejectMode(false); setRejectReason(''); onClose(); };
  const handleConfirmReject = () => {
    if (!rejectReason.trim()) return;
    onReject(booking.id, pendingIndex, rejectReason.trim());
    setRejectMode(false);
    setRejectReason('');
  };
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
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No. Rujukan Bank (slip bayaran pertama): {booking.bankReference || '-'}</div>
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
                <span style={{ fontWeight: 700 }}>Slip Bayaran #{pendingIndex + 1} · RM {reviewableReceipt.amount}</span>
                {reviewableReceipt.url && <button className="btn btn-sm btn-ghost" onClick={() => onViewReceipt(reviewableReceipt.url)}>Lihat Slip Bayaran</button>}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Dihantar: {reviewableReceipt.submittedAt ? formatDate(reviewableReceipt.submittedAt, { time: true }) : '-'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                No. Rujukan Bank: <strong style={{ fontFamily: 'monospace' }}>{receiptBankReference(booking, reviewableReceipt, pendingIndex) || '-'}</strong>
              </div>
              {!rejectMode ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-green" disabled={saving} onClick={() => onApprove(booking.id, pendingIndex)}>✓ Sahkan</button>
                  <button className="btn btn-red" disabled={saving} onClick={() => setRejectMode(true)}>✕ Tolak</button>
                </div>
              ) : (
                <div>
                  <label className="form-label" htmlFor="reject-reason">Sebab ditolak *</label>
                  <textarea
                    id="reject-reason"
                    className="form-input"
                    style={{ width: '100%', minHeight: 60, marginBottom: 8 }}
                    placeholder="Cth: Jumlah tidak sepadan, slip bayaran tidak jelas"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    maxLength={500}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-red" disabled={saving || !rejectReason.trim()} onClick={handleConfirmReject}>Sahkan Tolak</button>
                    <button className="btn btn-ghost" disabled={saving} onClick={() => { setRejectMode(false); setRejectReason(''); }}>Batal</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '14px' }}>Tiada slip bayaran menunggu semakan untuk tempahan ini.</div>
          )}

          {canRecordManualPayment && (!manualMode ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setManualMode(true)}>
              Bayaran diterima di luar sistem? Rekod secara manual
            </button>
          ) : (
            <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '14px' }}>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Muat naik bukti bayaran (cth. slip bayaran bank/tunai) untuk sahkan RM {manualAmount} secara manual.
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

          <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
              Log Aktiviti {activityState === 'loading' && '· memuatkan...'}
            </div>
            {activityState === 'error' && (
              <div style={{ fontSize: '0.78rem', color: '#b45309', marginBottom: 8 }}>Log aktiviti staf tidak dapat dimuatkan. Rekod di bawah mungkin tidak lengkap.</div>
            )}
            {timeline.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tiada aktiviti direkodkan.</div>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                {timeline.map((row) => (
                  <li key={row.key} style={{ fontSize: '0.8rem', borderLeft: '3px solid var(--border)', padding: '2px 0 2px 10px' }}>
                    <div><strong>{row.label}</strong>{row.details ? ` · ${row.details}` : ''}</div>
                    {row.reason && <div style={{ color: 'var(--red, #b91c1c)' }}>Sebab: {row.reason}</div>}
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {row.actor || 'Sistem'} · {formatDate(row.at, { time: true })}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptReviewModal;
