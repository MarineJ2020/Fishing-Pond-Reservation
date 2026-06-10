import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import CropRectOverlay, { NormRect } from './CropRectOverlay';
import { scanWeight, prewarmOcr, ScanResult, formatScannedWeight } from '../../utils/scaleOcr';

/**
 * A booking as the CMS sees it during the weigh-in scan flow. Carries the
 * full seat list so the modal can prompt the staff to pick the correct peg
 * after identifying the booking (either via QR or manual selection).
 */
export interface ScannedBookingFull {
  bookingId: string;
  bookingRef?: string;
  userId: string;
  anglerName: string;
  pondId: number;
  pondName: string;
  competitionId?: string;
  competitionName?: string;
  seats: number[];
}

/** Final shape passed to the CMS once seat is chosen. */
export interface ScannedBookingLite {
  bookingId: string;
  bookingRef?: string;
  userId: string;
  anglerName: string;
  pondId: number;
  pondName: string;
  seatNum: number;
  competitionId?: string;
  competitionName?: string;
}

export interface ScaleScanApproved {
  weight: number;
  ocrConfidence: number;
  ocrRawText: string;
  /** Always false now that manual editing is locked off. Kept for schema compat. */
  userEdited: boolean;
  photoBlob: Blob;
  photoFileName: string;
  scannedBooking: ScannedBookingLite;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApprove: (result: ScaleScanApproved) => void;
  usePreprocess?: boolean;
  decimalPlaces?: 0 | 1 | 2 | 3;
  /** Resolve a scanned booking id into the full booking (with seat list). */
  lookupBookingFull: (bookingId: string) => ScannedBookingFull | null;
  /**
   * Return all bookings the staff is allowed to weigh for right now — usually
   * scoped to the currently-selected Results competition. Powers the manual
   * picker as a fallback to QR scanning.
   */
  listBookings: () => ScannedBookingFull[];
}

type Step =
  | 'identify'         // initial: choose between scan QR or manual pick
  | 'qr-processing'    // decoding scanned QR
  | 'manual-picker'    // searchable list of bookings
  | 'seat-picker'      // booking found, pick which peg if multi-seat
  | 'capture'          // weight photo capture
  | 'crop'             // crop the weight photo
  | 'processing'       // running OCR
  | 'verify';          // show OCR result + confirm or retake

const MAX_LONG_EDGE = 1600;
const DEFAULT_CROP: NormRect = { x: 0.25, y: 0.42, w: 0.5, h: 0.18 };

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (ctx) ctx.drawImage(src, 0, 0);
  return out;
}

function renderHighlightedPreview(result: ScanResult): HTMLCanvasElement {
  const src = result.preprocessedCanvas;
  const display = document.createElement('canvas');
  display.width = src.width;
  display.height = src.height;
  const ctx = display.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0);

  const seg = result.sevenSegByPolarity[result.pickedPolarity];
  if (!seg) return display;

  const stroke = Math.max(2, Math.round(display.height * 0.012));
  const fontPx = Math.max(14, Math.round(display.height * 0.20));

  ctx.lineWidth = Math.max(1, Math.round(stroke * 0.6));
  ctx.strokeStyle = 'rgba(120, 120, 120, 0.7)';
  ctx.setLineDash([4, 3]);
  for (const b of seg.rejectedBboxes) {
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  }
  ctx.setLineDash([]);

  ctx.lineWidth = stroke;
  ctx.font = `bold ${fontPx}px sans-serif`;
  ctx.textBaseline = 'top';

  const sevenSegRead = seg.digits.length === seg.digitBboxes.length && seg.weight !== null;

  for (let i = 0; i < seg.digitBboxes.length; i++) {
    const b = seg.digitBboxes[i];
    const value = seg.digits[i];
    const hasValue = value !== undefined && sevenSegRead;
    const color = hasValue ? '#22c55e' : '#ef4444';

    ctx.strokeStyle = color;
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);

    const label = hasValue ? String(value) : '?';
    const padX = 6;
    const labelW = ctx.measureText(label).width + padX * 2;
    const labelH = fontPx + 6;
    const labelY = Math.max(0, b.y0 - labelH - 2);
    ctx.fillStyle = color;
    ctx.fillRect(b.x0, labelY, labelW, labelH);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, b.x0 + padX, labelY + 3);
  }

  if (seg.decimalBbox) {
    const b = seg.decimalBbox;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = Math.max(2, Math.round(display.height * 0.015));
    ctx.strokeRect(b.x0 - 2, b.y0 - 2, (b.x1 - b.x0) + 4, (b.y1 - b.y0) + 4);
  }

  return display;
}

