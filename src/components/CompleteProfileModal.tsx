import React, { useState } from 'react';
import PhoneNumberField from './PhoneNumberField';
import PhoneConfirmModal from './PhoneConfirmModal';
import { formatMyPhone, isValidMyPhoneRest } from '../utils/phone';

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
  const [phonePrefix, setPhonePrefix] = useState('012');
  const [phoneRest, setPhoneRest] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phoneToConfirm, setPhoneToConfirm] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleContinue = () => {
    if (!isValidMyPhoneRest(phonePrefix, phoneRest)) {
      setError('Sila masukkan nombor telefon Malaysia yang sah.');
      return;
    }
    setError('');
    setPhoneToConfirm(formatMyPhone(phonePrefix, phoneRest));
  };

  const handleConfirmed = async () => {
    setLoading(true);
    await onSubmit(formatMyPhone(phonePrefix, phoneRest));
    setLoading(false);
    setPhoneToConfirm(null);
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
          <PhoneNumberField
            prefix={phonePrefix}
            rest={phoneRest}
            onPrefixChange={setPhonePrefix}
            onRestChange={setPhoneRest}
            required
          />
          {error && <div style={{ color: 'var(--red, #c0152a)', fontSize: '13px', marginTop: '8px' }}>{error}</div>}
          <button className="form-submit" style={{ marginTop: '14px' }} onClick={handleContinue} disabled={loading}>
            {loading ? 'Menyimpan...' : 'Simpan & Teruskan'}
          </button>
        </div>
      </div>
      <PhoneConfirmModal
        phone={phoneToConfirm}
        loading={loading}
        onConfirm={handleConfirmed}
        onCancel={() => setPhoneToConfirm(null)}
      />
    </div>
  );
};

export default CompleteProfileModal;
