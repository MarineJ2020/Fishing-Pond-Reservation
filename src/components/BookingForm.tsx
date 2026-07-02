import React, { useState, useRef } from 'react';
import { User, Pond, Booking } from '../types';

interface BookingFormProps {
  user: User | null;
  pond: Pond | null;
  selectedSeats: number[];
  pricePerPeg: number;
  isSubmitting?: boolean;
  payType: 'full' | 'deposit';
  receiptData: string | null;
  adminProxyName: string;
  adminProxyEmail: string;
  adminProxyPhone: string;
  onSetPayType: (type: 'full' | 'deposit') => void;
  onHandleReceiptChange: (file: File) => void;
  onClearReceipt: () => void;
  onSubmitBooking: () => void;
  onOpenAuth: () => void;
  onAdminProxyNameChange: (v: string) => void;
  onAdminProxyEmailChange: (v: string) => void;
  onAdminProxyPhoneChange: (v: string) => void;
  onResendVerification: () => Promise<boolean>;
  onRefreshVerification: () => Promise<boolean>;
  onOpenRulesPdf: () => void;
}

const BookingForm: React.FC<BookingFormProps> = ({
  user,
  pond,
  selectedSeats,
  pricePerPeg,
  isSubmitting = false,
  payType,
  receiptData,
  adminProxyName,
  adminProxyEmail,
  adminProxyPhone,
  onSetPayType,
  onHandleReceiptChange,
  onClearReceipt,
  onSubmitBooking,
  onOpenAuth,
  onAdminProxyNameChange,
  onAdminProxyEmailChange,
  onAdminProxyPhoneChange,
  onResendVerification,
  onRefreshVerification,
  onOpenRulesPdf,
}) => {
  const [notes, setNotes] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [termsConfirmed, setTermsConfirmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const calcAmt = () => {
    const tot = selectedSeats.length * Math.max(0, pricePerPeg || 0);
    return payType === 'deposit' ? Math.ceil(tot * 0.5) : tot;
  };

  const amt = calcAmt();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onHandleReceiptChange(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onHandleReceiptChange(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  if (!user) {
    return (
      <div className="panel">
        <div className="panel-title">Maklumat & Bayaran</div>
        <div className="panel-subtitle">Login atau daftar untuk meneruskan tempahan anda</div>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔐</div>
          <div style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginBottom: '18px', lineHeight: 1.6 }}>
            Login atau register untuk buat tempahan
          </div>
          <button className="btn btn-primary w-full" onClick={onOpenAuth}>Login / Register</button>
        </div>
      </div>
    );
  }

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const isAdminProxyMode = isAdmin && adminProxyName.trim() !== '';
  // Email/password users must verify before booking (Google accounts are pre-verified).
  const needsVerification = !!user && !isAdmin && user.emailVerified === false;

  const handleResend = async () => {
    setVerifyBusy(true);
    await onResendVerification();
    setVerifyBusy(false);
  };

  const handleRefresh = async () => {
    setVerifyBusy(true);
    await onRefreshVerification();
    setVerifyBusy(false);
  };

  return (
    <div className="panel">
      <div className="panel-title">Maklumat & Bayaran</div>
      <div className="panel-subtitle">Lengkapkan butiran di bawah untuk menempah tempat anda</div>

      {/* ── Admin: book on behalf of customer ── */}
      {isAdmin && (
        <div style={{ background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '.72rem', color: 'var(--gold)', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700, marginBottom: '10px' }}>🛠 Tempahan atas nama pelanggan</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <label className="form-label" style={{ marginBottom: '4px', display: 'block' }}>Nama Pelanggan <span style={{ color: 'var(--red)' }}>*</span></label>
              <input
                className="form-input"
                placeholder="Nama penuh pelanggan"
                value={adminProxyName}
                onChange={e => onAdminProxyNameChange(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" style={{ marginBottom: '4px', display: 'block' }}>E-mel Pelanggan</label>
              <input
                className="form-input"
                type="email"
                placeholder="email@contoh.com (pilihan)"
                value={adminProxyEmail}
                onChange={e => onAdminProxyEmailChange(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" style={{ marginBottom: '4px', display: 'block' }}>Nombor Telefon Pelanggan <span style={{ color: 'var(--red)' }}>*</span></label>
              <input
                className="form-input"
                type="tel"
                placeholder="+60 12-345 6789"
                value={adminProxyPhone}
                onChange={e => onAdminProxyPhoneChange(e.target.value)}
              />
            </div>
          </div>
          <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '8px' }}>Isi nama &amp; telefon untuk tempahan atas nama pelanggan. Kosongkan untuk tempahan atas nama sendiri.</div>
        </div>
      )}

      <label className="form-label">Selected Pegs</label>
      <div className="selected-pills">
        {selectedSeats.length ? (
          selectedSeats.map(n => <span key={n} className="seat-pill">#{n}</span>)
        ) : (
          <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>No pegs selected yet</div>
        )}
      </div>
      <hr className="divider" />
      <label className="form-label">Jenis Bayaran</label>
      <div className="payment-opts">
        <div className={`payment-opt ${payType === 'full' ? 'active' : ''}`} onClick={() => onSetPayType('full')}>
          Penuh<div className="opt-sub">Bayar sepenuhnya</div>
        </div>
        <div className={`payment-opt ${payType === 'deposit' ? 'active' : ''}`} onClick={() => onSetPayType('deposit')}>
          Deposit<div className="opt-sub">50% dahulu</div>
        </div>
      </div>

      <div className="price-bar" style={{ marginBottom: '16px' }}>
        <div>
          <div className="price-bar-label">Jumlah Bayaran</div>
          <div className="price-bar-detail">{selectedSeats.length} tempat × {payType === 'deposit' ? '50% deposit' : 'bayaran penuh'}</div>
        </div>
        <div className="price-bar-total">RM {amt}</div>
      </div>
      {payType === 'deposit' && (
        <div style={{ marginBottom: '14px', padding: '10px 12px', borderRadius: '9px', border: '1px solid rgba(185,28,28,0.25)', background: 'rgba(185,28,28,0.06)', fontSize: '.78rem', lineHeight: 1.5, color: '#7a2230' }}>
          <strong style={{ color: 'var(--red)' }}>Nota:</strong> Deposit akan ditolak daripada jumlah penuh. Baki perlu dijelaskan sebelum/ketika hari pertandingan.
        </div>
      )}

      <label className="form-label">Muat Naik Resit <span style={{ color: 'var(--red)' }}>*</span></label>
      <div
        className="upload-zone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          id="receipt-file"
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <div className="upload-icon">📤</div>
        <div className="upload-text">
          Klik atau tarik resit ke sini<br />
          <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>JPG, PNG atau PDF</span>
        </div>
      </div>
      {receiptData && (
        <div className="upload-preview">
          ✅ <span>Resit telah dimuat naik</span>
          <span style={{ marginLeft: 'auto', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={onClearReceipt}>✕</span>
        </div>
      )}
      <label className="form-label">Nota (pilihan)</label>
      <textarea
        className="form-input"
        rows={2}
        placeholder="Sebarang permintaan khas..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginTop: '14px', cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={termsConfirmed}
          onChange={(e) => setTermsConfirmed(e.target.checked)}
          style={{ marginTop: '3px', width: '16px', height: '16px', accentColor: 'var(--red)' }}
        />
        <span style={{ fontSize: '.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Saya mengesahkan maklumat yang diberi adalah benar dan saya bersetuju dengan{' '}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenRulesPdf();
            }}
            style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', color: 'var(--red)', fontWeight: 800, textDecoration: 'underline' }}
          >
            syarat & peraturan
          </button>
          .
        </span>
      </label>
      {needsVerification && (
        <div style={{ background: 'rgba(185,28,28,0.06)', border: '1px solid rgba(185,28,28,0.3)', borderRadius: '10px', padding: '14px 16px', marginTop: '16px' }}>
          <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--red)', marginBottom: '6px' }}>✉️ Sahkan email anda dahulu</div>
          <div style={{ fontSize: '.78rem', color: '#6f1f2b', marginBottom: '10px', lineHeight: 1.5 }}>
            Kami telah menghantar pautan pengesahan ke <strong>{user?.email}</strong>. Klik pautan tersebut, kemudian tekan "Saya sudah sahkan".
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={handleResend} disabled={verifyBusy}>Hantar semula</button>
            <button className="btn btn-primary btn-sm" onClick={handleRefresh} disabled={verifyBusy}>Saya sudah sahkan</button>
          </div>
        </div>
      )}
      <button
        id="btn-submit"
        className="btn btn-primary w-full btn-lg mt-4"
        onClick={onSubmitBooking}
        disabled={isSubmitting || !selectedSeats.length || !receiptData || !termsConfirmed || (isAdmin && !adminProxyName.trim()) || (isAdminProxyMode && !adminProxyPhone.trim()) || needsVerification}
      >
        {isSubmitting ? 'Menghantar...' : (isAdminProxyMode ? `Tempah untuk ${adminProxyName.trim()}` : 'Hantar Tempahan')}
      </button>
      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '7px' }}>
        {isAdminProxyMode ? 'Tempahan ini akan ditanda sebagai dibuat oleh Admin' : 'Staff akan sahkan dan maklumkan melalui email'}
      </div>
    </div>
  );
};

export default BookingForm;