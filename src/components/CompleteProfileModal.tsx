import React, { useState } from 'react';

interface CompleteProfileModalProps {
  isOpen: boolean;
  onSubmit: (phone: string) => Promise<void>;
}

/**
 * Blocking one-time prompt shown right after a brand-new Google sign-up.
 * Google doesn't collect a phone number, so this is the only place that
 * signup path gets one — no close button, phone is required to proceed.
 */
const CompleteProfileModal: React.FC<CompleteProfileModalProps> = ({ isOpen, onSubmit }) => {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!phone.trim()) return;
    setLoading(true);
    await onSubmit(phone.trim());
    setLoading(false);
  };

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <div className="modal-title">Satu Langkah Lagi</div>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: '16px', color: 'var(--text-muted, #667085)', fontSize: '14px', lineHeight: 1.5 }}>
            Google tidak berkongsi nombor telefon anda. Sila masukkan nombor telefon untuk lengkapkan pendaftaran.
          </p>
          <label className="form-label">Telefon *</label>
          <input
            type="tel"
            required
            autoFocus
            className="form-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+60 12-345 6789"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
          <button className="form-submit" style={{ marginTop: '14px' }} onClick={handleSubmit} disabled={loading || !phone.trim()}>
            {loading ? 'Menyimpan...' : 'Simpan & Teruskan'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompleteProfileModal;
