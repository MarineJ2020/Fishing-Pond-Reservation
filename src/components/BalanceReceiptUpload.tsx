import React, { useRef, useState } from 'react';
import { useUI } from '../context/UIContext';
import { compressImageToDataUrl, uploadDataUrlToCloudinary } from '../utils/cloudinary';
import { isPdfFile, uploadPdfToFirebaseStorage } from '../utils/pdfStorage';
import { submitBookingReceipt } from '../lib/api';

interface Props {
  bookingId: string;
  /** Outstanding balance — the amount this receipt is expected to cover. */
  balanceDue: number;
  /** How many receipts already exist (cap is 3). */
  receiptCount: number;
  /** Called after a successful submit so the parent can refresh the booking. */
  onSubmitted: () => void | Promise<void>;
}

const MAX_RECEIPTS = 3;

/**
 * Lets a deposit-booking owner upload the balance receipt. Self-contained:
 * compresses the image, uploads to Cloudinary, then calls the Cloud Function
 * which appends it as a pending receipt for staff review.
 */
const BalanceReceiptUpload: React.FC<Props> = ({ bookingId, balanceDue, receiptCount, onSubmitted }) => {
  const { addToast } = useUI();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const remaining = MAX_RECEIPTS - receiptCount;
  if (remaining <= 0) {
    return (
      <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '8px' }}>
        Resit maksimum ({MAX_RECEIPTS}) telah dihantar. Sila tunggu pengesahan petugas.
      </div>
    );
  }

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
      await submitBookingReceipt({ bookingId, receiptUrl, amount: balanceDue });
      addToast('Resit baki dihantar. Petugas akan mengesahkan pembayaran anda.', 'success');
      await onSubmitted();
    } catch (err: any) {
      console.error('Balance receipt submit failed:', err);
      addToast(err?.message || 'Gagal menghantar resit. Sila cuba lagi.', 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div style={{ background: 'var(--cream)', padding: '18px', borderRadius: '14px', border: '1px dashed var(--red)' }}>
      <div style={{ fontSize: '.68rem', color: 'var(--red)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>
        Hantar Resit Baki
      </div>
      <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
        Baki tertunggak: <strong style={{ color: 'var(--red)' }}>RM {balanceDue}</strong>. Muat naik resit
        pembayaran baki untuk pengesahan petugas. ({remaining} resit lagi dibenarkan)
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        style={{ width: '100%', justifyContent: 'center' }}
      >
        {busy ? 'Menghantar…' : 'Muat Naik Resit Baki'}
      </button>
    </div>
  );
};

export default BalanceReceiptUpload;
