import React, { useRef, useState } from 'react';
import { receiptUploadFolder } from '../utils/receiptStorage';
import { useUI } from '../context/UIContext';
import { compressImageToDataUrl, uploadDataUrlToFirebaseStorage } from '../utils/imageStorage';
import { isPdfFile, uploadPdfToFirebaseStorage } from '../utils/pdfStorage';
import { submitBookingReceipt } from '../lib/api';

interface Props {
  bookingId: string;
  /** Outstanding balance — the amount this receipt is expected to cover. */
  balanceDue: number;
  /** How many receipts already exist (cap is 2: deposit + balance). */
  receiptCount: number;
  /** Called after a successful submit so the parent can refresh the booking. */
  onSubmitted: () => void | Promise<void>;
}

// A deposit booking needs at most two receipts: the deposit and the balance.
// We never allow a third upload — a wrong receipt is corrected via re-upload.
const MAX_RECEIPTS = 2;

/**
 * Lets a deposit-booking owner upload the balance receipt. Self-contained:
 * compresses the image, uploads to Firebase Storage, then calls the Cloud Function
 * which appends it as a pending receipt for staff review.
 */
const BalanceReceiptUpload: React.FC<Props> = ({ bookingId, balanceDue, receiptCount, onSubmitted }) => {
  const { addToast } = useUI();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Same requirement as the first receipt on the booking form: staff reconcile
  // the transfer against the bank statement using this reference.
  const [bankReference, setBankReference] = useState('');
  const referenceOk = bankReference.trim() !== '';

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
    if (!referenceOk) {
      addToast('Sila masukkan No. Rujukan Bank dahulu.', 'error');
      return;
    }
    setBusy(true);
    try {
      const receiptUrl = isPdfFile(file)
        ? await uploadPdfToFirebaseStorage(file, receiptUploadFolder(), file.name)
        : await (async () => {
            const dataUrl = await compressImageToDataUrl(file);
            return uploadDataUrlToFirebaseStorage(dataUrl, receiptUploadFolder(), file.name);
          })();
      await submitBookingReceipt({ bookingId, receiptUrl, amount: balanceDue, bankReference: bankReference.trim() });
      addToast('Resit baki dihantar. Petugas akan mengesahkan pembayaran anda.', 'success');
      setBankReference('');
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
      <label className="form-label" htmlFor={`balance-bank-reference-${bookingId}`} style={{ display: 'block', marginBottom: '6px' }}>
        NO.RUJUKAN BANK <span style={{ color: 'var(--red)' }}>*</span>
      </label>
      <input
        id={`balance-bank-reference-${bookingId}`}
        className="form-input"
        type="text"
        autoComplete="off"
        disabled={busy}
        value={bankReference}
        onChange={(e) => setBankReference(e.target.value)}
        placeholder="Masukkan nombor rujukan transaksi"
        style={{ marginBottom: '12px' }}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <button
        className="btn btn-primary"
        disabled={busy || !referenceOk}
        title={referenceOk ? undefined : 'Masukkan No. Rujukan Bank dahulu'}
        onClick={() => inputRef.current?.click()}
        style={{ width: '100%', justifyContent: 'center' }}
      >
        {busy ? 'Menghantar…' : 'Muat Naik Resit Baki'}
      </button>
      {!referenceOk && (
        <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '7px', textAlign: 'center' }}>
          Masukkan No. Rujukan Bank untuk membuka muat naik resit.
        </div>
      )}
    </div>
  );
};

export default BalanceReceiptUpload;
