import React from 'react';

interface PhoneConfirmModalProps {
  phone: string | null;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Reusable "please confirm this is the right number" gate shown before a phone number is saved. */
const PhoneConfirmModal: React.FC<PhoneConfirmModalProps> = ({ phone, loading, onConfirm, onCancel }) => {
  if (!phone) return null;
  return (
    <div className="modal-overlay open" style={{ zIndex: 1200 }} onClick={onCancel}>
      <div className="modal" style={{ maxWidth: '380px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Sahkan Nombor Telefon</div>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body" style={{ textAlign: 'center', padding: '28px 24px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📱</div>
          <p style={{ marginBottom: '10px', color: 'var(--text-muted, #667085)', fontSize: '14px' }}>
            Pastikan nombor telefon ini betul:
          </p>
          <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '1px', marginBottom: '20px' }}>{phone}</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel} disabled={loading}>Betulkan</button>
            <button className="form-submit" style={{ flex: 1, marginTop: 0 }} onClick={onConfirm} disabled={loading}>
              {loading ? 'Menyimpan...' : 'Sahkan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhoneConfirmModal;
