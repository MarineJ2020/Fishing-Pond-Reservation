import React, { useEffect, useState } from 'react';

interface QrZoomModalProps {
  open: boolean;
  src: string;
  bank?: string;
  name?: string;
  accNo?: string;
  onClose: () => void;
}

type SaveState = 'idle' | 'working' | 'saved' | 'fallback';

const TIPS: React.ReactNode[] = [
  <>Buka aplikasi bank atau e-dompet anda, pilih <b>DuitNow QR</b> / <b>Imbas QR</b>.</>,
  <>Jika anda membayar dari telefon yang sama, simpan QR ini dahulu, kemudian pilih <b>Muat naik dari galeri</b> dalam aplikasi bank.</>,
  <>Pastikan nama penerima yang dipaparkan dalam aplikasi sama seperti di atas sebelum mengesahkan.</>,
  <>Masukkan jumlah bayaran tepat seperti yang dipaparkan pada borang tempahan.</>,
  <>Simpan resit atau tangkap layar transaksi — anda perlu memuat naiknya selepas pembayaran.</>,
];

/** Enlarged view of the payment QR with save-to-gallery and generic DuitNow guidance. */
const QrZoomModal: React.FC<QrZoomModalProps> = ({ open, src, bank, name, accNo, onClose }) => {
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    if (!open) return;
    setSaveState('idle');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !src) return null;

  const handleSave = async () => {
    setSaveState('working');
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const type = blob.type || 'image/png';
      const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const file = new File([blob], `qr-pembayaran.${ext}`, { type });

      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: 'QR Pembayaran' });
        setSaveState('saved');
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveState('saved');
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') { setSaveState('idle'); return; }
      window.open(src, '_blank', 'noopener');
      setSaveState('fallback');
    }
  };

  const saveLabel = saveState === 'working' ? 'Menyimpan...' : saveState === 'saved' ? '✓ QR Disimpan' : '⬇ Simpan ke Galeri';

  return (
    <div className="modal-overlay open" style={{ zIndex: 1200 }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: '420px', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ flex: '0 0 auto' }}>
          <div className="modal-title">QR Pembayaran</div>
          <button className="modal-close" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        {/* flex:1 + minHeight:0 lets the body scroll inside the 92vh-capped .modal
            without depending on the header's exact height. */}
        <div className="modal-body" style={{ padding: '22px', flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={src}
              alt="QR Pembayaran"
              style={{
                width: 'min(230px, 60vw)', height: 'auto', display: 'block',
                borderRadius: '12px', border: '1px solid var(--border, #e5e0d8)',
                background: '#fff', padding: '10px',
              }}
            />
          </div>

          {(bank || name || accNo) && (
            <div style={{ textAlign: 'center', marginTop: '14px' }}>
              {bank && <div style={{ fontSize: '.9rem', fontWeight: 700 }}>{bank}</div>}
              {name && <div style={{ fontSize: '.84rem', marginTop: '2px' }}>{name}</div>}
              {accNo && <div style={{ fontSize: '.84rem', marginTop: '2px', fontFamily: 'monospace', letterSpacing: '.5px' }}>{accNo}</div>}
            </div>
          )}

          <button
            type="button"
            className="btn"
            onClick={handleSave}
            disabled={saveState === 'working'}
            style={{
              width: '100%', marginTop: '16px', justifyContent: 'center',
              background: 'var(--red)', color: '#fff', fontWeight: 800,
              padding: '11px 16px', cursor: saveState === 'working' ? 'wait' : 'pointer',
              opacity: saveState === 'working' ? 0.7 : 1,
            }}
          >
            {saveLabel}
          </button>
          {saveState === 'fallback' && (
            <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center', lineHeight: 1.5 }}>
              QR dibuka dalam tab baharu. Tekan lama pada imej untuk menyimpannya ke galeri.
            </div>
          )}

          <div style={{ marginTop: '18px', padding: '14px', borderRadius: '10px', background: 'var(--cream, #f7f7f5)', border: '1px solid var(--border, #e5e0d8)' }}>
            <div style={{ fontSize: '.7rem', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)', marginBottom: '8px' }}>
              Tips Bayaran DuitNow QR
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '.76rem', lineHeight: 1.65, color: 'var(--text-muted)' }}>
              {TIPS.map((tip, i) => (
                <li key={i} style={{ marginBottom: i === TIPS.length - 1 ? 0 : '6px' }}>{tip}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QrZoomModal;
