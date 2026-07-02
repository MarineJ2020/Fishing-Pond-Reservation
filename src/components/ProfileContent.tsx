import React, { useState } from 'react';
import { User } from '../types';

interface ProfileContentProps {
  user: User;
  onSave: (name: string, phone: string) => Promise<boolean>;
}

const ProfileContent: React.FC<ProfileContentProps> = ({ user, onSave }) => {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(name, phone);
    setSaving(false);
  };

  const dirty = name.trim() !== user.name || phone.trim() !== user.phone;

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
        <label className="form-label" style={{ marginTop: '14px' }}>Nombor Telefon *</label>
        <input type="tel" required className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+60 12-345 6789" />
        <button
          className="form-submit"
          style={{ marginTop: '20px' }}
          disabled={saving || !dirty || !name.trim() || !phone.trim()}
          onClick={handleSave}
        >
          {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </div>
    </div>
  );
};

export default ProfileContent;
