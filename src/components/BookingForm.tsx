import React, { useState, useRef } from 'react';
import { User, Pond, Booking } from '../types';

interface BookingFormProps {
  user: User | null;
  pond: Pond | null;
  selectedSeats: number[];
  payType: 'full' | 'deposit';
  receiptData: string | null;
  onSetPayType: (type: 'full' | 'deposit') => void;
  onHandleReceiptChange: (file: File) => void;
  onClearReceipt: () => void;
  onSubmitBooking: () => void;
  onOpenAuth: () => void;
}

const BookingForm: React.FC<BookingFormProps> = ({
  user,
  pond,
  selectedSeats,
  payType,
  receiptData,
  onSetPayType,
  onHandleReceiptChange,
  onClearReceipt,
  onSubmitBooking,
  onOpenAuth
}) => {
  const [notes, setNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const calcAmt = () => {
    if (!pond) return 0;
    const tot = selectedSeats.reduce((a, n) => {
      const s = pond.seats.find(x => x.num === n);
      return a + (s ? s.price : 0);
    }, 0);
    return payType === 'deposit' ? Math.ceil(tot * 0.5) : tot;
  };

  const amt = calcAmt();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onHandleReceiptChange(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onHandleReceiptChange(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  if (!user) {
    return (
      <div className="card booking-form-card">
        <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '18px' }}>Your Booking</div>
        <div id="booking-login-prompt" style={{ display: 'block', textAlign: 'center', padding: '18px 0' }}>
          <div style={{ fontSize: '30px', marginBottom: '10px' }}>🔐</div>
          <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '14px' }}>
            Login or register to complete your booking
          </div>
          <button className="btn btn-primary w-full" onClick={onOpenAuth}>Login / Register</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card booking-form-card">
      <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '18px' }}>Your Booking</div>
      <label className="form-label">Selected Pegs</label>
      <div className="selected-pills">
        {selectedSeats.length ? (
          selectedSeats.map(n => <span key={n} className="seat-pill">#{n}</span>)
        ) : (
          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>No pegs selected yet</div>
        )}
      </div>
      <hr className="divider" />
      <label className="form-label">Payment Type</label>
      <div className="payment-opts">
        <div className={`payment-opt ${payType === 'full' ? 'active' : ''}`} onClick={() => onSetPayType('full')}>
          Full<div className="opt-sub">Pay in full</div>
        </div>
        <div className={`payment-opt ${payType === 'deposit' ? 'active' : ''}`} onClick={() => onSetPayType('deposit')}>
          Deposit<div className="opt-sub">50% now</div>
        </div>
      </div>
      <label className="form-label">Upload Receipt <span style={{ color: 'var(--accent3)' }}>*</span></label>
      <div
        className="upload-zone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          id="receipt-file"
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <div className="upload-icon">
          <i className="fa-solid fa-cloud-arrow-up"></i>
        </div>
        <div className="upload-text">
          Click or drag receipt<br />
          <span style={{ fontSize: '10px', color: 'var(--muted)' }}>JPG, PNG or PDF</span>
        </div>
      </div>
      {receiptData && (
        <div className="upload-preview">
          <i className="fa-solid fa-check-circle"></i>
          <span>Receipt uploaded</span>
          <span style={{ marginLeft: 'auto', cursor: 'pointer', color: 'var(--muted)' }} onClick={onClearReceipt}>
            <i className="fa-solid fa-xmark"></i>
          </span>
        </div>
      )}
      <label className="form-label">Notes (optional)</label>
      <textarea
        className="form-input"
        rows={2}
        placeholder="Any special requests..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <button
        id="btn-submit"
        className="btn btn-primary w-full btn-lg mt-3"
        onClick={onSubmitBooking}
        disabled={!selectedSeats.length || !receiptData}
      >
        <i className="fa-solid fa-paper-plane"></i> Submit Booking
      </button>
      <div style={{ fontSize: '10px', color: 'var(--muted)', textAlign: 'center', marginTop: '7px' }}>
        Staff will verify and confirm via email
      </div>
    </div>
  );
};

export default BookingForm;