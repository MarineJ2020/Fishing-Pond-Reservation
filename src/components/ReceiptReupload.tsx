import React, { useRef, useState } from 'react';
import { useUI } from '../context/UIContext';
import { compressImageToDataUrl, uploadDataUrlToCloudinary } from '../utils/cloudinary';
import { isPdfFile, uploadPdfToFirebaseStorage } from '../utils/pdfStorage';
import { replaceBookingReceiptDirect } from '../lib/firestore';

interface Props {
  bookingId: string;
  /** Index of the still-pending receipt to replace. */
  receiptIndex: number;
  /** Called after a successful replacement so the parent can refresh the booking. */
  onSubmitted: () => void | Promise<void>;
}

/**
 * One-time receipt correction for the booking owner. If they realise they uploaded
 * the wrong image, they can replace a still-pending receipt exactly once. The
 * warning makes clear there is no second chance, so they should double-check.
 */
const ReceiptReupload: React.FC<Props> = ({ bookingId, receiptIndex, onSubmitted }) => {
  const { addToast } = useUI();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleFile = async (file: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const receiptUrl = isPdfFile(file)
        ? await uploadPdfToFirebaseStorage(file, 'fishing-pond-receipts', file.name)
        : await (async () => {
            const dataUrl = await compressImageToDataUrl(file);
            return uploadDataUrlToCloudinary(dataUrl, 'fishing-pond-receipts');
          })();
      await replaceBookingReceiptDirect(bookingId, receiptIndex, receiptUrl);
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

  return (
    <div style={{ background: 'var(--cream)', padding: '16px', borderRadius: '14px', border: '1px dashed var(--gold, #d4a017)' }}>
      <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>
        Tukar Resit · Sekali Sahaja / One-Time Receipt Correction
      </div>
      <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
        Tersilap muat naik gambar/resit? Anda boleh menggantikannya <strong style={{ color: 'var(--red)' }}>sekali sahaja</strong>.
        Pastikan resit yang betul sebelum menghantar — tiada peluang kedua.
        <br />
        <em>Uploaded the wrong image? You may replace it <strong>only once</strong>. Make sure the new receipt is correct before submitting — there is no second chance.</em>
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
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => setConfirming(true)}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          Tukar Resit / Replace Receipt
        </button>
      ) : (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)} style={{ flex: 1, justifyContent: 'center' }}>
            Batal / Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()} style={{ flex: 1, justifyContent: 'center' }}>
            {busy ? 'Memuat naik… / Uploading…' : 'Pilih Gambar / Choose Image'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ReceiptReupload;
