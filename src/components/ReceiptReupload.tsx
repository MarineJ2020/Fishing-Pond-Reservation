import React, { useRef, useState } from 'react';
import { receiptUploadFolder } from '../utils/receiptStorage';
import { useUI } from '../context/UIContext';
import { compressImageToDataUrl, uploadDataUrlToFirebaseStorage } from '../utils/imageStorage';
import { isPdfFile, uploadPdfToFirebaseStorage } from '../utils/pdfStorage';
import { replaceBookingReceipt } from '../lib/api';

interface Props {
  bookingId: string;
  /** Index of the receipt to replace. */
  receiptIndex: number;
  /** Current status of the receipt being replaced (drives the copy). */
  receiptStatus?: string;
  /** Called after a successful replacement so the parent can refresh the booking. */
  onSubmitted: () => void | Promise<void>;
}

/**
 * Receipt correction for the booking owner. Any receipt that staff has not yet
 * approved can be replaced — including a rejected one (which returns to pending
 * for re-review). Supports both images and PDFs.
 */
const ReceiptReupload: React.FC<Props> = ({ bookingId, receiptIndex, receiptStatus, onSubmitted }) => {
  const { addToast } = useUI();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleFile = async (file: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const receiptUrl = isPdfFile(file)
        ? await uploadPdfToFirebaseStorage(file, receiptUploadFolder(), file.name)
        : await (async () => {
            const dataUrl = await compressImageToDataUrl(file);
            return uploadDataUrlToFirebaseStorage(dataUrl, receiptUploadFolder(), file.name);
          })();
      await replaceBookingReceipt(bookingId, receiptIndex, receiptUrl);
      addToast('Resit telah dikemaskini. / Receipt updated.', 'success');
      await onSubmitted();
    } catch (err: any) {
      console.error('Receipt re-upload failed:', err);
      addToast(err?.message || 'Gagal menggantikan resit. Sila cuba lagi. / Failed to replace receipt. Please try again.', 'error');
    } finally {
      setBusy(false);
      setConfirming(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const isRejected = receiptStatus === 'rejected';

  return (
    <div style={{ marginTop: '10px', background: isRejected ? 'rgba(231,25,45,0.06)' : 'var(--cream)', padding: '14px', borderRadius: '12px', border: `1px dashed ${isRejected ? 'var(--red)' : 'var(--gold, #d4a017)'}` }}>
      <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>
        {isRejected ? 'Resit Ditolak · Muat Naik Semula / Rejected — Re-upload' : 'Tukar Resit / Replace Receipt'}
      </div>
      <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
        {isRejected ? (
          <>Resit ini telah ditolak oleh petugas. Sila muat naik resit yang betul untuk semakan semula.
          <br /><em>This receipt was rejected. Upload a corrected receipt for re-review.</em></>
        ) : (
          <>Tersilap muat naik gambar/resit? Anda boleh menggantikannya selagi belum disahkan petugas.
          <br /><em>Uploaded the wrong file? You can replace it any time before staff approves it.</em></>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      {!confirming ? (
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => setConfirming(true)}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {isRejected ? 'Muat Naik Semula / Re-upload' : 'Tukar Resit / Replace Receipt'}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)} style={{ flex: 1, justifyContent: 'center' }}>
            Batal / Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()} style={{ flex: 1, justifyContent: 'center' }}>
            {busy ? 'Memuat naik… / Uploading…' : 'Pilih Fail / Choose File'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ReceiptReupload;
