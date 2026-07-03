import React, { useState } from 'react';
import { User } from '../types';
import PhoneNumberField from './PhoneNumberField';
import PhoneConfirmModal from './PhoneConfirmModal';
import { formatMyPhone, isValidMyPhoneRest, splitMyPhone } from '../utils/phone';

interface ProfileContentProps {
  user: User;
  onSave: (name: string, phone: string) => Promise<boolean>;
}

const ProfileContent: React.FC<ProfileContentProps> = ({ user, onSave }) => {
  const [name, setName] = useState(user.name);
  const initialPhone = splitMyPhone(user.phone);
  const [phonePrefix, setPhonePrefix] = useState(initialPhone.prefix);
  const [phoneRest, setPhoneRest] = useState(initialPhone.rest);
  const [saving, setSaving] = useState(false);
  const [phoneToConfirm, setPhoneToConfirm] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState('');

  const phone = formatMyPhone(phonePrefix, phoneRest);

  const handleSaveClick = () => {
    if (!isValidMyPhoneRest(phonePrefix, phoneRest)) {
      setPhoneError('Sila masukkan nombor telefon Malaysia yang sah.');
      return;
    }
    setPhoneError('');
    setPhoneToConfirm(phone);
  };

  const handleSaveConfirmed = async () => {
    setSaving(true);
    await onSave(name, phone);
    setSaving(false);
    setPhoneToConfirm(null);
  };

  const dirty = name.trim() !== user.name || phone !== user.phone;

  return (
    <div className="bookings-page" style={{ maxWidth: '520px' }}>
      <div style={{ fontFamily: 'var(--fd)', fontSize: '28px', fontWeight: 800, letterSpacing: '.5px', marginBottom: '4px' }}>
        Profil Saya
      </div>
      <div style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '24px' }}>
        Kemaskini nama dan nombor telefon anda.
      </div>
      <div className="card" style={{ padding: '24px' }}>
        <label className="form-label">Nama Papar</label>
        <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama anda" />
        <label className="form-label" style={{ marginTop: '14px' }}>Email</label>
        <input className="form-input" value={user.email} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
        <div style={{ marginTop: '14px' }}>
          <PhoneNumberField
            prefix={phonePrefix}
            rest={phoneRest}
            onPrefixChange={setPhonePrefix}
            onRestChange={setPhoneRest}
            required
          />
        </div>
        {phoneError && <div style={{ color: 'var(--red, #c0152a)', fontSize: '13px', marginTop: '8px' }}>{phoneError}</div>}
        <button
          className="form-submit"
          style={{ marginTop: '20px' }}
          disabled={saving || !dirty || !name.trim()}
          onClick={handleSaveClick}
        >
          {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </div>
      <PhoneConfirmModal
        phone={phoneToConfirm}
        loading={saving}
        onConfirm={handleSaveConfirmed}
        onCancel={() => setPhoneToConfirm(null)}
      />
    </div>
  );
};

export default ProfileContent;