/**
 * Parse the decoded QR text into a bookingId. Supports:
 *   • Full URL: https://kks.com/bookings/{id}
 *   • Bare path: /bookings/{id}
 *   • Raw booking id: {id}
 *   • Legacy URL with ?seat=N (seat is now ignored — staff picks).
 */
function parseBookingQr(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, 'http://placeholder');
    const match = url.pathname.match(/^\/bookings\/([^/]+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    /* fall through */
  }
  if (/^[A-Za-z0-9_-]{4,}$/.test(trimmed)) return trimmed;
  return null;
}

async function decodeQrFromFile(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1024;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  let code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  if (code?.data) return code.data;
  if (scale < 1) {
    const fc = document.createElement('canvas');
    fc.width = bitmap.width;
    fc.height = bitmap.height;
    const fctx = fc.getContext('2d', { willReadFrequently: true });
    if (fctx) {
      fctx.drawImage(bitmap, 0, 0);
      const big = fctx.getImageData(0, 0, fc.width, fc.height);
      code = jsQR(big.data, big.width, big.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) return code.data;
    }
  }
  return null;
}

function toLite(full: ScannedBookingFull, seatNum: number): ScannedBookingLite {
  return {
    bookingId: full.bookingId,
    bookingRef: full.bookingRef,
    userId: full.userId,
    anglerName: full.anglerName,
    pondId: full.pondId,
    pondName: full.pondName,
    seatNum,
    competitionId: full.competitionId,
    competitionName: full.competitionName,
  };
}

const ScaleScanModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onApprove,
  usePreprocess,
  decimalPlaces,
  lookupBookingFull,
  listBookings,
}) => {
  const [step, setStep] = useState<Step>('identify');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string>('scale.jpg');
  const [cropRect, setCropRect] = useState<NormRect>(DEFAULT_CROP);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingBookingFull, setPendingBookingFull] = useState<ScannedBookingFull | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<ScannedBookingLite | null>(null);
  const [manualSearch, setManualSearch] = useState('');
  const [liveQrActive, setLiveQrActive] = useState(false);
  const [liveQrBusy, setLiveQrBusy] = useState(false);
  const qrFileInputRef = useRef<HTMLInputElement>(null);
  const weightFileInputRef = useRef<HTMLInputElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const liveQrVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveQrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveQrStreamRef = useRef<MediaStream | null>(null);
  const liveQrRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (liveQrRafRef.current) {
        window.cancelAnimationFrame(liveQrRafRef.current);
        liveQrRafRef.current = null;
      }
      if (liveQrStreamRef.current) {
        liveQrStreamRef.current.getTracks().forEach((t) => t.stop());
        liveQrStreamRef.current = null;
      }
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      setStep('identify');
      setPhotoUrl(null);
      setPhotoBlob(null);
      setCropRect(DEFAULT_CROP);
      setResult(null);
      setError(null);
      setProgress('');
      setPendingBookingFull(null);
      setConfirmedBooking(null);
      setManualSearch('');
      setLiveQrActive(false);
      setLiveQrBusy(false);
    } else {
      prewarmOcr();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (step !== 'verify' || !result || !previewBoxRef.current) return;
    const box = previewBoxRef.current;
    box.innerHTML = '';
    const canvas = renderHighlightedPreview(result);
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.background = '#fff';
    canvas.style.borderRadius = '6px';
    box.appendChild(canvas);
  }, [step, result]);

  const bookingsForPicker = useMemo(() => {
    if (step !== 'manual-picker') return [];
    return listBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === 'identify') return;
    if (liveQrRafRef.current) {
      window.cancelAnimationFrame(liveQrRafRef.current);
      liveQrRafRef.current = null;
    }
    if (liveQrStreamRef.current) {
      liveQrStreamRef.current.getTracks().forEach((t) => t.stop());
      liveQrStreamRef.current = null;
      setLiveQrActive(false);
    }
  }, [step]);

  const filteredBookings = useMemo(() => {
    const q = manualSearch.trim().toLowerCase();
    if (!q) return bookingsForPicker;
    return bookingsForPicker.filter((b) =>
      b.anglerName.toLowerCase().includes(q)
      || b.bookingId.toLowerCase().includes(q)
      || (b.bookingRef && b.bookingRef.toLowerCase().includes(q))
      || b.pondName.toLowerCase().includes(q),
    );
  }, [bookingsForPicker, manualSearch]);

  if (!isOpen) return null;

  /** After we have a booking (from QR or manual pick), pick the seat or auto-advance. */
  const onBookingResolved = (full: ScannedBookingFull) => {
    setPendingBookingFull(full);
    if (full.seats.length === 1) {
      setConfirmedBooking(toLite(full, full.seats[0]));
      setStep('capture');
    } else {
      setStep('seat-picker');
    }
  };

  const stopLiveQrScan = () => {
    if (liveQrRafRef.current) {
      window.cancelAnimationFrame(liveQrRafRef.current);
      liveQrRafRef.current = null;
    }
    if (liveQrStreamRef.current) {
      liveQrStreamRef.current.getTracks().forEach((t) => t.stop());
      liveQrStreamRef.current = null;
    }
    const video = liveQrVideoRef.current;
    if (video) video.srcObject = null;
    setLiveQrActive(false);
  };

  const runLiveQrFrame = () => {
    const video = liveQrVideoRef.current;
    const canvas = liveQrCanvasRef.current;
    if (!video || !canvas || !liveQrActive) return;
    if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
      return;
    }

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
    if (code?.data) {
      const bookingId = parseBookingQr(code.data);
      if (bookingId) {
        const booking = lookupBookingFull(bookingId);
        if (booking) {
          stopLiveQrScan();
          onBookingResolved(booking);
          return;
        }
      }
    }
    liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
  };

  const startLiveQrScan = async () => {
    setError(null);
    setLiveQrBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      liveQrStreamRef.current = stream;
      const video = liveQrVideoRef.current;
      if (!video) throw new Error('Elemen video tidak tersedia.');
      video.srcObject = stream;
      await video.play();
      setLiveQrActive(true);
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
    } catch (err: any) {
      console.error('Live QR start failed:', err);
      setError(err?.message || 'Tidak dapat mengakses kamera. Semak kebenaran browser/peranti.');
      stopLiveQrScan();
    } finally {
      setLiveQrBusy(false);
    }
  };

  const handleQrChosen = async (file: File) => {
    setError(null);
    setStep('qr-processing');
    setProgress('Mengesan kod QR…');
    try {
      const decoded = await decodeQrFromFile(file);
      if (!decoded) {
        setError('QR tidak dapat dikesan dalam gambar. Pastikan QR berada di tengah dan jelas.');
        setStep('identify');
        return;
      }
      const bookingId = parseBookingQr(decoded);
      if (!bookingId) {
        setError(`QR dikesan tetapi format tidak sah: ${decoded.slice(0, 80)}`);
        setStep('identify');
        return;
      }
      const booking = lookupBookingFull(bookingId);
      if (!booking) {
        setError('Tempahan tidak dijumpai untuk QR ini. Pastikan QR untuk pertandingan semasa.');
        setStep('identify');
        return;
      }
      onBookingResolved(booking);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Imbasan QR gagal. Sila cuba lagi.');
      setStep('identify');
    }
  };

  const handlePickSeat = (seatNum: number) => {
    if (!pendingBookingFull) return;
    setConfirmedBooking(toLite(pendingBookingFull, seatNum));
    setStep('capture');
  };

  const handleManualPick = (booking: ScannedBookingFull) => {
    onBookingResolved(booking);
  };

  const handleWeightFileChosen = async (file: File) => {
    setError(null);
    setPhotoFileName(file.name || 'scale.jpg');
    setPhotoBlob(file);
    const url = URL.createObjectURL(file);
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(url);
    setStep('crop');
  };

  const buildCropCanvas = async (): Promise<HTMLCanvasElement> => {
    if (!photoBlob) throw new Error('Tiada gambar');
    const bitmap = await createImageBitmap(photoBlob);
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const fullW = Math.round(bitmap.width * scale);
    const fullH = Math.round(bitmap.height * scale);

    const cx = Math.round(cropRect.x * fullW);
    const cy = Math.round(cropRect.y * fullH);
    const cw = Math.round(cropRect.w * fullW);
    const ch = Math.round(cropRect.h * fullH);
    if (cw < 20 || ch < 20) throw new Error('Kawasan terlalu kecil');

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas tidak disokong');
    const srcScale = 1 / scale;
    ctx.drawImage(
      bitmap,
      cx * srcScale, cy * srcScale, cw * srcScale, ch * srcScale,
      0, 0, cw, ch,
    );
    return canvas;
  };

  const handleScan = async () => {
    if (!photoBlob) return;
    setStep('processing');
    setProgress('Memproses imej…');
    try {
      const cropCanvas = await buildCropCanvas();
      setProgress('Imbas paparan…');
      const r = await scanWeight(cloneCanvas(cropCanvas), undefined, { usePreprocess, decimalPlaces });
      setResult(r);
      setStep('verify');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Imbasan gagal. Sila cuba lagi.');
      setStep('crop');
    }
  };

  const handleRetakeWeight = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoBlob(null);
    setResult(null);
    setError(null);
    setStep('capture');
    setTimeout(() => weightFileInputRef.current?.click(), 50);
  };

  const handleResetIdentify = () => {
    setError(null);
    setPendingBookingFull(null);
    setConfirmedBooking(null);
    setManualSearch('');
    setStep('identify');
  };

  const handleApprove = () => {
    if (!result || result.weight === null || !photoBlob || !confirmedBooking) return;
    onApprove({
      weight: result.weight,
      ocrConfidence: result.confidence,
      ocrRawText: result.rawText,
      userEdited: false,
      photoBlob,
      photoFileName,
      scannedBooking: confirmedBooking,
    });
  };

  const prefillWeight = result ? formatScannedWeight(result.rawText, decimalPlaces) : '';

  const showBookingChip =
    confirmedBooking
    && step !== 'identify'
    && step !== 'qr-processing'
    && step !== 'manual-picker'
    && step !== 'seat-picker';

  return (
    <div
      className="modal-overlay open"
      onClick={onClose}
      style={{ zIndex: 9000 }}
    >
      <div
        className="modal"
        style={{ maxWidth: 760, width: '95%', maxHeight: '92vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            {(step === 'identify' || step === 'qr-processing' || step === 'manual-picker' || step === 'seat-picker')
              ? '📱 Kenal Pasti Pemancing'
              : '📷 Imbas Timbangan'}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        <div className="modal-body" style={{ padding: '16px' }}>
          {showBookingChip && confirmedBooking && (
            <div style={{
              background: '#ecfdf5', color: '#065f46', padding: '8px 12px',
              borderRadius: 6, marginBottom: 12, fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <span>✓</span>
              <strong>{confirmedBooking.anglerName}</strong>
              <span style={{ opacity: 0.7 }}>·</span>
              <span>{confirmedBooking.pondName} · Peg #{confirmedBooking.seatNum}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleResetIdentify}
                style={{ marginLeft: 'auto', fontSize: 11 }}
                title="Pilih pemancing lain"
              >
                Tukar
              </button>
            </div>
          )}

          {error && (
            <div style={{
              background: '#fee2e2', color: '#991b1b', padding: '10px 12px',
              borderRadius: 6, marginBottom: 12, fontSize: 14,
            }}>{error}</div>
          )}

          {/* STEP: identify (choose QR scan or manual pick) */}
          {step === 'identify' && (
            <div style={{ padding: '8px 4px' }}>
              <p style={{ marginBottom: 18, color: 'var(--text-muted)', fontSize: 14 }}>
                Pilih cara untuk mengenal pasti pemancing yang sedang ditimbang.
              </p>
              {liveQrActive && (
                <div style={{ marginBottom: 14, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#0f172a' }}>
                  <video ref={liveQrVideoRef} playsInline muted style={{ width: '100%', maxHeight: 260, objectFit: 'cover', display: 'block' }} />
                  <canvas ref={liveQrCanvasRef} style={{ display: 'none' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', color: '#fff', fontSize: 12 }}>
                    <span>Arahkan kamera ke QR tempahan</span>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.35)' }} onClick={stopLiveQrScan}>Tutup Kamera</button>
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{
                  border: '1px solid var(--line)', borderRadius: 12, padding: 22,
                  textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s',
                  background: '#fafbfc',
                }}
                  onClick={() => { if (!liveQrActive) startLiveQrScan(); }}
                >
                  <div style={{ fontSize: 48, marginBottom: 10 }}>📱</div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{liveQrBusy ? 'Membuka Kamera...' : (liveQrActive ? 'Kamera Aktif' : 'Imbas QR Live')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Imbas terus dari kamera peranti
                  </div>
                </div>
                <div style={{
                  border: '1px solid var(--line)', borderRadius: 12, padding: 22,
                  textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s',
                  background: '#fafbfc',
                }}
                  onClick={() => setStep('manual-picker')}
                >
                  <div style={{ fontSize: 48, marginBottom: 10 }}>📋</div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Pilih Manual</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Cari & pilih dari senarai tempahan
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, textAlign: 'center' }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => qrFileInputRef.current?.click()}>
                  Atau muat naik gambar QR
                </button>
              </div>
              <input
                ref={qrFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleQrChosen(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {step === 'qr-processing' && (
            <div style={{ textAlign: 'center', padding: '48px 12px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
              <div style={{ fontSize: 16 }}>{progress || 'Mengesan QR…'}</div>
            </div>
          )}

          {/* STEP: manual picker — searchable booking list */}
          {step === 'manual-picker' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Cari nama / ID tempahan / kolam…"
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={handleResetIdentify}>← Kembali</button>
              </div>
              <div style={{
                maxHeight: 380, overflowY: 'auto',
                border: '1px solid var(--line)', borderRadius: 8,
              }}>
                {filteredBookings.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {bookingsForPicker.length === 0
                      ? 'Tiada tempahan untuk pertandingan ini.'
                      : 'Tiada padanan untuk carian.'}
                  </div>
                ) : (
                  filteredBookings.map((b) => (
                    <div
                      key={b.bookingId}
                      onClick={() => handleManualPick(b)}
                      style={{
                        padding: '12px 14px',
                        borderBottom: '1px solid var(--line)',
                        cursor: 'pointer',
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{b.anglerName}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {b.pondName} · Peg {b.seats.map((s) => `#${s}`).join(', ')}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {b.bookingRef || b.bookingId.slice(0, 8)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* STEP: seat picker — booking found, choose which peg is being weighed */}
          {step === 'seat-picker' && pendingBookingFull && (
            <div style={{ padding: '8px 4px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                Tempahan dikenal pasti
              </div>
              <div style={{
                border: '2px solid var(--red)',
                borderRadius: 12,
                padding: '14px 18px',
                marginBottom: 18,
              }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4, fontFamily: 'var(--font-heading)' }}>
                  {pendingBookingFull.anglerName}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {pendingBookingFull.pondName}
                  {pendingBookingFull.competitionName && ` · ${pendingBookingFull.competitionName}`}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                Pilih peg yang sedang ditimbang:
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                gap: 10,
              }}>
                {pendingBookingFull.seats.map((seat) => (
                  <button
                    key={seat}
                    className="btn"
                    onClick={() => handlePickSeat(seat)}
                    style={{
                      padding: '14px 8px',
                      fontSize: 18,
                      fontWeight: 800,
                      justifyContent: 'center',
                    }}
                  >
                    #{seat}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <button className="btn btn-ghost" onClick={handleResetIdentify}>← Kembali</button>
              </div>
            </div>
          )}

          {/* STEP: capture weight photo */}
          {step === 'capture' && (
            <div style={{ textAlign: 'center', padding: '24px 12px' }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}>📷</div>
              <p style={{ marginBottom: 16, color: 'var(--text-muted)' }}>
                Ambil gambar paparan timbangan digital dengan jelas. Pastikan nombor kelihatan penuh.
              </p>
              <input
                ref={weightFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleWeightFileChosen(f);
                  e.target.value = '';
                }}
              />
              <button className="btn btn-primary" onClick={() => weightFileInputRef.current?.click()}>
                Ambil / Pilih Gambar Timbangan
              </button>
            </div>
          )}

          {step === 'crop' && photoUrl && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                Seret kotak kuning untuk meliputi <strong>HANYA baris angka pada paparan</strong>.
                <br />
                • <strong>Jangan</strong> masukkan bingkai/bezel hitam di sekeliling.
                <br />
                • <strong>Jangan</strong> masukkan label seperti "TARE", "WEIGHT", "UNIT PRICE".
                <br />
                • Boleh sertakan "kg" jika berdekatan.
              </p>
              <div style={{ textAlign: 'center' }}>
                <CropRectOverlay imageUrl={photoUrl} initial={cropRect} onChange={setCropRect} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn" onClick={handleRetakeWeight}>🔄 Ambil Semula</button>
                <button className="btn btn-primary" onClick={handleScan}>Imbas Kawasan Ini</button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div style={{ textAlign: 'center', padding: '48px 12px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
              <div style={{ fontSize: 16 }}>{progress || 'Memproses…'}</div>
            </div>
          )}

          {step === 'verify' && result && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Imej diproses
                  </div>
                  <div ref={previewBoxRef} style={{
                    background: '#222', padding: 6, borderRadius: 8, minHeight: 80,
                  }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                      background: result.pickedPolarity === 'invert' ? '#1e40af' : '#374151',
                      color: '#fff',
                    }}>
                      🔄 {result.pickedPolarity}{usePreprocess === false ? ' (raw)' : ''}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      ONNX: {result.rawText ? JSON.stringify(result.rawText) : '(kosong)'}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Bacaan dikesan (kunci — tidak boleh diubah)
                  </div>
                  <div style={{
                    display: 'inline-flex', alignItems: 'baseline', gap: 8,
                    padding: '8px 14px', borderRadius: 8,
                    background: result.weight !== null ? '#f0fdf4' : '#fef2f2',
                    border: `2px solid ${result.weight !== null ? '#86efac' : '#fca5a5'}`,
                  }}>
                    <span style={{
                      fontSize: 44, fontWeight: 800, lineHeight: 1.1,
                      color: result.weight !== null ? '#15803d' : '#991b1b',
                      fontFamily: 'var(--font-heading, monospace)',
                    }}>
                      {prefillWeight || '—'}
                    </span>
                    <span style={{ fontSize: 20, fontWeight: 500 }}>kg</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    🔒 Pengubahan manual tidak dibenarkan — ambil semula jika tidak tepat.
                  </div>
                </div>
              </div>

              <div style={{
                marginTop: 12, padding: 10, borderRadius: 6,
                background: '#eff6ff', color: '#1e3a8a', fontSize: 13,
              }}>
                ℹ️ Bandingkan bacaan di atas dengan paparan timbangan sebenar. Jika tidak sepadan,
                klik <strong>Ambil Semula</strong> dan tangkap gambar yang lebih jelas.
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn" onClick={handleRetakeWeight}>🔄 Ambil Semula</button>
                <button
                  className="btn btn-primary"
                  disabled={result.weight === null}
                  onClick={handleApprove}
                  style={result.weight === null ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                >
                  ✅ Sahkan &amp; Simpan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScaleScanModal;
